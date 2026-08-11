import { mutationGeneric as mutation } from "convex/server";
import { ConvexError, v } from "convex/values";

import { canPerformSharedTaskAction } from "../src/domain/sharing.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

export const stop = mutation({
  args: { taskId: v.id("callTasks") },
  returns: v.id("callTasks"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== userId) {
      const access = await ctx.db
        .query("taskAccess")
        .withIndex("by_task_user", (q) =>
          q.eq("taskUserKey", `${args.taskId}:${userId}`),
        )
        .unique();
      if (!access || !canPerformSharedTaskAction(access.permissionLevel, "edit")) {
        throw new ConvexError({ code: "FORBIDDEN" });
      }
    }
    if (task.retryControl) return args.taskId;
    const now = new Date().toISOString();
    await ctx.db.patch("callTasks", args.taskId, {
      revision: task.revision + 1,
      retryControl: {
        stoppedAt: now,
        stoppedByUserId: userId,
      },
      updatedAt: now,
    });
    return args.taskId;
  },
});
