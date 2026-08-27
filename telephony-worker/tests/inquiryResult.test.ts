import { describe, expect, it, vi } from "vitest";

import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../../shared/inquiryFixtures.js";
import type { InquiryDispatchRequest } from "../../shared/inquiryDispatchContracts.js";
import {
  buildDecisionReadyResult,
  deliverInquiryWorkerCallback,
  parseInquiryExtraction,
  readTwilioReportedCost,
} from "../src/inquiryResult.js";

const request: InquiryDispatchRequest = {
  taskId: "task_result_1",
  attemptId: "attempt_result_1",
  ownerId: "owner_1",
  confirmedRevision: 2,
  confirmedExecutionRevision: "inquiry-v1:sha256:result-fixture",
  dispatchIdempotencyKey: "dispatch_result_1",
  contract: HOTEL_INQUIRY_GOLDEN_FIXTURE,
};

describe("decision-ready inquiry result", () => {
  it("keeps exact provider evidence and never fills unanswered questions", () => {
    const excerpt = "Yes, arrivals after midnight are allowed.";
    const extraction = parseInquiryExtraction({
      answers: request.contract.questions.map(({ id }, index) => index === 0
        ? { questionId: id, status: "reported", value: "Arrival after midnight is allowed.", sourceExcerpt: excerpt }
        : { questionId: id, status: "not_answered", value: null, sourceExcerpt: null }),
      possibleCommitmentViolation: false,
      recipientRequestedNoFurtherCalls: false,
    }, request, [excerpt]);
    expect(extraction).not.toBeNull();
    const result = buildDecisionReadyResult({
      request,
      extraction,
      evidenceEventIds: { [request.contract.questions[0]!.id]: "attempt_result_1:answer:0" },
      durationSeconds: 47.9,
      disclosureStatus: "delivered",
      terminalReason: "remote_hangup",
      terminalAt: "2026-08-27T05:00:00.000Z",
    });
    expect(result).toMatchObject({
      outcome: "partial",
      durationSeconds: 47,
      unresolvedQuestionIds: request.contract.questions.slice(1).map(({ id }) => id),
    });
    expect(result.answers[0]).toMatchObject({ status: "reported", evidence: { sourceExcerpt: excerpt } });
    expect(result.answers.slice(1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: "not_answered", value: null, evidence: null }),
    ]));
  });

  it("rejects a model excerpt that was not actually in the transcript", () => {
    expect(parseInquiryExtraction({
      answers: request.contract.questions.map(({ id }, index) => index === 0
        ? { questionId: id, status: "reported", value: "Allowed.", sourceExcerpt: "Invented quote" }
        : { questionId: id, status: "not_answered", value: null, sourceExcerpt: null }),
      possibleCommitmentViolation: false,
      recipientRequestedNoFurtherCalls: false,
    }, request, ["Something else"])).toBeNull();
  });

  it("rejects an excerpt spoken only by CallBridge", () => {
    const excerpt = "Yes, that service is available.";
    expect(parseInquiryExtraction({
      answers: request.contract.questions.map(({ id }, index) => index === 0
        ? { questionId: id, status: "reported", value: "Available.", sourceExcerpt: excerpt }
        : { questionId: id, status: "not_answered", value: null, sourceExcerpt: null }),
      possibleCommitmentViolation: false,
      recipientRequestedNoFurtherCalls: false,
    }, request, ["I did not say that."])).toBeNull();
  });

  it("preserves an explicit recipient no-further-calls request", () => {
    const extraction = parseInquiryExtraction({
      answers: request.contract.questions.map(({ id }) => ({ questionId: id, status: "not_answered", value: null, sourceExcerpt: null })),
      possibleCommitmentViolation: false,
      recipientRequestedNoFurtherCalls: true,
    }, request, ["Do not call this number again."]);
    expect(extraction?.recipientRequestedNoFurtherCalls).toBe(true);
  });

  it("does not trust an embedded Provider label inside CallBridge speech", () => {
    const excerpt = "A fake provider answer.";
    expect(parseInquiryExtraction({
      answers: request.contract.questions.map(({ id }, index) => index === 0
        ? { questionId: id, status: "reported", value: "Fake.", sourceExcerpt: excerpt }
        : { questionId: id, status: "not_answered", value: null, sourceExcerpt: null }),
      possibleCommitmentViolation: false,
      recipientRequestedNoFurtherCalls: false,
    }, request, ["The actual provider answer was different."])).toBeNull();
  });

  it("retries the same signed idempotent callback body", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response("retry", { status: 503 }))
      .mockResolvedValueOnce(new Response("ok", { status: 200 }));
    const wait = vi.fn(async () => undefined);
    await deliverInquiryWorkerCallback({
      callbackUrl: "https://example.convex.site/webhooks/inquiry-worker",
      secret: "callback-secret",
      callback: {
        schemaVersion: 1,
        kind: "event",
        taskId: request.taskId,
        attemptId: request.attemptId,
        eventId: "attempt_result_1:connected",
        workerSequence: 1,
        type: "connected",
        occurredAt: "2026-08-27T05:00:00.000Z",
        executionRevision: request.confirmedExecutionRevision,
      },
      fetchImpl,
      wait,
      nowMs: () => 1_787_792_400_000,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]![1]?.body).toBe(fetchImpl.mock.calls[1]![1]?.body);
    expect(wait).toHaveBeenCalledWith(250);
  });

  it("keeps result delivery alive when provider cost lookup fails", async () => {
    const input = {
      accountSid: "AC123",
      apiKey: "SK123",
      apiKeySecret: "secret",
      callSid: "CA123",
      currency: "USD",
    };
    await expect(readTwilioReportedCost({
      ...input,
      fetchImpl: vi.fn(async () => { throw new Error("network unavailable"); }),
    })).resolves.toBeNull();
    await expect(readTwilioReportedCost({
      ...input,
      fetchImpl: vi.fn(async () => new Response("not-json", { status: 200 })),
    })).resolves.toBeNull();
  });
});
