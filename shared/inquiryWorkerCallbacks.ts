import type { InquiryCallResult } from "./inquiryState.js";

export const INQUIRY_WORKER_CALLBACK_SCHEMA_VERSION = 1 as const;
export const INQUIRY_WORKER_CALLBACK_MAX_BYTES = 96 * 1_024;

export const INQUIRY_WORKER_EVENT_TYPES = [
  "connected",
  "disclosure_delivered",
  "question_started",
  "answer_observed",
  "clarification_required",
  "recipient_declined",
  "call_ended",
] as const;

export type InquiryWorkerEventType = (typeof INQUIRY_WORKER_EVENT_TYPES)[number];

export type InquiryWorkerEventCallback = {
  schemaVersion: typeof INQUIRY_WORKER_CALLBACK_SCHEMA_VERSION;
  kind: "event";
  taskId: string;
  attemptId: string;
  eventId: string;
  workerSequence: number;
  type: InquiryWorkerEventType;
  questionId?: string;
  evidenceExcerpt?: string;
  occurredAt: string;
  executionRevision: string;
};

export type InquiryWorkerResultCallback = {
  schemaVersion: typeof INQUIRY_WORKER_CALLBACK_SCHEMA_VERSION;
  kind: "result";
  taskId: string;
  attemptId: string;
  resultKey: string;
  actualCostMinorUnits: number;
  costStatus: "provider_reported" | "pending";
  result: InquiryCallResult;
};

export type InquiryWorkerCostCallback = {
  schemaVersion: typeof INQUIRY_WORKER_CALLBACK_SCHEMA_VERSION;
  kind: "cost";
  taskId: string;
  attemptId: string;
  resultKey: string;
  settlementKey: string;
  actualCostMinorUnits: number;
};

export type InquiryWorkerCallback = InquiryWorkerEventCallback | InquiryWorkerResultCallback | InquiryWorkerCostCallback;
