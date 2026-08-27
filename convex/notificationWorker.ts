"use node";

import { internalActionGeneric as internalAction, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { assertCapabilityEnabled } from "../src/application/launchReadiness.js";
import { sendExpoPushNotification } from "../src/integrations/expoPush.js";

type PendingNotification = {
  _id: string;
  ownerId: string;
  title: string;
  body: string;
  data: Record<string, string>;
};
type PushSubscription = { _id: string; token: string; enabled: boolean };

const listPendingRef = makeFunctionReference<"query", { limit: number }, PendingNotification[]>("notificationOutbox:listPending");
const listTokensRef = makeFunctionReference<"query", { ownerId: string }, PushSubscription[]>("pushSubscriptions:listEnabledForOwner");
const markResultRef = makeFunctionReference<
  "mutation",
  { notificationId: string; state: "blocked" | "delivered" | "failed"; now: string; externalMessageId?: string; failureReason?: string },
  null
>("notificationOutbox:markDeliveryResult");

export const dispatchPending = internalAction({
  args: {},
  returns: v.object({ delivered: v.number(), blocked: v.number(), failed: v.number() }),
  handler: async (ctx) => {
    try {
      assertCapabilityEnabled("push_notifications", process.env);
    } catch {
      return { delivered: 0, blocked: 0, failed: 0 };
    }
    const pending = await ctx.runQuery(listPendingRef, { limit: 50 });
    let delivered = 0;
    let blocked = 0;
    let failed = 0;
    for (const item of pending) {
      const now = new Date().toISOString();
      const subscriptions = await ctx.runQuery(listTokensRef, { ownerId: item.ownerId });
      if (subscriptions.length === 0) {
        await ctx.runMutation(markResultRef, {
          notificationId: item._id,
          state: "blocked",
          now,
          failureReason: "no_push_subscription",
        });
        blocked += 1;
        continue;
      }
      try {
        const result = await sendExpoPushNotification({
          accessToken: process.env.EXPO_ACCESS_TOKEN ?? "",
          tokens: subscriptions.map(({ token }) => token),
          title: item.title,
          body: item.body,
          data: item.data,
        });
        await ctx.runMutation(markResultRef, {
          notificationId: item._id,
          state: "delivered",
          now,
          externalMessageId: result.ticketIds.join(","),
        });
        delivered += 1;
      } catch {
        await ctx.runMutation(markResultRef, {
          notificationId: item._id,
          state: "failed",
          now,
          failureReason: "push_dispatch_failed",
        });
        failed += 1;
      }
    }
    return { delivered, blocked, failed };
  },
});
