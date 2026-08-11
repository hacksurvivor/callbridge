import {
  internalMutationGeneric as internalMutation,
  queryGeneric as query,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import { DomainError } from "../src/domain/errors.js";
import { validateTaskActivityEvent } from "../src/domain/activityEvents.js";
import { canPerformSharedTaskAction } from "../src/domain/sharing.js";
import { taskActivityEventValidator } from "./validators.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

export const listForTask = query({
  args: { taskId: v.id("callTasks") },
  returns: v.array(
    v.object({
      sequence: v.number(),
      event: taskActivityEventValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== userId) {
      const access = await ctx.db
        .query("taskAccess")
        .withIndex("by_task_user", (q) => q.eq("taskUserKey", `${args.taskId}:${userId}`))
        .unique();
      if (!access || !canPerformSharedTaskAction(access.permissionLevel, "view")) {
        throw new ConvexError({ code: "FORBIDDEN" });
      }
    }
    const events = await ctx.db
      .query("taskActivityEvents")
      .withIndex("by_task_sequence", (q) => q.eq("taskId", args.taskId))
      .collect();
    return events.map(({ sequence, event }) => ({ sequence, event }));
  },
});

/** Future telephony and messaging gateways can append only factual status events. */
export const appendInternal = internalMutation({
  args: { taskId: v.id("callTasks"), event: taskActivityEventValidator },
  returns: v.number(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    let event;
    try {
      event = validateTaskActivityEvent(args.event);
    } catch (error) {
      if (error instanceof DomainError) {
        throw new ConvexError({ code: error.code, message: error.message, details: [...error.details] });
      }
      throw error;
    }
    const last = await ctx.db
      .query("taskActivityEvents")
      .withIndex("by_task_sequence", (q) => q.eq("taskId", args.taskId))
      .order("desc")
      .first();
    const sequence = (last?.sequence ?? 0) + 1;
    await ctx.db.insert("taskActivityEvents", { taskId: args.taskId, sequence, event });
    return sequence;
  },
});
