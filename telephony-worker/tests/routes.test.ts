import { afterEach, describe, expect, it, vi } from "vitest";

import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../../shared/inquiryFixtures.js";
import type { InquiryDispatchRequest } from "../../shared/inquiryDispatchContracts.js";

vi.mock("cloudflare:workers", () => ({
  DurableObject: class {
    ctx: unknown;
    env: unknown;
    constructor(ctx: unknown, env: unknown) {
      this.ctx = ctx;
      this.env = env;
    }
  },
}));
const { CallSession, default: worker, scrubStoredRealtimeSnapshot } = await import("../src/index");

const request: InquiryDispatchRequest = {
  taskId: "task_route_1",
  attemptId: "attempt_route_1",
  ownerId: "user_route_1",
  confirmedRevision: 1,
  confirmedExecutionRevision: "inquiry-v1:sha256:route-fixture",
  dispatchIdempotencyKey: "dispatch_route_1",
  contract: HOTEL_INQUIRY_GOLDEN_FIXTURE,
};

function env(overrides: Record<string, unknown> = {}) {
  return {
    EXTERNAL_EFFECTS_ENABLED: "true",
    TWILIO_ACCOUNT_SID: "AC00000000000000000000000000000000",
    TWILIO_API_KEY: "SK00000000000000000000000000000001",
    TWILIO_API_KEY_SECRET: "voice-secret",
    TWILIO_CONTROL_API_KEY: "SK00000000000000000000000000000002",
    TWILIO_CONTROL_API_KEY_SECRET: "control-secret",
    TWILIO_FROM_NUMBER: "+12065550100",
    DISPATCH_API_KEY: "dispatch-secret",
    CALL_SESSIONS: {
      idFromName: vi.fn(() => "session-id"),
      get: vi.fn(() => ({
        configure: vi.fn(async () => ({
          streamToken: "stream-token",
          creationState: "configured" as const,
        })),
        beginCallCreation: vi.fn(async () => undefined),
        recordCallSid: vi.fn(async () => undefined),
        recordDefinitelyNotCreated: vi.fn(async () => undefined),
      })),
    },
    ...overrides,
  };
}

function pricingResponse(isoCountry = "JP") {
  return new Response(JSON.stringify({
    country: isoCountry === "JP" ? "Japan" : "Georgia",
    iso_country: isoCountry,
    outbound_call_prices: [{ current_price: "0.0746", friendly_name: "Programmable outbound minute" }],
    price_unit: "USD",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function dispatchRequest() {
  return new Request("https://worker.example/dispatch", {
    method: "POST",
    headers: {
      authorization: "Bearer dispatch-secret",
      "content-type": "application/json",
      "idempotency-key": request.dispatchIdempotencyKey,
    },
    body: JSON.stringify(request),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("telephony worker routes", () => {
  it("scrubs persisted transcript turns after alarm-based result delivery", () => {
    const scrubbed = scrubStoredRealtimeSnapshot({
      rawTurns: [{ speaker: "provider", text: "Do not retain this." }],
      rawTurnBytes: 19,
    } as never);
    expect(scrubbed).toMatchObject({ rawTurns: [], rawTurnBytes: 0 });
  });

  it("replays a staged result from an alarm and scrubs the stored transcript", async () => {
    let stored = {
      realtimeSnapshot: {
        rawTurns: [{ speaker: "provider", text: "Temporary evidence." }],
        rawTurnBytes: 19,
      },
      completionDelivered: false,
      pendingResultCallback: {
        schemaVersion: 1,
        kind: "result",
        taskId: "task_alarm",
        attemptId: "attempt_alarm",
        resultKey: "attempt_alarm:result",
        actualCostMinorUnits: 12,
        costStatus: "provider_reported",
        result: { schemaVersion: 1 },
      },
    };
    const storage = {
      get: vi.fn(async () => stored),
      put: vi.fn(async (_key: string, value: typeof stored) => { stored = value; }),
      setAlarm: vi.fn(async () => undefined),
      deleteAlarm: vi.fn(async () => undefined),
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("ok", { status: 200 })));
    const session = new CallSession({ storage } as never, {
      CALLBACK_URL: "https://convex.example/webhooks/inquiry-worker",
      CALLBACK_HMAC_SECRET: "callback-secret",
    } as never);
    await session.alarm();
    expect(stored).toMatchObject({
      completionDelivered: true,
      realtimeSnapshot: { rawTurns: [], rawTurnBytes: 0 },
    });
    expect(stored.pendingResultCallback).toBeUndefined();
    expect(storage.deleteAlarm).toHaveBeenCalledOnce();
  });

  it("returns a transparent authenticated destination quote", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pricingResponse()));
    const response = await worker.fetch(new Request("https://worker.example/pricing-quote", {
      method: "POST",
      headers: { authorization: "Bearer dispatch-secret", "content-type": "application/json" },
      body: JSON.stringify({
        to: request.contract.destination.e164PhoneNumber,
        maximumConnectedSeconds: request.contract.policy.maxConnectedSeconds,
      }),
    }), env() as never);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      provider: "twilio",
      destination: { isoCountry: "JP" },
      policy: { riskTier: "low_risk_only", provisioning: "just_in_time" },
      quote: { source: "twilio_voice_number_pricing_api_v2" },
    });
  });

  it("short-circuits dispatch while external effects are disabled", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(dispatchRequest(), env({ EXTERNAL_EFFECTS_ENABLED: "false" }) as never);
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      creationState: "definitely_not_created",
      error: "external_effects_disabled",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails before session creation when the provider resolves a different country", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => pricingResponse("GE")));
    const environment = env();
    const response = await worker.fetch(dispatchRequest(), environment as never);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      creationState: "definitely_not_created",
      error: "destination_country_mismatch",
    });
    expect(environment.CALL_SESSIONS.get).not.toHaveBeenCalled();
  });

  it("fails closed before call creation when low-risk permission cannot be verified", async () => {
    const fetchMock = vi.fn(async (resource: RequestInfo | URL) => {
      const url = String(resource);
      if (url.includes("pricing.twilio.com")) return pricingResponse();
      if (url.includes("DialingPermissions/Countries/JP")) {
        return new Response(JSON.stringify({ message: "permission denied" }), { status: 403 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(dispatchRequest(), env() as never);
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      creationState: "definitely_not_created",
      error: expect.stringContaining("twilio_geo_permission_read_failed"),
    });
    expect(fetchMock.mock.calls.some(([resource]) => String(resource).includes("Calls.json"))).toBe(false);
  });

  it("treats a successful Twilio response without a call SID as creation uncertain", async () => {
    const fetchMock = vi.fn(async (resource: RequestInfo | URL) => {
      const url = String(resource);
      if (url.includes("pricing.twilio.com")) return pricingResponse();
      if (url.includes("DialingPermissions/Countries/JP")) {
        return new Response(JSON.stringify({
          iso_code: "JP",
          low_risk_numbers_enabled: true,
          high_risk_special_numbers_enabled: false,
          high_risk_tollfraud_numbers_enabled: false,
        }), { status: 200 });
      }
      if (url.includes("Calls.json")) {
        return new Response(JSON.stringify({ status: "queued" }), { status: 201 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const response = await worker.fetch(dispatchRequest(), env() as never);
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      creationState: "creation_uncertain",
      error: "provider_creation_outcome_requires_reconciliation",
    });
  });
});
