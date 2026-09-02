import { describe, expect, it } from "vitest";

import type { GetInquiryResultOutput, InquiryActivityEvent } from "../../shared/inquiryWebMcp.js";
import {
  mergeInquiryActivity,
  nextRefreshFailureCount,
  shouldStopInquiryPolling,
} from "../src/submissionRuntime.js";

function event(eventId: string, sequence: number): InquiryActivityEvent {
  return {
    eventId,
    sequence,
    type: "connected",
    source: "telephony_worker",
    revision: 1,
    executionRevision: "inquiry-v1:sha256:test",
    occurredAt: "2026-09-02T00:00:00.000Z",
  };
}

const readyResult = {
  status: "ready",
  result: {
    schemaVersion: 1,
    executionRevision: "inquiry-v1:sha256:test",
    outcome: "failed",
    summary: null,
    answers: [],
    unresolvedQuestionIds: [],
    durationSeconds: 0,
    disclosureStatus: "failed",
    commitmentSafety: "none_observed",
    terminalReason: "provider_failure",
    terminalAt: "2026-09-02T00:00:00.000Z",
  },
  receipt: {
    schemaVersion: 1,
    taskId: "task_test",
    attemptId: "attempt_test",
    executionRevision: "inquiry-v1:sha256:test",
    outcome: "failed",
    callLanguage: "ro",
    resultLanguage: "en",
    answeredQuestionIds: [],
    unresolvedQuestionIds: [],
    sourceEventIds: [],
    durationSeconds: 0,
    terminalReason: "provider_failure",
    disclosureStatus: "failed",
    commitmentSafety: "none_observed",
    terminalAt: "2026-09-02T00:00:00.000Z",
    cost: { currency: "USD", status: "pending", actualMinorUnits: null },
  },
} satisfies GetInquiryResultOutput;

describe("submission runtime", () => {
  it("merges cursor pages by immutable event id and sequence", () => {
    expect(mergeInquiryActivity([event("two", 2), event("one", 1)], [event("two", 2), event("three", 3)]))
      .toEqual([event("one", 1), event("two", 2), event("three", 3)]);
  });

  it("degrades only after two cycles where neither authoritative read succeeds", () => {
    expect(nextRefreshFailureCount(0, 0)).toBe(1);
    expect(nextRefreshFailureCount(1, 0)).toBe(2);
    expect(nextRefreshFailureCount(2, 1)).toBe(0);
  });

  it("stops polling only when a terminal task also has a ready receipt", () => {
    expect(shouldStopInquiryPolling("in_progress", readyResult)).toBe(false);
    expect(shouldStopInquiryPolling("completed", { status: "processing", retryAfterMs: 500 })).toBe(false);
    expect(shouldStopInquiryPolling("partial", readyResult)).toBe(true);
    expect(shouldStopInquiryPolling("failed", readyResult)).toBe(true);
    expect(shouldStopInquiryPolling("stopped", readyResult)).toBe(true);
  });
});
