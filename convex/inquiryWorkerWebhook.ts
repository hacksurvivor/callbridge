"use node";

import { internalActionGeneric as internalAction, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { InquiryWorkerCallback } from "../shared/inquiryWorkerCallbacks.js";
import { verifyInquiryWorkerCallback } from "../src/integrations/inquiryWorkerCallback.js";

const recordWorkerEventRef = makeFunctionReference<"mutation", Extract<InquiryWorkerCallback, { kind: "event" }> extends infer Event
  ? Event extends { kind: "event" } ? Omit<Event, "schemaVersion" | "kind"> : never
  : never, { sequence: number; duplicate: boolean }>("inquiries:recordWorkerEvent");

const publishResultRef = makeFunctionReference<"mutation", Extract<InquiryWorkerCallback, { kind: "result" }> extends infer Result
  ? Result extends { kind: "result" } ? Omit<Result, "schemaVersion" | "kind"> : never
  : never, string>("inquiries:publishResult");

const settleResultCostRef = makeFunctionReference<"mutation", Extract<InquiryWorkerCallback, { kind: "cost" }> extends infer Cost
  ? Cost extends { kind: "cost" } ? Omit<Cost, "schemaVersion" | "kind"> : never
  : never, { duplicate: boolean }>("inquiries:settleResultCost");

export const processCallback = internalAction({
  args: {
    rawBody: v.string(),
    signature: v.union(v.string(), v.null()),
    timestamp: v.union(v.string(), v.null()),
  },
  returns: v.object({ kind: v.union(v.literal("event"), v.literal("result"), v.literal("cost")), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const callback = verifyInquiryWorkerCallback({
      rawBody: args.rawBody,
      signature: args.signature,
      timestamp: args.timestamp,
      secret: process.env.CALLBRIDGE_TELEPHONY_WEBHOOK_SECRET ?? "",
    });
    if (callback.kind === "event") {
      const { schemaVersion: _schemaVersion, kind: _kind, ...event } = callback;
      const accepted = await ctx.runMutation(recordWorkerEventRef, event);
      return { kind: "event" as const, duplicate: accepted.duplicate };
    }
    if (callback.kind === "result") {
      const { schemaVersion: _schemaVersion, kind: _kind, ...result } = callback;
      await ctx.runMutation(publishResultRef, result);
      return { kind: "result" as const, duplicate: false };
    }
    const { schemaVersion: _schemaVersion, kind: _kind, ...cost } = callback;
    const accepted = await ctx.runMutation(settleResultCostRef, cost);
    return { kind: "cost" as const, duplicate: accepted.duplicate };
  },
});
