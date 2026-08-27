"use node";

import { internalActionGeneric as internalAction, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { verifyAndParseLemonSqueezyWebhook } from "../src/integrations/lemonSqueezyWebhook.js";
import { assertCapabilityEnabled } from "../src/application/launchReadiness.js";

const applyVerifiedEvent = makeFunctionReference<
  "mutation",
  {
    eventId: string;
    eventName: "subscription_created" | "subscription_updated" | "subscription_cancelled" | "subscription_expired";
    userId: string;
    externalCustomerId: string;
    externalSubscriptionId: string;
    status: string;
    plan: string | null;
    renewsAt: string | null;
    endsAt: string | null;
  },
  "applied" | "duplicate"
>("entitlements:applyVerifiedLemonSqueezyEvent");

export const processWebhook = internalAction({
  args: { rawBody: v.string(), signature: v.union(v.string(), v.null()) },
  returns: v.union(v.literal("applied"), v.literal("duplicate")),
  handler: async (ctx, args) => {
    assertCapabilityEnabled("billing_webhook", process.env);
    const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET ?? "";
    const event = verifyAndParseLemonSqueezyWebhook({
      rawBody: new TextEncoder().encode(args.rawBody),
      signature: args.signature,
      secret,
    });
    return await ctx.runMutation(applyVerifiedEvent, {
      ...event,
      plan: event.plan ?? null,
    });
  },
});
