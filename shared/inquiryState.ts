import type { InquiryCallContract, InquiryExecutionRevision } from "./inquiryContracts.js";
import type { InquiryPricingState } from "./inquiryPricing.js";

export const INQUIRY_TASK_STATUSES = [
  "draft",
  "awaiting_confirmation",
  "confirmed",
  "in_progress",
  "completed",
  "partial",
  "failed",
  "stopped",
] as const;

export const INQUIRY_ATTEMPT_STATUSES = [
  "queued",
  "dialing",
  "connected",
  "ending",
  "ended",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export const INQUIRY_DISPATCH_STATES = [
  "pending",
  "leased",
  "accepted",
  "definitely_not_created",
  "creation_uncertain",
] as const;

export const INQUIRY_RESULT_OUTCOMES = [
  "answered",
  "partial",
  "no_answer",
  "failed",
  "stopped",
] as const;

export const INQUIRY_EVENT_TYPES = [
  "draft_created",
  "draft_updated",
  "confirmation_ready",
  "confirmation_revoked",
  "confirmed",
  "credit_reserved",
  "attempt_queued",
  "dispatch_uncertain",
  "dispatch_failed",
  "dispatch_reconciled",
  "dialing",
  "connected",
  "disclosure_delivered",
  "question_started",
  "answer_observed",
  "clarification_required",
  "recipient_declined",
  "end_requested",
  "call_ended",
  "result_ready",
] as const;

export type InquiryTaskStatus = (typeof INQUIRY_TASK_STATUSES)[number];
export type InquiryAttemptStatus = (typeof INQUIRY_ATTEMPT_STATUSES)[number];
export type InquiryDispatchState = (typeof INQUIRY_DISPATCH_STATES)[number];
export type InquiryResultOutcome = (typeof INQUIRY_RESULT_OUTCOMES)[number];
export type InquiryEventType = (typeof INQUIRY_EVENT_TYPES)[number];

export type InquiryCallResult = {
  schemaVersion: 1;
  executionRevision: InquiryExecutionRevision;
  outcome: InquiryResultOutcome;
  summary: string | null;
  answers: Array<{
    questionId: string;
    status: "reported" | "not_answered" | "ambiguous";
    value: string | null;
    evidence: { sourceEventId: string; sourceExcerpt: string } | null;
  }>;
  unresolvedQuestionIds: string[];
  durationSeconds: number;
  disclosureStatus: "delivered" | "not_observed" | "failed";
  commitmentSafety: "none_observed" | "possible_violation";
  terminalReason:
    | "completed"
    | "remote_hangup"
    | "no_answer"
    | "provider_failure"
    | "user_cancelled"
    | "user_ended"
    | "connected_timeout"
    | "recipient_declined";
  terminalAt: string;
};

export type InquiryTaskSnapshot = {
  taskId: string;
  status: InquiryTaskStatus;
  revision: number;
  executionRevision: InquiryExecutionRevision;
  contract: InquiryCallContract;
  confirmation: {
    state: "not_ready" | "ready" | "confirmed" | "revoked" | "expired";
    intentId: string | null;
    expiresAt: string | null;
    confirmedExecutionRevision: InquiryExecutionRevision | null;
  };
  resultState: "not_ready" | "processing" | "ready" | "failed";
  pricing: InquiryPricingState;
  createdAt: string;
  updatedAt: string;
};
