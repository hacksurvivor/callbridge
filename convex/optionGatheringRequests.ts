import { makeFunctionReference, mutationGeneric as mutation } from "convex/server";
import { ConvexError, v } from "convex/values";

const dispatchRef = makeFunctionReference<"action", { taskId: string; ownerId: string }, null>("optionGatheringWorker:dispatch");

export const requestStart = mutation({
  args: { taskId: v.id("callTasks") },
  returns: v.id("_scheduled_functions"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== identity.subject) throw new ConvexError({ code: "FORBIDDEN" });
    if (task.status !== "confirmed" || !task.confirmation) {
      throw new ConvexError({ code: "CONFIRMATION_REQUIRED" });
    }
    return await ctx.scheduler.runAfter(0, dispatchRef, { taskId: String(args.taskId), ownerId: task.ownerId });
  },
});
