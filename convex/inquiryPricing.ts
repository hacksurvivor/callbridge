import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import {
  INQUIRY_PRICING_QUOTE_TTL_MS,
  assertInquiryQuoteMatches,
  parseInquiryPricingQuote,
  type InquiryPricingQuote,
} from "../shared/inquiryPricing.js";
import { action, internalMutation } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";

const PRICING_REQUEST_COOLDOWN_MS = 5_000;
const PRICING_REQUEST_WINDOW_MS = 60_000;
const MAX_PRICING_REQUESTS_PER_OWNER_WINDOW = 10;

const beginPricingQuoteRef = makeFunctionReference<
  "mutation",
  {
    taskId: Id<"inquiryTasks">;
    ownerId: string;
    expectedRevision: number;
    expectedExecutionRevision: string;
  },
  {
    requestId: string;
    revision: number;
    executionRevision: string;
    contract: {
      destination: { e164PhoneNumber: string; countryCode: string };
      policy: { maxConnectedSeconds: number };
      costCeiling: { currency: string; maxTotalMinorUnits: number };
    };
  }
>("inquiryPricing:beginPricingQuote");

const storePricingQuoteRef = makeFunctionReference<
  "mutation",
  { taskId: Id<"inquiryTasks">; ownerId: string; requestId: string; quote: InquiryPricingQuote },
  null
>("inquiryPricing:storePricingQuote");

function pricingUrl(): string {
  const explicit = process.env.CALLBRIDGE_TELEPHONY_PRICING_URL?.trim();
  if (explicit) return explicit;
  const dispatch = process.env.CALLBRIDGE_TELEPHONY_DISPATCH_URL?.trim();
  if (!dispatch) throw new ConvexError({ code: "PRICING_UNAVAILABLE" });
  const url = new URL(dispatch);
  url.pathname = "/pricing-quote";
  url.search = "";
  return url.toString();
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function trustedQuote(input: {
  payload: unknown;
  revision: number;
  executionRevision: string;
  quotedAt: string;
}): InquiryPricingQuote {
  const quotedAtMs = Date.parse(input.quotedAt);
  if (!Number.isFinite(quotedAtMs)) throw new ConvexError({ code: "PRICING_INVALID" });
  const payload = record(input.payload);
  const destination = record(payload.destination);
  const policy = record(payload.policy);
  const pstn = record(payload.pstn);
  const quote = record(payload.quote);
  return parseInquiryPricingQuote({
    quoteId: crypto.randomUUID(),
    revision: input.revision,
    executionRevision: input.executionRevision,
    provider: payload.provider,
    destination,
    policy,
    pstn,
    quote: {
      ...quote,
      expiresAt: new Date(quotedAtMs + INQUIRY_PRICING_QUOTE_TTL_MS).toISOString(),
    },
    exclusions: payload.exclusions,
  });
}

export const beginPricingQuote = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    ownerId: v.string(),
    expectedRevision: v.number(),
    expectedExecutionRevision: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("inquiryTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== args.ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (task.executionRevision !== args.expectedExecutionRevision) {
      throw new ConvexError({ code: "EXECUTION_REVISION_MISMATCH" });
    }
    if (task.status !== "draft" && task.status !== "awaiting_confirmation") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    const nowMs = Date.now();
    if (task.status === "awaiting_confirmation") {
      const expiresAtMs = task.confirmationExpiresAt ? Date.parse(task.confirmationExpiresAt) : Number.NaN;
      if (!Number.isFinite(expiresAtMs) || expiresAtMs > nowMs) {
        throw new ConvexError({ code: "PRICING_LOCKED" });
      }
      if (task.confirmationIntentId) {
        const intent = await ctx.db.get("inquiryConfirmationIntents", task.confirmationIntentId);
        if (intent?.state === "ready") {
          await ctx.db.patch("inquiryConfirmationIntents", intent._id, { state: "expired" });
        }
      }
    }
    const lastRequestMs = task.pricingRequestedAt ? Date.parse(task.pricingRequestedAt) : Number.NaN;
    if (Number.isFinite(lastRequestMs) && lastRequestMs > nowMs - PRICING_REQUEST_COOLDOWN_MS) {
      throw new ConvexError({ code: "PRICING_RATE_LIMITED" });
    }
    const cutoff = new Date(nowMs - PRICING_REQUEST_WINDOW_MS).toISOString();
    const recentRequests = await ctx.db
      .query("inquiryPricingRequests")
      .withIndex("by_owner_created_at", (q) => q.eq("ownerId", args.ownerId).gte("createdAt", cutoff))
      .take(MAX_PRICING_REQUESTS_PER_OWNER_WINDOW);
    if (recentRequests.length >= MAX_PRICING_REQUESTS_PER_OWNER_WINDOW) {
      throw new ConvexError({ code: "PRICING_RATE_LIMITED" });
    }
    const now = new Date(nowMs).toISOString();
    const requestId = crypto.randomUUID();
    await ctx.db.insert("inquiryPricingRequests", {
      ownerId: args.ownerId,
      taskId: task._id,
      requestId,
      createdAt: now,
    });
    await ctx.db.patch("inquiryTasks", task._id, {
      ...(task.status === "awaiting_confirmation" ? {
        status: "draft" as const,
        confirmationState: "expired" as const,
        confirmationIntentId: undefined,
        confirmationExpiresAt: undefined,
        pricingQuote: undefined,
      } : {}),
      pricingRequestId: requestId,
      pricingRequestedAt: now,
      updatedAt: now,
    });
    return {
      requestId,
      revision: task.revision,
      executionRevision: task.executionRevision,
      contract: task.contract,
    };
  },
});

export const storePricingQuote = internalMutation({
  args: { taskId: v.id("inquiryTasks"), ownerId: v.string(), requestId: v.string(), quote: v.any() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("inquiryTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== args.ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    if (task.status !== "draft") throw new ConvexError({ code: "PRICING_LOCKED" });
    if (task.pricingRequestId !== args.requestId) throw new ConvexError({ code: "PRICING_REQUEST_SUPERSEDED" });
    const quote = parseInquiryPricingQuote(args.quote);
    try {
      assertInquiryQuoteMatches({
        quote,
        revision: task.revision,
        executionRevision: task.executionRevision,
        destinationCountryCode: task.contract.destination.countryCode,
        maximumConnectedSeconds: task.contract.policy.maxConnectedSeconds,
        costCeiling: task.contract.costCeiling,
      });
    } catch (error) {
      throw new ConvexError({ code: error instanceof Error ? error.message : "PRICING_INVALID" });
    }
    await ctx.db.patch("inquiryTasks", task._id, {
      pricingQuote: quote,
      pricingRequestId: undefined,
      updatedAt: new Date().toISOString(),
    });
    return null;
  },
});

export const quoteCall = action({
  args: {
    taskId: v.id("inquiryTasks"),
    expectedRevision: v.number(),
    expectedExecutionRevision: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const target = await ctx.runMutation(beginPricingQuoteRef, {
      taskId: args.taskId,
      ownerId: identity.subject,
      expectedRevision: args.expectedRevision,
      expectedExecutionRevision: args.expectedExecutionRevision,
    });
    if (target.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (target.executionRevision !== args.expectedExecutionRevision) {
      throw new ConvexError({ code: "EXECUTION_REVISION_MISMATCH" });
    }
    const apiKey = process.env.CALLBRIDGE_TELEPHONY_API_KEY?.trim();
    if (!apiKey) throw new ConvexError({ code: "PRICING_UNAVAILABLE" });
    let response: Response;
    try {
      response = await fetch(pricingUrl(), {
        method: "POST",
        headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({
          to: target.contract.destination.e164PhoneNumber,
          maximumConnectedSeconds: target.contract.policy.maxConnectedSeconds,
        }),
      });
    } catch {
      throw new ConvexError({ code: "PRICING_UNAVAILABLE" });
    }
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const error = record(payload).error;
      throw new ConvexError({ code: typeof error === "string" ? error : "PRICING_UNAVAILABLE" });
    }
    const quoteRecord = record(record(payload).quote);
    const quotedAt = typeof quoteRecord.quotedAt === "string" ? quoteRecord.quotedAt : "";
    const quote = trustedQuote({
      payload,
      revision: target.revision,
      executionRevision: target.executionRevision,
      quotedAt,
    });
    try {
      assertInquiryQuoteMatches({
        quote,
        revision: target.revision,
        executionRevision: target.executionRevision,
        destinationCountryCode: target.contract.destination.countryCode,
        maximumConnectedSeconds: target.contract.policy.maxConnectedSeconds,
        costCeiling: target.contract.costCeiling,
      });
    } catch (error) {
      throw new ConvexError({ code: error instanceof Error ? error.message : "PRICING_INVALID" });
    }
    await ctx.runMutation(storePricingQuoteRef, {
      taskId: args.taskId,
      ownerId: identity.subject,
      requestId: target.requestId,
      quote,
    });
    return quote;
  },
});
