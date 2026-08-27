import { describe, expect, it, vi } from "vitest";

import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../shared/inquiryFixtures.js";
import { dispatchInquiryCall } from "../src/integrations/inquiryTelephonyBridge.js";
import type { InquiryDispatchRequest } from "../shared/inquiryDispatchContracts.js";

const request: InquiryDispatchRequest = {
  taskId: "task_1",
  attemptId: "attempt_1",
  ownerId: "user_1",
  confirmedRevision: 2,
  confirmedExecutionRevision: "inquiry-v1:sha256:fixture",
  dispatchIdempotencyKey: "dispatch_1",
  contract: HOTEL_INQUIRY_GOLDEN_FIXTURE,
};

describe("general inquiry telephony bridge", () => {
  it("sends the frozen inquiry contract with its dispatch idempotency key", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({
      creationState: "accepted",
      externalCallId: "CA_1",
    }), { status: 201, headers: { "content-type": "application/json" } }));
    await expect(dispatchInquiryCall({
      endpoint: "https://telephony.example/dispatch",
      apiKey: "secret",
      request,
      fetchImpl,
    })).resolves.toEqual({ creationState: "accepted", externalCallId: "CA_1" });
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith("https://telephony.example/dispatch", expect.objectContaining({
      method: "POST",
      headers: expect.objectContaining({ "idempotency-key": "dispatch_1" }),
      body: JSON.stringify(request),
    }));
  });

  it("classifies local preflight failures as definitely not created without sending", async () => {
    const fetchImpl = vi.fn();
    await expect(dispatchInquiryCall({
      endpoint: "http://telephony.example/dispatch",
      apiKey: "secret",
      request,
      fetchImpl,
    })).resolves.toMatchObject({ creationState: "definitely_not_created" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("treats transport failures and malformed replies as creation-uncertain", async () => {
    await expect(dispatchInquiryCall({
      endpoint: "https://telephony.example/dispatch",
      apiKey: "secret",
      request,
      fetchImpl: vi.fn(async () => { throw new Error("timeout"); }),
    })).resolves.toEqual({
      creationState: "creation_uncertain",
      failureCode: "TELEPHONY_REQUEST_OUTCOME_UNKNOWN",
    });
    await expect(dispatchInquiryCall({
      endpoint: "https://telephony.example/dispatch",
      apiKey: "secret",
      request,
      fetchImpl: vi.fn(async () => new Response("not-json", { status: 502 })),
    })).resolves.toEqual({
      creationState: "creation_uncertain",
      failureCode: "TELEPHONY_RESPONSE_INVALID",
    });
  });

  it("preserves the worker's explicit definitely-absent response", async () => {
    await expect(dispatchInquiryCall({
      endpoint: "https://telephony.example/dispatch",
      apiKey: "secret",
      request,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        creationState: "definitely_not_created",
        error: "twilio rejected before creation",
      }), { status: 422 })),
    })).resolves.toEqual({
      creationState: "definitely_not_created",
      failureCode: "TWILIO_REJECTED_BEFORE_CREATION",
    });
  });
});
