import { mutationGeneric as mutation } from "convex/server";
import { ConvexError, v } from "convex/values";
import { validatePostStayReview } from "../src/domain/postStayReview.js";
async function owner(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) { const i = await ctx.auth.getUserIdentity(); if (!i) throw new ConvexError({ code: "UNAUTHENTICATED" }); return i.subject; }
export const submit = mutation({ args: { taskId: v.id("callTasks"), rating: v.optional(v.number()), liked: v.optional(v.string()), disliked: v.optional(v.string()), note: v.optional(v.string()) }, returns: v.id("postStayReviews"), handler: async (ctx, args) => {
  const ownerId = await owner(ctx); const task = await ctx.db.get("callTasks", args.taskId);
  if (!task) throw new ConvexError({ code: "NOT_FOUND" }); if (task.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
  try { validatePostStayReview(args); } catch (error) { throw new ConvexError({ code: "VALIDATION_FAILED", message: error instanceof Error ? error.message : "Invalid review" }); }
  return await ctx.db.insert("postStayReviews", { ownerId, ...args, createdAt: new Date().toISOString() });
} });
