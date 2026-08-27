import {
  internalActionGeneric as internalAction,
  internalMutationGeneric as internalMutation,
  internalQueryGeneric as internalQuery,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";

import { purgeTaskDraft } from "../src/domain/taskDataPurge.js";
const listOwnersRef = makeFunctionReference<"query", {}, string[]>("maintenance:listMorningBriefOwners");
const prepareBriefRef = makeFunctionReference<
  "mutation",
  { ownerId: string; now: string; since: string; commitments: [] },
  | { kind: "skipped"; reason: string }
  | { kind: "duplicate"; deliveryId: string }
  | { kind: "prepared"; deliveryId: string; deliveryKey: string; ownerId: string; payload: any }
>("morningBriefDeliveries:prepareForUser");
const enqueueBriefRef = makeFunctionReference<
  "mutation",
  { ownerId: string; deliveryId: string; deliveryKey: string; payload: any; now: string },
  string
>("notificationOutbox:enqueueMorningBrief");
const markBriefQueuedRef = makeFunctionReference<
  "mutation",
  { deliveryId: string; ownerId: string; notificationId: string },
  "queued" | "duplicate"
>("morningBriefDeliveries:markQueued");
const purgeRef = makeFunctionReference<"mutation", { now: string; limit: number }, number>("maintenance:purgeExpiredTaskData");
const reviewRef = makeFunctionReference<"mutation", { now: string; limit: number }, number>("maintenance:queueDuePostStayReviews");
const dueRetriesRef = makeFunctionReference<
  "query",
  { now: string; limit: number },
  Array<{ jobId: string; taskId: string; ownerId: string }>
>("optionGatheringJobs:listDueRetries");
const dispatchRef = makeFunctionReference<"action", { taskId: string; ownerId: string }, null>("optionGatheringWorker:dispatch");
const dispatchNotificationsRef = makeFunctionReference<
  "action",
  {},
  { delivered: number; blocked: number; failed: number }
>("notificationWorker:dispatchPending");
const purgeMessageDraftsRef = makeFunctionReference<
  "mutation",
  { now: string; limit: number },
  number
>("messageDrafts:purgeExpired");

export const listMorningBriefOwners = internalQuery({
  args: {},
  returns: v.array(v.string()),
  handler: async (ctx) => {
    const preferences = await ctx.db.query("communicationPreferences").collect();
    return [...new Set(preferences.map(({ userId }) => userId))];
  },
});

export const purgeExpiredTaskData = internalMutation({
  args: { now: v.string(), limit: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = new Date(args.now);
    if (Number.isNaN(now.getTime())) throw new Error("Maintenance time is invalid");
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    const tasks = await ctx.db
      .query("callTasks")
      .withIndex("by_retention_delete_at", (q) => q.lte("retentionDeleteAt", now.toISOString()))
      .take(limit);
    let purged = 0;
    for (const task of tasks) {
      if (!task.retentionDeleteAt || task.purgedAt) continue;
      const [events, disclosures, findings, reviews, notifications, transcripts] = await Promise.all([
        ctx.db.query("taskActivityEvents").withIndex("by_task_sequence", (q) => q.eq("taskId", task._id)).collect(),
        ctx.db.query("sensitiveDisclosureConsents").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect(),
        ctx.db.query("proactiveFindings").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect(),
        ctx.db.query("postStayReviews").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect(),
        ctx.db.query("notificationOutbox").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect(),
        ctx.db.query("taskTranscripts").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect(),
      ]);
      await Promise.all([
        ...events.map(({ _id }) => ctx.db.delete("taskActivityEvents", _id)),
        ...disclosures.map(({ _id }) => ctx.db.delete("sensitiveDisclosureConsents", _id)),
        ...findings.map(({ _id }) => ctx.db.delete("proactiveFindings", _id)),
        ...reviews.map(({ _id }) => ctx.db.delete("postStayReviews", _id)),
        ...notifications.map(({ _id }) => ctx.db.delete("notificationOutbox", _id)),
        ...transcripts.map(({ _id }) => ctx.db.delete("taskTranscripts", _id)),
      ]);
      await ctx.db.patch("callTasks", task._id, {
        draft: purgeTaskDraft(task.draft),
        cancellation: undefined,
        execution: undefined,
        failureReason: undefined,
        postStayReviewPromptAt: undefined,
        purgedAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
      purged += 1;
    }
    return purged;
  },
});

export const queueDuePostStayReviews = internalMutation({
  args: { now: v.string(), limit: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = new Date(args.now);
    if (Number.isNaN(now.getTime())) throw new Error("Maintenance time is invalid");
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    const tasks = await ctx.db
      .query("callTasks")
      .withIndex("by_post_stay_review_prompt_at", (q) => q.lte("postStayReviewPromptAt", now.toISOString()))
      .take(limit);
    let queued = 0;
    for (const task of tasks) {
      if (!task.postStayReviewPromptAt || task.postStayReviewPromptQueuedAt || task.purgedAt) continue;
      const idempotencyKey = `post-stay-review:${task._id}`;
      const existing = await ctx.db
        .query("notificationOutbox")
        .withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", idempotencyKey))
        .unique();
      if (!existing) {
        await ctx.db.insert("notificationOutbox", {
          ownerId: task.ownerId,
          taskId: task._id,
          kind: "post_stay_review",
          idempotencyKey,
          title: "How was your stay?",
          body: "Add a short private review or skip it.",
          data: { type: "post_stay_review", taskId: String(task._id) },
          state: "pending",
          createdAt: now.toISOString(),
        });
      }
      await ctx.db.patch("callTasks", task._id, { postStayReviewPromptQueuedAt: now.toISOString() });
      queued += 1;
    }
    return queued;
  },
});

export const runTick = internalAction({
  args: {},
  returns: v.object({
    ownersChecked: v.number(),
    briefsQueued: v.number(),
    briefFailures: v.number(),
    tasksPurged: v.number(),
    messageDraftsPurged: v.number(),
    reviewPromptsQueued: v.number(),
    optionGatheringRetriesScheduled: v.number(),
    notificationDispatchScheduled: v.boolean(),
  }),
  handler: async (ctx) => {
    const now = new Date();
    const nowIso = now.toISOString();
    const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
    const tasksPurged = await ctx.runMutation(purgeRef, { now: nowIso, limit: 100 });
    const messageDraftsPurged = await ctx.runMutation(purgeMessageDraftsRef, { now: nowIso, limit: 100 });
    const reviewPromptsQueued = await ctx.runMutation(reviewRef, { now: nowIso, limit: 100 });
    const dueRetries = await ctx.runQuery(dueRetriesRef, { now: nowIso, limit: 50 });
    for (const retry of dueRetries) {
      await ctx.scheduler.runAfter(0, dispatchRef, { taskId: retry.taskId, ownerId: retry.ownerId });
    }
    await ctx.scheduler.runAfter(0, dispatchNotificationsRef, {});
    const owners = await ctx.runQuery(listOwnersRef, {});
    let briefsQueued = 0;
    let briefFailures = 0;
    for (const ownerId of owners) {
      try {
        const preparation = await ctx.runMutation(prepareBriefRef, { ownerId, now: nowIso, since, commitments: [] });
        if (preparation.kind !== "prepared") continue;
        const notificationId = await ctx.runMutation(enqueueBriefRef, {
          ownerId,
          deliveryId: preparation.deliveryId,
          deliveryKey: preparation.deliveryKey,
          payload: preparation.payload,
          now: nowIso,
        });
        await ctx.runMutation(markBriefQueuedRef, {
          deliveryId: preparation.deliveryId,
          ownerId,
          notificationId,
        });
        briefsQueued += 1;
      } catch {
        briefFailures += 1;
      }
    }
    return {
      ownersChecked: owners.length,
      briefsQueued,
      briefFailures,
      tasksPurged,
      messageDraftsPurged,
      reviewPromptsQueued,
      optionGatheringRetriesScheduled: dueRetries.length,
      notificationDispatchScheduled: true,
    };
  },
});
