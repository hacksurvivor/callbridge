import {
  internalMutationGeneric as internalMutation,
  internalQueryGeneric as internalQuery,
} from "convex/server";
import { ConvexError, v } from "convex/values";

const dueJobValidator = v.object({
  jobId: v.id("optionGatheringJobs"),
  taskId: v.id("callTasks"),
  ownerId: v.string(),
});

export const listDueRetries = internalQuery({
  args: { now: v.string(), limit: v.number() },
  returns: v.array(dueJobValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(50, Math.floor(args.limit)));
    const jobs = await ctx.db
      .query("optionGatheringJobs")
      .withIndex("by_state_next_attempt", (q) => q.eq("state", "retryable"))
      .take(limit * 3);
    return jobs
      .filter(({ nextAttemptAt }) => nextAttemptAt !== undefined && nextAttemptAt <= args.now)
      .slice(0, limit)
      .map(({ _id, taskId, ownerId }) => ({ jobId: _id, taskId, ownerId }));
  },
});

export const markDispatched = internalMutation({
  args: {
    jobId: v.id("optionGatheringJobs"),
    externalSessionId: v.string(),
    now: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("optionGatheringJobs", args.jobId);
    if (!job) throw new ConvexError({ code: "NOT_FOUND" });
    if (job.state === "completed" || job.state === "dispatched") return null;
    const task = await ctx.db.get("callTasks", job.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.status !== "gathering_options" || task.revision !== job.reservedRevision) {
      throw new ConvexError({ code: "STALE_REVISION" });
    }
    await ctx.db.patch("optionGatheringJobs", args.jobId, {
      state: "dispatched",
      attemptCount: job.attemptCount + 1,
      nextAttemptAt: undefined,
      externalSessionId: args.externalSessionId,
      failureReason: undefined,
      updatedAt: args.now,
    });
    await ctx.db.patch("callTasks", job.taskId, {
      execution: { externalSessionId: args.externalSessionId, startedAt: args.now },
      updatedAt: args.now,
    });
    return null;
  },
});

export const markRetryableFailure = internalMutation({
  args: { jobId: v.id("optionGatheringJobs"), now: v.string() },
  returns: v.union(v.literal("retryable"), v.literal("failed")),
  handler: async (ctx, args) => {
    const job = await ctx.db.get("optionGatheringJobs", args.jobId);
    if (!job) throw new ConvexError({ code: "NOT_FOUND" });
    if (job.state === "completed" || job.state === "dispatched") return "failed" as const;
    const attemptCount = job.attemptCount + 1;
    if (attemptCount >= 3) {
      await ctx.db.patch("optionGatheringJobs", args.jobId, {
        state: "failed",
        attemptCount,
        nextAttemptAt: undefined,
        failureReason: "dispatch_failed",
        updatedAt: args.now,
      });
      await ctx.db.patch("callTasks", job.taskId, {
        status: "failed",
        failureReason: "The calling provider could not be reached after safe retries.",
        updatedAt: args.now,
      });
      return "failed" as const;
    }
    const nextAttemptAt = new Date(new Date(args.now).getTime() + 5 * 60 * 1000).toISOString();
    await ctx.db.patch("optionGatheringJobs", args.jobId, {
      state: "retryable",
      attemptCount,
      nextAttemptAt,
      failureReason: "dispatch_failed",
      updatedAt: args.now,
    });
    return "retryable" as const;
  },
});

export const recordBlockedStart = internalMutation({
  args: { taskId: v.id("callTasks"), ownerId: v.string(), now: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task || task.ownerId !== args.ownerId) return null;
    const last = await ctx.db.query("taskActivityEvents")
      .withIndex("by_task_sequence", (q) => q.eq("taskId", args.taskId)).order("desc").first();
    if (last?.event.kind === "warning" && last.event.summary === "Live calling is not configured yet.") return null;
    await ctx.db.insert("taskActivityEvents", {
      taskId: args.taskId,
      sequence: (last?.sequence ?? 0) + 1,
      event: { kind: "warning", summary: "Live calling is not configured yet.", source: "system", occurredAt: args.now },
    });
    return null;
  },
});
