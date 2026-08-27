import {
  actionGeneric as action,
  internalMutationGeneric as internalMutation,
  makeFunctionReference,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import { hotelDemoCallDraftValidator } from "./hotelDemoValidators.js";

const getPricingInputRef = makeFunctionReference<
  "query",
  { taskId: string; ownerId: string; expectedRevision: number },
  { taskId: string; destinationPhoneE164: string; revision: number }
>("hotelDemo:getPricingInput");

const storePricingQuoteRef = makeFunctionReference<"mutation", any, any>("hotelDemoPricing:storePricingQuote");
const readCallDraftRef = makeFunctionReference<"query", { schemaVersion: number; taskId: string }, any>("hotelDemo:readCallDraft");

const pricingSourceValidator = v.union(
  v.literal("twilio_voice_number_pricing_api_v2"),
  v.literal("twilio_public_outbound_pricing_csv"),
);

const readyPricingValidator = v.object({
  state: v.literal("ready"),
  revision: v.number(),
  destinationCountry: v.string(),
  destinationIsoCountry: v.string(),
  rateDescription: v.string(),
  currentPricePerMinute: v.string(),
  currency: v.string(),
  maximumConnectedSeconds: v.number(),
  estimatedMaximumPstnCharge: v.string(),
  quotedAt: v.string(),
  expiresAt: v.string(),
  source: pricingSourceValidator,
  accountSpecific: v.boolean(),
});

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConvexError({ code: "PRICE_QUOTE_UNAVAILABLE" });
  return value;
}

function pricingUrl(): string {
  const url = new URL(required("CALLBRIDGE_TELEPHONY_DISPATCH_URL"));
  url.pathname = "/pricing-quote";
  url.search = "";
  url.hash = "";
  if (url.protocol !== "https:") throw new ConvexError({ code: "PRICE_QUOTE_UNAVAILABLE" });
  return url.toString();
}

function stringField(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ConvexError({ code: "PRICE_QUOTE_UNAVAILABLE", field: name });
  return value;
}

export const quoteCall = action({
  args: { schemaVersion: v.number(), taskId: v.id("hotelDemoTasks"), expectedRevision: v.number() },
  returns: v.object({ pricing: readyPricingValidator, draft: hotelDemoCallDraftValidator }),
  handler: async (ctx, args) => {
    if (args.schemaVersion !== 1) throw new ConvexError({ code: "VALIDATION_FAILED" });
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const task = await ctx.runQuery(getPricingInputRef, { taskId: args.taskId, ownerId: identity.subject, expectedRevision: args.expectedRevision });
    const response = await fetch(pricingUrl(), {
      method: "POST",
      headers: { authorization: `Bearer ${required("CALLBRIDGE_TELEPHONY_API_KEY")}`, "content-type": "application/json" },
      body: JSON.stringify({ to: task.destinationPhoneE164, maximumConnectedSeconds: 180 }),
    });
    const payload = await response.json() as any;
    if (!response.ok) throw new ConvexError({ code: "PRICE_QUOTE_UNAVAILABLE" });
    const now = new Date();
    const pricing = {
      state: "ready" as const,
      revision: task.revision,
      destinationCountry: stringField(payload.destination?.country, "destination.country"),
      destinationIsoCountry: stringField(payload.destination?.isoCountry, "destination.isoCountry"),
      rateDescription: stringField(payload.pstn?.rateDescription, "pstn.rateDescription"),
      currentPricePerMinute: stringField(payload.pstn?.currentPricePerMinute, "pstn.currentPricePerMinute"),
      currency: stringField(payload.pstn?.currency, "pstn.currency"),
      maximumConnectedSeconds: Number(payload.pstn?.maximumConnectedSeconds),
      estimatedMaximumPstnCharge: stringField(payload.pstn?.estimatedMaximumCharge, "pstn.estimatedMaximumCharge"),
      quotedAt: stringField(payload.quote?.quotedAt, "quote.quotedAt"),
      expiresAt: new Date(now.getTime() + 5 * 60 * 1_000).toISOString(),
      source: payload.quote?.source as "twilio_voice_number_pricing_api_v2" | "twilio_public_outbound_pricing_csv",
      accountSpecific: payload.quote?.accountSpecific === true,
    };
    if (
      !Number.isInteger(pricing.maximumConnectedSeconds)
      || pricing.maximumConnectedSeconds !== 180
      || !["twilio_voice_number_pricing_api_v2", "twilio_public_outbound_pricing_csv"].includes(pricing.source)
    ) throw new ConvexError({ code: "PRICE_QUOTE_UNAVAILABLE" });
    await ctx.runMutation(storePricingQuoteRef, { taskId: args.taskId, ownerId: identity.subject, expectedRevision: args.expectedRevision, pricing });
    const refreshed = await ctx.runQuery(readCallDraftRef, { schemaVersion: 1, taskId: args.taskId });
    return { pricing, draft: refreshed.draft };
  },
});

export const storePricingQuote = internalMutation({
  args: {
    taskId: v.id("hotelDemoTasks"),
    ownerId: v.string(),
    expectedRevision: v.number(),
    pricing: readyPricingValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("hotelDemoTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== args.ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    if (task.revision !== args.expectedRevision || args.pricing.revision !== task.revision) throw new ConvexError({ code: "STALE_REVISION" });
    if (task.status !== "draft" && task.status !== "awaiting_confirmation") throw new ConvexError({ code: "INVALID_TRANSITION" });
    await ctx.db.patch("hotelDemoTasks", task._id, {
      pricingState: "ready",
      pricingRevision: args.pricing.revision,
      pricingDestinationCountry: args.pricing.destinationCountry,
      pricingDestinationIsoCountry: args.pricing.destinationIsoCountry,
      pricingRateDescription: args.pricing.rateDescription,
      pricingCurrentPricePerMinute: args.pricing.currentPricePerMinute,
      pricingCurrency: args.pricing.currency,
      pricingMaximumConnectedSeconds: args.pricing.maximumConnectedSeconds,
      pricingEstimatedMaximumPstnCharge: args.pricing.estimatedMaximumPstnCharge,
      pricingQuotedAt: args.pricing.quotedAt,
      pricingExpiresAt: args.pricing.expiresAt,
      pricingSource: args.pricing.source,
      pricingAccountSpecific: args.pricing.accountSpecific,
      updatedAt: new Date().toISOString(),
    });
    return null;
  },
});
