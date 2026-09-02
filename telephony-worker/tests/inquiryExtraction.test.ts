import { describe, expect, it, vi } from "vitest";

import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../../shared/inquiryFixtures.js";
import type { InquiryDispatchRequest } from "../../shared/inquiryDispatchContracts.js";
import {
  INQUIRY_EXTRACTION_PROMPT_VERSION,
  analyzeInquiryTranscript,
  buildInquiryExtractionRequest,
  responseOutputText,
} from "../src/inquiryExtraction.js";

const request: InquiryDispatchRequest = {
  taskId: "task-extraction",
  attemptId: "attempt-extraction",
  ownerId: "owner-extraction",
  confirmedRevision: 1,
  confirmedExecutionRevision: "inquiry-v1:sha256:extraction",
  dispatchIdempotencyKey: "dispatch-extraction",
  contract: HOTEL_INQUIRY_GOLDEN_FIXTURE,
};

describe("production inquiry extraction request", () => {
  it("is versioned, store-disabled, safety-scoped, and strict", () => {
    const payload = buildInquiryExtractionRequest({
      model: "gpt-5.4-mini",
      request,
      rawTranscript: "[Provider] Yes.",
      safetyIdentifier: "safe-user-hash",
    });
    expect(payload).toMatchObject({
      model: "gpt-5.4-mini",
      store: false,
      safety_identifier: "safe-user-hash",
      metadata: { prompt_version: INQUIRY_EXTRACTION_PROMPT_VERSION },
      text: { format: { type: "json_schema", strict: true } },
    });
    const systemText = (payload.input as Array<{ content: Array<{ text: string }> }>)[0]?.content[0]?.text;
    expect(systemText).toContain("Use ambiguous when the Provider hedges");
    expect(systemText).toContain("use the latest correction");
  });

  it("reads the top-level output helper and the raw HTTP fallback shape", () => {
    expect(responseOutputText({ output_text: "top-level" })).toBe("top-level");
    expect(responseOutputText({ output: [{ content: [{ type: "output_text", text: "nested" }] }] })).toBe("nested");
  });

  it("uses the exact production parser and never accepts unsupported evidence", async () => {
    const answers = request.contract.questions.map(({ id }, index) => index === 0
      ? { questionId: id, status: "reported", value: "Allowed.", sourceExcerpt: "Invented provider quote" }
      : { questionId: id, status: "not_answered", value: null, sourceExcerpt: null });
    const fetchImpl = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toMatchObject({ store: false, safety_identifier: "safe-user-hash" });
      expect(init?.headers).not.toHaveProperty("OpenAI-Safety-Identifier");
      return new Response(JSON.stringify({ output_text: JSON.stringify({
        answers,
        possibleCommitmentViolation: false,
        recipientRequestedNoFurtherCalls: false,
      }) }), { status: 200, headers: { "content-type": "application/json" } });
    });
    await expect(analyzeInquiryTranscript({
      apiKey: "test-key-never-sent",
      model: "gpt-5.4-mini",
      request,
      rawTranscript: "[Provider] Something else.",
      providerTurns: ["Something else."],
      safetyIdentifier: "safe-user-hash",
      fetchImpl,
    })).resolves.toBeNull();
  });
});
