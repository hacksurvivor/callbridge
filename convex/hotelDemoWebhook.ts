"use node";

import { internalActionGeneric as internalAction, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { AttemptEvent } from "../shared/hotelDemoContracts.js";
import { verifySignedHotelDemoEvent } from "../src/integrations/hotelDemoEventBridge.js";

const ingestAttemptEventRef = makeFunctionReference<
  "mutation",
  { event: AttemptEvent; receivedAt: string },
  "accepted" | "duplicate" | "buffered" | "private_only"
>("hotelDemoEvents:ingestAttemptEvent");

export const processEvent = internalAction({
  args: { rawBody: v.string(), signature: v.union(v.string(), v.null()), timestamp: v.union(v.string(), v.null()) },
  returns: v.union(v.literal("accepted"), v.literal("duplicate"), v.literal("buffered"), v.literal("private_only")),
  handler: async (ctx, args) => {
    const receivedAt = new Date().toISOString();
    const event = verifySignedHotelDemoEvent({
      rawBody: args.rawBody,
      signature: args.signature,
      timestamp: args.timestamp,
      secret: process.env.CALLBRIDGE_TELEPHONY_WEBHOOK_SECRET ?? "",
      nowMs: new Date(receivedAt).getTime(),
    });
    return await ctx.runMutation(ingestAttemptEventRef, { event, receivedAt });
  },
});
