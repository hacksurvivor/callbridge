import { mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { ConvexError, v } from "convex/values";
import { validateCategoryAutomationPreference } from "../src/domain/categoryAutomation.js";
import { categoryAutomationPreferenceValidator } from "./validators.js";

async function owner(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

const recordValidator = v.object({ _id: v.id("categoryAutomationPreferences"), _creationTime: v.number(), ownerId: v.string(), ownerCategoryKey: v.string(), preference: categoryAutomationPreferenceValidator, updatedAt: v.string() });

export const listMine = query({ args: {}, returns: v.array(recordValidator), handler: async (ctx) => {
  const ownerId = await owner(ctx);
  return await ctx.db.query("categoryAutomationPreferences").withIndex("by_owner", q => q.eq("ownerId", ownerId)).collect();
} });

export const set = mutation({ args: { preference: categoryAutomationPreferenceValidator }, returns: v.id("categoryAutomationPreferences"), handler: async (ctx, args) => {
  const ownerId = await owner(ctx);
  const preference = validateCategoryAutomationPreference(args.preference);
  const ownerCategoryKey = `${ownerId}:${preference.category}`;
  const existing = await ctx.db.query("categoryAutomationPreferences").withIndex("by_owner_category", q => q.eq("ownerCategoryKey", ownerCategoryKey)).unique();
  const patch = { ownerId, ownerCategoryKey, preference, updatedAt: new Date().toISOString() };
  if (existing) { await ctx.db.patch("categoryAutomationPreferences", existing._id, patch); return existing._id; }
  return await ctx.db.insert("categoryAutomationPreferences", patch);
} });
