import {
  internalQueryGeneric as internalQuery,
  mutationGeneric as mutation,
  queryGeneric as query,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import { validateExpoPushToken } from "../src/domain/pushNotifications.js";

async function requireOwnerId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

const subscriptionValidator = v.object({
  _id: v.id("pushSubscriptions"),
  token: v.string(),
  platform: v.union(v.literal("ios"), v.literal("android"), v.literal("web")),
  enabled: v.boolean(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

export const register = mutation({
  args: {
    token: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android"), v.literal("web")),
  },
  returns: v.id("pushSubscriptions"),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    let token: string;
    try {
      token = validateExpoPushToken(args.token);
    } catch (error) {
      throw new ConvexError({
        code: "VALIDATION_FAILED",
        message: error instanceof Error ? error.message : "Push token is invalid",
      });
    }
    const ownerTokenKey = `${ownerId}:${token}`;
    const existing = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_owner_token", (q) => q.eq("ownerTokenKey", ownerTokenKey))
      .unique();
    const now = new Date().toISOString();
    if (existing) {
      await ctx.db.patch("pushSubscriptions", existing._id, {
        platform: args.platform,
        enabled: true,
        updatedAt: now,
      });
      return existing._id;
    }
    return await ctx.db.insert("pushSubscriptions", {
      ownerId,
      token,
      ownerTokenKey,
      platform: args.platform,
      enabled: true,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const disable = mutation({
  args: { subscriptionId: v.id("pushSubscriptions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const subscription = await ctx.db.get("pushSubscriptions", args.subscriptionId);
    if (!subscription) return null;
    if (subscription.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    if (subscription.enabled) {
      await ctx.db.patch("pushSubscriptions", args.subscriptionId, {
        enabled: false,
        updatedAt: new Date().toISOString(),
      });
    }
    return null;
  },
});

export const listMine = query({
  args: {},
  returns: v.array(subscriptionValidator),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const records = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    return records.map(({ _id, token, platform, enabled, createdAt, updatedAt }) => ({
      _id,
      token,
      platform,
      enabled,
      createdAt,
      updatedAt,
    }));
  },
});

export const listEnabledForOwner = internalQuery({
  args: { ownerId: v.string() },
  returns: v.array(subscriptionValidator),
  handler: async (ctx, args) => {
    const records = await ctx.db
      .query("pushSubscriptions")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    return records
      .filter(({ enabled }) => enabled)
      .map(({ _id, token, platform, enabled, createdAt, updatedAt }) => ({
        _id,
        token,
        platform,
        enabled,
        createdAt,
        updatedAt,
      }));
  },
});
