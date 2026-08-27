import { v } from "convex/values";

export const inquiryTaskStatusValidator = v.union(
  v.literal("draft"),
  v.literal("awaiting_confirmation"),
  v.literal("confirmed"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("partial"),
  v.literal("failed"),
  v.literal("stopped"),
);

export const inquiryAttemptStatusValidator = v.union(
  v.literal("queued"),
  v.literal("dialing"),
  v.literal("connected"),
  v.literal("ending"),
  v.literal("ended"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("timed_out"),
);

export const inquiryDispatchStateValidator = v.union(
  v.literal("pending"),
  v.literal("leased"),
  v.literal("accepted"),
  v.literal("definitely_not_created"),
  v.literal("creation_uncertain"),
);

export const inquiryEventTypeValidator = v.union(
  v.literal("draft_created"),
  v.literal("draft_updated"),
  v.literal("confirmation_ready"),
  v.literal("confirmation_revoked"),
  v.literal("confirmed"),
  v.literal("credit_reserved"),
  v.literal("attempt_queued"),
  v.literal("dispatch_uncertain"),
  v.literal("dispatch_failed"),
  v.literal("dispatch_reconciled"),
  v.literal("dialing"),
  v.literal("connected"),
  v.literal("disclosure_delivered"),
  v.literal("question_started"),
  v.literal("answer_observed"),
  v.literal("clarification_required"),
  v.literal("recipient_declined"),
  v.literal("end_requested"),
  v.literal("call_ended"),
  v.literal("result_ready"),
);

export const inquiryCallResultValidator = v.object({
  schemaVersion: v.literal(1),
  executionRevision: v.string(),
  outcome: v.union(
    v.literal("answered"),
    v.literal("partial"),
    v.literal("no_answer"),
    v.literal("failed"),
    v.literal("stopped"),
  ),
  summary: v.union(v.string(), v.null()),
  answers: v.array(v.object({
    questionId: v.string(),
    status: v.union(v.literal("reported"), v.literal("not_answered"), v.literal("ambiguous")),
    value: v.union(v.string(), v.null()),
    evidence: v.union(
      v.object({ sourceEventId: v.string(), sourceExcerpt: v.string() }),
      v.null(),
    ),
  })),
  unresolvedQuestionIds: v.array(v.string()),
  durationSeconds: v.number(),
  disclosureStatus: v.union(v.literal("delivered"), v.literal("not_observed"), v.literal("failed")),
  commitmentSafety: v.union(v.literal("none_observed"), v.literal("possible_violation")),
  terminalReason: v.union(
    v.literal("completed"),
    v.literal("remote_hangup"),
    v.literal("no_answer"),
    v.literal("provider_failure"),
    v.literal("user_cancelled"),
    v.literal("user_ended"),
    v.literal("connected_timeout"),
    v.literal("recipient_declined"),
  ),
  terminalAt: v.string(),
});
