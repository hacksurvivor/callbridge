import { internalMutationGeneric as internalMutation } from "convex/server";
import { ConvexError, v } from "convex/values";

import {
  type AttemptEvent,
  type CallResult,
  type HotelDemoQuestionId,
  type TaskActivityEvent,
} from "../shared/hotelDemoContracts.js";
import { hotelDemoCallResultValidator } from "./hotelDemoValidators.js";

function bounded(value: string, limit = 240): string {
  return [...value.trim()].slice(0, limit).join("");
}

function projectFact(questionId: HotelDemoQuestionId, events: AttemptEvent[]): CallResult["facts"][number] {
  const candidates = events.filter((event): event is Extract<AttemptEvent, { type: "fact_observed" }> => (
    event.type === "fact_observed" && event.publicPayload.questionId === questionId
  ));
  if (!candidates.length) return { questionId, status: "not_answered", value: null, evidence: null };
  const supportable = candidates.filter(({ publicPayload }) => (
    publicPayload.extractionConfidence >= 0.85
    && publicPayload.translationConfidence >= 0.85
    && publicPayload.sourceText.trim().length > 0
    && publicPayload.translatedValue.trim().length > 0
  ));
  const distinctValues = new Set(supportable.map(({ publicPayload }) => publicPayload.translatedValue.trim()));
  if (supportable.length !== candidates.length || distinctValues.size !== 1) {
    return { questionId, status: "ambiguous", value: null, evidence: null };
  }
  const evidence = supportable[0]!;
  return {
    questionId,
    status: "reported",
    value: bounded(evidence.publicPayload.translatedValue),
    evidence: { sourceEventId: evidence.eventId, sourceExcerpt: bounded(evidence.publicPayload.sourceText) },
  };
}

function outcomeFor(input: {
  taskStatus: string;
  terminalReason: CallResult["terminalReason"];
  facts: CallResult["facts"];
}): CallResult["outcome"] {
  if (input.taskStatus === "stopped") return "stopped";
  if (input.terminalReason === "no_answer") return "no_answer";
  if (input.terminalReason === "provider_failure") return "failed";
  if (input.terminalReason === "connected_timeout") {
    return input.facts.some(({ status }) => status !== "not_answered") ? "partial" : "failed";
  }
  return input.facts.every(({ status }) => status === "reported") ? "answered" : "partial";
}

export const projectResult = internalMutation({
  args: { taskId: v.id("hotelDemoTasks"), attemptId: v.id("hotelDemoAttempts") },
  returns: v.union(hotelDemoCallResultValidator, v.null()),
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("hotelDemoResults").withIndex("by_task", (q) => q.eq("taskId", args.taskId)).unique();
    if (existing) return existing.result;
    const [task, attempt] = await Promise.all([
      ctx.db.get("hotelDemoTasks", args.taskId),
      ctx.db.get("hotelDemoAttempts", args.attemptId),
    ]);
    if (!task || !attempt || attempt.taskId !== task._id) throw new ConvexError({ code: "NOT_FOUND" });
    if (!attempt.terminalAt || !attempt.terminalReason || !["ended", "failed", "cancelled", "timed_out"].includes(attempt.status)) {
      return null;
    }
    const storedEvents = await ctx.db.query("hotelDemoAttemptEvents").withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id)).collect();
    const events = storedEvents.filter(({ projected }) => projected).map(({ event }) => event);
    const facts: CallResult["facts"] = (task.questionIds as HotelDemoQuestionId[])
      .map((questionId) => projectFact(questionId, events));
    const violations = events.filter((event): event is Extract<AttemptEvent, { type: "policy_violation_detected" }> => event.type === "policy_violation_detected");
    const disclosureFailed = violations.some(({ publicPayload }) => publicPayload.category === "disclosure_failure");
    const disclosureDelivered = events.some((event) => event.type === "disclosure_delivered");
    const reportedSummary = facts
      .filter((fact): fact is typeof fact & { status: "reported"; value: string } => fact.status === "reported" && fact.value !== null)
      .map(({ questionId, value }) => `${questionId}: ${value}`)
      .join(" · ");
    const connectedAtMs = attempt.connectedAt ? new Date(attempt.connectedAt).getTime() : NaN;
    const terminalAtMs = new Date(attempt.terminalAt).getTime();
    const durationSeconds = Number.isFinite(connectedAtMs)
      ? Math.max(0, Math.round((terminalAtMs - connectedAtMs) / 1_000))
      : 0;
    const result: CallResult = {
      schemaVersion: 1,
      taskId: String(task._id),
      attemptId: String(attempt._id),
      outcome: outcomeFor({ taskStatus: task.status, terminalReason: attempt.terminalReason, facts }),
      sourceLanguage: "ja-JP",
      outputLanguage: "en",
      summary: reportedSummary ? bounded(reportedSummary, 500) : null,
      facts,
      durationSeconds,
      disclosureStatus: disclosureFailed ? "failed" : disclosureDelivered ? "delivered" : "not_observed",
      commitmentSafety: violations.length ? "possible_violation" : "none_observed",
      policyViolations: violations.map(({ eventId, publicPayload }) => ({
        eventId,
        description: bounded(`${publicPayload.category}: ${publicPayload.evidenceExcerpt}`),
      })),
      terminalReason: attempt.terminalReason,
      terminalAt: attempt.terminalAt,
    };
    await ctx.db.insert("hotelDemoResults", { taskId: task._id, attemptId: attempt._id, result, createdAt: new Date().toISOString() });
    const occurredAt = new Date().toISOString();
    const sequence = task.nextActivitySequence;
    const event: TaskActivityEvent = {
      schemaVersion: 1,
      eventId: `${String(task._id)}:${sequence}:result_ready`,
      taskId: String(task._id),
      type: "result_ready",
      occurredAt,
      source: "callbridge_server",
      publicPayload: { revision: task.revision },
    };
    await ctx.db.insert("hotelDemoActivityEvents", {
      taskId: task._id,
      activitySequence: sequence,
      projectedAt: occurredAt,
      gapBefore: false,
      event,
    });
    await ctx.db.patch("hotelDemoTasks", task._id, { resultState: "ready", nextActivitySequence: sequence + 1, updatedAt: occurredAt });
    return result;
  },
});
