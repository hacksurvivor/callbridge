import { v } from "convex/values";
import { internalMutationGeneric as internalMutation } from "convex/server";

const ACTIVE_PROVIDER_STATUSES = new Set(["active", "on_trial"]);

/** Called only after a server-side adapter has verified the webhook signature. */
export const applyVerifiedLemonSqueezyEvent = internalMutation({
  args: {
    eventId: v.string(),
    eventName: v.string(),
    userId: v.string(),
    externalCustomerId: v.string(),
    externalSubscriptionId: v.string(),
    status: v.string(),
    plan: v.union(v.string(), v.null()),
    renewsAt: v.union(v.string(), v.null()),
    endsAt: v.union(v.string(), v.null()),
  },
  returns: v.union(v.literal("applied"), v.literal("duplicate")),
  handler: async (ctx, event) => {
    const duplicate = await ctx.db
      .query("entitlementWebhookEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", event.eventId))
      .unique();
    if (duplicate) return "duplicate" as const;

    const now = new Date().toISOString();
    const current = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", event.userId))
      .unique();
    const active = ACTIVE_PROVIDER_STATUSES.has(event.status) && event.eventName !== "subscription_expired";
    const entitlement = {
      userId: event.userId,
      provider: "lemon_squeezy" as const,
      active,
      plan: event.plan,
      validUntil: event.endsAt ?? event.renewsAt,
      externalCustomerId: event.externalCustomerId,
      externalSubscriptionId: event.externalSubscriptionId,
      providerStatus: event.status,
      updatedAt: now,
    };
    if (current) await ctx.db.patch("entitlements", current._id, entitlement);
    else await ctx.db.insert("entitlements", entitlement);

    await ctx.db.insert("entitlementWebhookEvents", {
      eventId: event.eventId,
      eventName: event.eventName,
      appliedAt: now,
    });
    return "applied" as const;
  },
});
