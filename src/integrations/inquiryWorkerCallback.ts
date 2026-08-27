import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import {
  INQUIRY_WORKER_CALLBACK_MAX_BYTES,
  type InquiryWorkerCallback,
} from "../../shared/inquiryWorkerCallbacks.js";

const answerSchema = z.object({
  questionId: z.string().trim().min(1).max(128),
  status: z.enum(["reported", "not_answered", "ambiguous"]),
  value: z.string().trim().min(1).max(2_000).nullable(),
  evidence: z.object({
    sourceEventId: z.string().trim().min(1).max(200),
    sourceExcerpt: z.string().trim().min(1).max(1_000),
  }).nullable(),
});

const resultSchema = z.object({
  schemaVersion: z.literal(1),
  executionRevision: z.string().trim().min(1).max(200),
  outcome: z.enum(["answered", "partial", "no_answer", "failed", "stopped"]),
  summary: z.string().trim().min(1).max(4_000).nullable(),
  answers: z.array(answerSchema).max(20),
  unresolvedQuestionIds: z.array(z.string().trim().min(1).max(128)).max(20),
  durationSeconds: z.number().int().nonnegative().max(900),
  disclosureStatus: z.enum(["delivered", "not_observed", "failed"]),
  commitmentSafety: z.enum(["none_observed", "possible_violation"]),
  terminalReason: z.enum([
    "completed",
    "remote_hangup",
    "no_answer",
    "provider_failure",
    "user_cancelled",
    "user_ended",
    "connected_timeout",
    "recipient_declined",
  ]),
  terminalAt: z.string().datetime({ offset: true }),
});

const callbackSchema = z.discriminatedUnion("kind", [
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("event"),
    taskId: z.string().trim().min(1).max(128),
    attemptId: z.string().trim().min(1).max(128),
    eventId: z.string().trim().min(1).max(200),
    workerSequence: z.number().int().positive().max(64),
    type: z.enum(["connected", "disclosure_delivered", "question_started", "answer_observed", "clarification_required", "recipient_declined", "call_ended"]),
    questionId: z.string().trim().min(1).max(128).optional(),
    evidenceExcerpt: z.string().trim().min(1).max(1_000).optional(),
    occurredAt: z.string().datetime({ offset: true }),
    executionRevision: z.string().trim().min(1).max(200),
  }),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("result"),
    taskId: z.string().trim().min(1).max(128),
    attemptId: z.string().trim().min(1).max(128),
    resultKey: z.string().trim().min(1).max(200),
    actualCostMinorUnits: z.number().int().nonnegative(),
    costStatus: z.enum(["provider_reported", "pending"]),
    result: resultSchema,
  }),
  z.object({
    schemaVersion: z.literal(1),
    kind: z.literal("cost"),
    taskId: z.string().trim().min(1).max(128),
    attemptId: z.string().trim().min(1).max(128),
    resultKey: z.string().trim().min(1).max(200),
    settlementKey: z.string().trim().min(1).max(200),
    actualCostMinorUnits: z.number().int().nonnegative(),
  }),
]);

function signaturesMatch(expected: string, received: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(received)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(received, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signInquiryWorkerCallback(input: { rawBody: string; secret: string; timestamp: string }): string {
  return createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
}

export function verifyInquiryWorkerCallback(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowMs?: number;
}): InquiryWorkerCallback {
  if (!input.secret.trim()) throw new Error("Inquiry worker webhook secret is not configured");
  if (!input.signature || !input.timestamp) throw new Error("Inquiry worker webhook authentication is missing");
  if (!/^\d{10}$/.test(input.timestamp)) throw new Error("Inquiry worker webhook timestamp is invalid");
  if (new TextEncoder().encode(input.rawBody).byteLength > INQUIRY_WORKER_CALLBACK_MAX_BYTES) {
    throw new Error("Inquiry worker callback is too large");
  }
  const timestampMs = Number(input.timestamp) * 1_000;
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1_000) {
    throw new Error("Inquiry worker webhook timestamp is outside the allowed window");
  }
  const expected = signInquiryWorkerCallback({ rawBody: input.rawBody, secret: input.secret, timestamp: input.timestamp });
  if (!signaturesMatch(expected, input.signature.trim())) throw new Error("Inquiry worker webhook signature is invalid");
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.rawBody);
  } catch {
    throw new Error("Inquiry worker callback is not valid JSON");
  }
  const parsed = callbackSchema.safeParse(decoded);
  if (!parsed.success) throw new Error("Inquiry worker callback is invalid");
  if (parsed.data.kind === "result" && parsed.data.costStatus === "pending" && parsed.data.actualCostMinorUnits !== 0) {
    throw new Error("Pending provider cost must not settle a guessed amount");
  }
  return parsed.data as InquiryWorkerCallback;
}
