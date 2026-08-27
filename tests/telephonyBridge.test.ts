import { createHmac } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { dispatchOptionGathering, verifyTelephonyCallback } from "../src/integrations/telephonyBridge.js";
import { completeDraft } from "./fixtures.js";

const request = {
  taskId: "task_1",
  ownerId: "user_1",
  draft: completeDraft(),
  confirmation: { confirmedAt: "2026-08-13T00:00:00.000Z", confirmedRevision: 2 },
  runtime: { provider: "openai_realtime", model: "test-model" },
  capability: "gather_options_only" as const,
  forbiddenActions: ["book", "pay", "accept_terms", "irreversible_commitment", "cancel"] as const,
};

describe("telephony bridge", () => {
  it("dispatches only over HTTPS with an idempotency key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ externalSessionId: "session_1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(dispatchOptionGathering({
      endpoint: "https://telephony.example/dispatch",
      apiKey: "secret",
      idempotencyKey: "task_1:2",
      jobId: "job_1",
      expectedRevision: 3,
      request,
      fetchImpl,
    })).resolves.toEqual({ externalSessionId: "session_1" });
    expect(fetchImpl).toHaveBeenCalledWith("https://telephony.example/dispatch", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "idempotency-key": "task_1:2" }),
    }));
  });

  it("rejects insecure endpoints before dispatch", async () => {
    const fetchImpl = vi.fn();
    await expect(dispatchOptionGathering({
      endpoint: "http://telephony.example/dispatch",
      apiKey: "secret",
      idempotencyKey: "task_1:2",
      jobId: "job_1",
      expectedRevision: 3,
      request,
      fetchImpl,
    })).rejects.toThrow("HTTPS");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("verifies and validates completion callbacks", () => {
    const secret = "callback-secret";
    const body = JSON.stringify({
      jobId: "job_1",
      taskId: "task_1",
      expectedRevision: 3,
      externalSessionId: "session_1",
      outcome: "decision_required",
      summary: "Two verified options are ready.",
      completedAt: "2026-08-13T01:00:00.000Z",
      transcript: { sourceLanguage: "th", targetLanguage: "en", translatedText: "Translated call" },
    });
    const signature = createHmac("sha256", secret).update(body).digest("hex");
    expect(verifyTelephonyCallback({ rawBody: new TextEncoder().encode(body), signature, secret })).toMatchObject({
      jobId: "job_1",
      outcome: "decision_required",
    });
  });
});
