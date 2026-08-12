import { internalMutationGeneric as internalMutation, mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { ConvexError, v } from "convex/values";
import { validateProactiveFinding } from "../src/domain/proactiveFinding.js";

async function user(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}
const findingValidator = v.object({ _id: v.id("proactiveFindings"), _creationTime: v.number(), taskId: v.id("callTasks"), ownerId: v.string(), summary: v.string(), source: v.string(), expiresAt: v.optional(v.string()), state: v.union(v.literal("proposed"), v.literal("approved"), v.literal("dismissed"), v.literal("expired")), createdAt: v.string(), decidedAt: v.optional(v.string()) });

export const listForTask = query({ args: { taskId: v.id("callTasks") }, returns: v.array(findingValidator), handler: async (ctx, args) => {
  const ownerId = await user(ctx); const task = await ctx.db.get("callTasks", args.taskId);
  if (!task) throw new ConvexError({ code: "NOT_FOUND" }); if (task.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
  return await ctx.db.query("proactiveFindings").withIndex("by_task", q => q.eq("taskId", args.taskId)).collect();
} });

export const propose = internalMutation({ args: { taskId: v.id("callTasks"), summary: v.string(), source: v.string(), expiresAt: v.optional(v.string()) }, returns: v.id("proactiveFindings"), handler: async (ctx, args) => {
  const task = await ctx.db.get("callTasks", args.taskId); if (!task) throw new ConvexError({ code: "NOT_FOUND" });
  try { validateProactiveFinding(args); } catch (error) { throw new ConvexError({ code: "VALIDATION_FAILED", message: error instanceof Error ? error.message : "Invalid finding" }); }
  return await ctx.db.insert("proactiveFindings", { ...args, ownerId: task.ownerId, state: "proposed", createdAt: new Date().toISOString() });
} });

export const decide = mutation({ args: { findingId: v.id("proactiveFindings"), approve: v.boolean() }, returns: v.id("proactiveFindings"), handler: async (ctx, args) => {
  const ownerId = await user(ctx); const finding = await ctx.db.get("proactiveFindings", args.findingId);
  if (!finding) throw new ConvexError({ code: "NOT_FOUND" }); if (finding.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
  if (finding.state !== "proposed") throw new ConvexError({ code: "INVALID_TRANSITION" });
  await ctx.db.patch("proactiveFindings", finding._id, { state: args.approve ? "approved" : "dismissed", decidedAt: new Date().toISOString() }); return finding._id;
} });
