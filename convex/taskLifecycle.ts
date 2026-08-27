import { internalMutationGeneric as internalMutation } from "convex/server";
import { ConvexError, v } from "convex/values";

import { retentionDeleteAt } from "../src/domain/retention.js";
function validInstant(value: string, label: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new ConvexError({ code: "VALIDATION_FAILED", message: `${label} is invalid` });
  return date;
}

function reviewPromptAt(checkOut: string): string {
  const checkoutDate = new Date(`${checkOut}T10:00:00.000Z`);
  if (Number.isNaN(checkoutDate.getTime())) throw new ConvexError({ code: "VALIDATION_FAILED", message: "Checkout date is invalid" });
  checkoutDate.setUTCDate(checkoutDate.getUTCDate() + 1);
  return checkoutDate.toISOString();
}

/** Provider-only completion gate. Results cannot bypass the confirmed task revision. */
export const completeOptionGathering = internalMutation({
  args: {
    jobId: v.id("optionGatheringJobs"),
    taskId: v.id("callTasks"),
    expectedRevision: v.number(),
    externalSessionId: v.string(),
    outcome: v.union(v.literal("success_update"), v.literal("decision_required")),
    summary: v.string(),
    completedAt: v.string(),
    transcript: v.optional(v.object({
      sourceLanguage: v.string(),
      targetLanguage: v.string(),
      translatedText: v.string(),
    })),
  },
  returns: v.id("callTasks"),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    const job = await ctx.db.get("optionGatheringJobs", args.jobId);
    if (!job || job.taskId !== args.taskId || job.ownerId !== task.ownerId) {
      throw new ConvexError({ code: "INVALID_JOB" });
    }
    if (job.state !== "dispatched" || job.externalSessionId !== args.externalSessionId) {
      throw new ConvexError({ code: "SESSION_MISMATCH" });
    }
    if (task.status !== "gathering_options") throw new ConvexError({ code: "INVALID_TRANSITION" });
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (!task.confirmation || task.confirmation.permissionScope !== "gather_options_only") {
      throw new ConvexError({ code: "CONFIRMATION_REQUIRED" });
    }
    const summary = args.summary.trim();
    if (!summary || summary.length > 500) throw new ConvexError({ code: "VALIDATION_FAILED", message: "Result summary is invalid" });
    if (args.transcript && (
      !args.transcript.translatedText.trim() ||
      args.transcript.translatedText.length > 100_000 ||
      !args.transcript.sourceLanguage.trim() ||
      !args.transcript.targetLanguage.trim()
    )) {
      throw new ConvexError({ code: "VALIDATION_FAILED", message: "Translated transcript is invalid" });
    }
    const completedAt = validInstant(args.completedAt, "Completion time");
    const checkOut = task.draft.dateResolution?.checkOut;
    const deleteAt = retentionDeleteAt({
      mode: task.draft.memory.mode,
      completedAt,
      ...(checkOut ? { endDate: checkOut } : {}),
    }).toISOString();
    const now = completedAt.toISOString();
    const lastEvent = await ctx.db
      .query("taskActivityEvents")
      .withIndex("by_task_sequence", (q) => q.eq("taskId", args.taskId))
      .order("desc")
      .first();
    const event = {
      kind: args.outcome === "decision_required" ? "decision_required" as const : "task_completed" as const,
      summary,
      ...(args.outcome === "decision_required" ? { actionLabel: "Review options" } : {}),
      source: "agent" as const,
      occurredAt: now,
    };
    await ctx.db.insert("taskActivityEvents", {
      taskId: args.taskId,
      sequence: (lastEvent?.sequence ?? 0) + 1,
      event,
    });
    const idempotencyKey = `task-result:${args.taskId}:${task.confirmation.confirmedRevision}`;
    const existingNotification = await ctx.db
      .query("notificationOutbox")
      .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();
    if (!existingNotification) {
      await ctx.db.insert("notificationOutbox", {
        ownerId: task.ownerId,
        taskId: args.taskId,
        kind: "task_result",
        idempotencyKey,
        title: args.outcome === "decision_required" ? "Decision needed" : "Task complete",
        body: summary,
        data: { type: "task_result", taskId: String(args.taskId), outcome: args.outcome },
        state: "pending",
        createdAt: now,
      });
    }
    if (args.transcript && task.draft.memory.mode === "save_for_30_days") {
      await ctx.db.insert("taskTranscripts", {
        taskId: args.taskId,
        ownerId: task.ownerId,
        sourceLanguage: args.transcript.sourceLanguage,
        targetLanguage: args.transcript.targetLanguage,
        translatedText: args.transcript.translatedText,
        createdAt: now,
        deleteAt,
      });
    }
    await ctx.db.patch("optionGatheringJobs", args.jobId, {
      state: "completed",
      updatedAt: now,
    });
    await ctx.db.patch("callTasks", args.taskId, {
      status: "options_ready",
      revision: task.revision + 1,
      execution: { externalSessionId: args.externalSessionId, startedAt: task.updatedAt },
      completedAt: now,
      retentionDeleteAt: deleteAt,
      ...(task.draft.category === "accommodation" && checkOut && task.draft.memory.mode === "save_for_30_days"
        ? { postStayReviewPromptAt: reviewPromptAt(checkOut) }
        : {}),
      updatedAt: now,
    });
    return args.taskId;
  },
});
