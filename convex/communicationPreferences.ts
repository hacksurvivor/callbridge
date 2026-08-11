import { mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { ConvexError, v } from "convex/values";

import { DomainError } from "../src/domain/errors.js";
import { validateCommunicationPreferences } from "../src/domain/communicationPreferences.js";
import { communicationPreferencesValidator } from "./validators.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

export const getMine = query({
  args: {},
  returns: v.union(communicationPreferencesValidator, v.null()),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const record = await ctx.db
      .query("communicationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return record?.preferences ?? null;
  },
});

export const saveMine = mutation({
  args: { preferences: communicationPreferencesValidator },
  returns: communicationPreferencesValidator,
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    let preferences;
    try {
      preferences = validateCommunicationPreferences(args.preferences);
    } catch (error) {
      if (error instanceof DomainError) {
        throw new ConvexError({
          code: error.code,
          message: error.message,
          details: [...error.details],
        });
      }
      throw error;
    }
    const now = new Date().toISOString();
    const existing = await ctx.db
      .query("communicationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) {
      await ctx.db.patch("communicationPreferences", existing._id, { preferences, updatedAt: now });
    } else {
      await ctx.db.insert("communicationPreferences", { userId, preferences, updatedAt: now });
    }
    return preferences;
  },
});
