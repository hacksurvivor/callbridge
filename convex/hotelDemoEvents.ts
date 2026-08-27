import { internalMutationGeneric as internalMutation, makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import {
  HOTEL_DEMO_MAX_DISPLAY_UTF8_BYTES,
  HOTEL_DEMO_MAX_EVENT_BYTES,
  HOTEL_DEMO_MAX_PUBLIC_ATTEMPT_EVENTS,
  type AttemptEvent,
} from "../shared/hotelDemoContracts.js";
import { hotelDemoAttemptEventValidator } from "./hotelDemoValidators.js";

const projectBufferedEventRef = makeFunctionReference<"mutation", { storedEventId: string }, null>("hotelDemoEvents:projectBufferedEvent");
const projectResultRef = makeFunctionReference<"mutation", { taskId: string; attemptId: string }, unknown>("hotelDemoResults:projectResult");

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function boundedPublicText(value: string): string {
  const redacted = value
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted email]")
    .replace(/\+?\d[\d .()-]{7,}\d/g, "[redacted phone]")
    .replace(/\b(?:sk|pk|api|token)_[A-Za-z0-9_-]{8,}\b/gi, "[redacted credential]");
  let result = "";
  for (const character of redacted.trim()) {
    if (utf8Bytes(result + character) > HOTEL_DEMO_MAX_DISPLAY_UTF8_BYTES) break;
    result += character;
  }
  return result;
}

function redactEvent(event: AttemptEvent): AttemptEvent {
  const clone = structuredClone(event) as AttemptEvent;
  if (clone.type === "fact_observed") {
    clone.publicPayload.sourceText = boundedPublicText(clone.publicPayload.sourceText);
    clone.publicPayload.translatedValue = boundedPublicText(clone.publicPayload.translatedValue);
  } else if (clone.type === "policy_violation_detected") {
    clone.publicPayload.evidenceExcerpt = boundedPublicText(clone.publicPayload.evidenceExcerpt);
  } else if (clone.type === "failed") {
    clone.publicPayload.code = boundedPublicText(clone.publicPayload.code);
  }
  return clone;
}

function validateEventShape(event: AttemptEvent, receivedAt: string, taskQuestionIds: readonly string[]): AttemptEvent {
  if (!Number.isInteger(event.workerSequence) || event.workerSequence < 1 || event.workerSequence > 10_000) {
    throw new ConvexError({ code: "VALIDATION_FAILED" });
  }
  if (!event.eventId.trim() || event.eventId.length > 128) throw new ConvexError({ code: "VALIDATION_FAILED" });
  const observedAt = new Date(event.observedAt).getTime();
  const receivedAtMs = new Date(receivedAt).getTime();
  if (!Number.isFinite(observedAt) || !Number.isFinite(receivedAtMs) || Math.abs(receivedAtMs - observedAt) > 24 * 60 * 60 * 1_000) {
    throw new ConvexError({ code: "VALIDATION_FAILED" });
  }
  if ((event.type === "fact_observed" || event.type === "question_started") && !taskQuestionIds.includes(event.publicPayload.questionId)) {
    throw new ConvexError({ code: "DEMO_POLICY_DENIED" });
  }
  if (event.type === "fact_observed" && (
    event.publicPayload.extractionConfidence < 0 || event.publicPayload.extractionConfidence > 1
    || event.publicPayload.translationConfidence < 0 || event.publicPayload.translationConfidence > 1
  )) throw new ConvexError({ code: "VALIDATION_FAILED" });
  const redacted = redactEvent(event);
  if (utf8Bytes(JSON.stringify(redacted)) > HOTEL_DEMO_MAX_EVENT_BYTES) throw new ConvexError({ code: "VALIDATION_FAILED" });
  return redacted;
}

async function applyEventTransition(ctx: { db: any; scheduler: any }, task: any, attempt: any, event: AttemptEvent): Promise<void> {
  if (task.resultState === "ready") return;
  if (event.type === "connected" && task.status === "in_progress" && attempt.status === "dialing") {
    await ctx.db.patch("hotelDemoAttempts", attempt._id, { status: "connected", connectedAt: event.observedAt, updatedAt: event.observedAt });
    return;
  }
  if (event.type === "failed" && !["completed", "failed", "stopped"].includes(task.status)) {
    await ctx.db.patch("hotelDemoAttempts", attempt._id, {
      status: "failed",
      terminalAt: event.observedAt,
      terminalReason: "provider_failure",
      updatedAt: event.observedAt,
    });
    await ctx.db.patch("hotelDemoTasks", task._id, { status: "failed", resultState: "processing", updatedAt: event.observedAt });
    await ctx.scheduler.runAfter(5_000, projectResultRef, { taskId: String(task._id), attemptId: String(attempt._id) });
    return;
  }
  if (event.type !== "ended" || ["ended", "failed", "cancelled", "timed_out"].includes(attempt.status)) return;
  const wasStopped = task.status === "stopped";
  const wasTimedOut = task.status === "failed" || event.publicPayload.reason === "connected_timeout";
  const taskStatus = wasStopped ? "stopped" : wasTimedOut ? "failed" : "completed";
  const attemptStatus = wasTimedOut ? "timed_out" : "ended";
  const terminalReason = wasStopped
    ? "user_ended"
    : wasTimedOut
      ? "connected_timeout"
      : event.publicPayload.reason === "remote_hangup"
        ? "remote_hangup"
        : "completed";
  await ctx.db.patch("hotelDemoAttempts", attempt._id, {
    status: attemptStatus,
    terminalAt: event.observedAt,
    terminalReason,
    updatedAt: event.observedAt,
  });
  await ctx.db.patch("hotelDemoTasks", task._id, { status: taskStatus, resultState: "processing", updatedAt: event.observedAt });
  await ctx.scheduler.runAfter(5_000, projectResultRef, { taskId: String(task._id), attemptId: String(attempt._id) });
}

async function projectOne(ctx: { db: any; scheduler: any }, stored: any, gapBefore: boolean): Promise<void> {
  if (stored.projected || stored.rejectionReason) return;
  const [task, attempt] = await Promise.all([
    ctx.db.get("hotelDemoTasks", stored.taskId),
    ctx.db.get("hotelDemoAttempts", stored.attemptId),
  ]);
  if (!task || !attempt) return;
  if (task.resultState === "ready") {
    await ctx.db.patch("hotelDemoAttemptEvents", stored._id, { rejectionReason: "late_after_result" });
    return;
  }
  if (attempt.publicEventCount >= HOTEL_DEMO_MAX_PUBLIC_ATTEMPT_EVENTS) {
    await ctx.db.patch("hotelDemoAttemptEvents", stored._id, { rejectionReason: "event_cap" });
    return;
  }
  const sequence = task.nextActivitySequence;
  await ctx.db.insert("hotelDemoActivityEvents", {
    taskId: task._id,
    activitySequence: sequence,
    projectedAt: new Date().toISOString(),
    gapBefore,
    event: stored.event,
  });
  await ctx.db.patch("hotelDemoAttemptEvents", stored._id, { projected: true });
  await ctx.db.patch("hotelDemoTasks", task._id, { nextActivitySequence: sequence + 1 });
  await ctx.db.patch("hotelDemoAttempts", attempt._id, {
    publicEventCount: attempt.publicEventCount + 1,
    nextWorkerSequence: Math.max(attempt.nextWorkerSequence, stored.workerSequence + 1),
  });
  await applyEventTransition(ctx, task, attempt, stored.event);
}

async function projectContiguous(ctx: { db: any; scheduler: any }, attemptId: any): Promise<void> {
  for (let count = 0; count < HOTEL_DEMO_MAX_PUBLIC_ATTEMPT_EVENTS; count += 1) {
    const attempt = await ctx.db.get("hotelDemoAttempts", attemptId);
    if (!attempt) return;
    const next = await ctx.db.query("hotelDemoAttemptEvents")
      .withIndex("by_attempt_sequence", (q: any) => q.eq("attemptId", attemptId).eq("workerSequence", attempt.nextWorkerSequence))
      .unique();
    if (!next || next.projected || next.rejectionReason) return;
    await projectOne(ctx, next, false);
  }
}

export const ingestAttemptEvent = internalMutation({
  args: { event: hotelDemoAttemptEventValidator, receivedAt: v.string() },
  returns: v.union(v.literal("accepted"), v.literal("duplicate"), v.literal("buffered"), v.literal("private_only")),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("hotelDemoAttemptEvents").withIndex("by_event_id", (q) => q.eq("eventId", args.event.eventId)).unique();
    if (existing) return "duplicate" as const;
    const [task, attempt] = await Promise.all([
      ctx.db.get("hotelDemoTasks", args.event.taskId as any),
      ctx.db.get("hotelDemoAttempts", args.event.attemptId as any),
    ]);
    if (!task || !attempt || attempt.taskId !== task._id) throw new ConvexError({ code: "NOT_FOUND" });
    const sequenceKey = `${String(attempt._id)}:${args.event.workerSequence}`;
    const sequenceCollision = await ctx.db.query("hotelDemoAttemptEvents").withIndex("by_attempt_sequence_key", (q) => q.eq("attemptSequenceKey", sequenceKey)).unique();
    if (sequenceCollision) throw new ConvexError({ code: "VALIDATION_FAILED" });
    const event = validateEventShape(args.event, args.receivedAt, task.questionIds);
    const privateOnly = task.resultState === "ready" || attempt.publicEventCount >= HOTEL_DEMO_MAX_PUBLIC_ATTEMPT_EVENTS;
    const storedId = await ctx.db.insert("hotelDemoAttemptEvents", {
      taskId: task._id,
      attemptId: attempt._id,
      eventId: event.eventId,
      attemptSequenceKey: sequenceKey,
      workerSequence: event.workerSequence,
      receivedAt: args.receivedAt,
      projected: false,
      ...(privateOnly ? { rejectionReason: task.resultState === "ready" ? "late_after_result" as const : "event_cap" as const } : {}),
      event,
    });
    if (privateOnly) return "private_only" as const;
    const stored = await ctx.db.get("hotelDemoAttemptEvents", storedId);
    if (!stored) throw new ConvexError({ code: "INTERNAL_ERROR" });
    if (event.workerSequence > attempt.nextWorkerSequence) {
      await ctx.scheduler.runAfter(2_000, projectBufferedEventRef, { storedEventId: String(storedId) });
      return "buffered" as const;
    }
    await projectOne(ctx, stored, event.workerSequence < attempt.nextWorkerSequence);
    await projectContiguous(ctx, attempt._id);
    return "accepted" as const;
  },
});

export const projectBufferedEvent = internalMutation({
  args: { storedEventId: v.id("hotelDemoAttemptEvents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const stored = await ctx.db.get("hotelDemoAttemptEvents", args.storedEventId);
    if (!stored || stored.projected || stored.rejectionReason) return null;
    await projectOne(ctx, stored, true);
    await projectContiguous(ctx, stored.attemptId);
    return null;
  },
});
