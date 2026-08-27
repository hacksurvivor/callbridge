import { describe, expect, it } from "vitest";

import type { InquiryWorkerCallback } from "../shared/inquiryWorkerCallbacks.js";
import {
  signInquiryWorkerCallback,
  verifyInquiryWorkerCallback,
} from "../src/integrations/inquiryWorkerCallback.js";

const timestamp = "1787792400";
const nowMs = Number(timestamp) * 1_000;
const secret = "inquiry-worker-secret";

function callback(): InquiryWorkerCallback {
  return {
    schemaVersion: 1,
    kind: "event",
    taskId: "task_1",
    attemptId: "attempt_1",
    eventId: "attempt_1:connected",
    workerSequence: 1,
    type: "connected",
    occurredAt: "2026-08-27T05:00:00.000Z",
    executionRevision: "inquiry-v1:sha256:test",
  };
}

describe("inquiry worker callback authentication", () => {
  it("accepts a bounded timestamped callback and rejects tampering", () => {
    const rawBody = JSON.stringify(callback());
    const signature = signInquiryWorkerCallback({ rawBody, secret, timestamp });
    expect(verifyInquiryWorkerCallback({ rawBody, signature, timestamp, secret, nowMs })).toEqual(callback());
    expect(() => verifyInquiryWorkerCallback({
      rawBody: `${rawBody} `,
      signature,
      timestamp,
      secret,
      nowMs,
    })).toThrow("signature is invalid");
  });

  it("rejects replay-window drift and guessed pending cost", () => {
    const rawBody = JSON.stringify(callback());
    const signature = signInquiryWorkerCallback({ rawBody, secret, timestamp });
    expect(() => verifyInquiryWorkerCallback({ rawBody, signature, timestamp, secret, nowMs: nowMs + 300_001 })).toThrow("outside the allowed window");

    const pending = JSON.stringify({
      schemaVersion: 1,
      kind: "result",
      taskId: "task_1",
      attemptId: "attempt_1",
      resultKey: "attempt_1:result",
      actualCostMinorUnits: 10,
      costStatus: "pending",
      result: {
        schemaVersion: 1,
        executionRevision: "inquiry-v1:sha256:test",
        outcome: "no_answer",
        summary: null,
        answers: [],
        unresolvedQuestionIds: [],
        durationSeconds: 0,
        disclosureStatus: "not_observed",
        commitmentSafety: "none_observed",
        terminalReason: "no_answer",
        terminalAt: "2026-08-27T05:00:00.000Z",
      },
    });
    expect(() => verifyInquiryWorkerCallback({
      rawBody: pending,
      signature: signInquiryWorkerCallback({ rawBody: pending, secret, timestamp }),
      timestamp,
      secret,
      nowMs,
    })).toThrow("must not settle a guessed amount");
  });
});
