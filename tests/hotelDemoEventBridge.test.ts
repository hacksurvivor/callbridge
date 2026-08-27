import { describe, expect, it } from "vitest";

import { signHotelDemoEvent, verifySignedHotelDemoEvent } from "../src/integrations/hotelDemoEventBridge.js";

const event = {
  schemaVersion: 1,
  eventId: "attempt_1:1:connected",
  taskId: "task_1",
  attemptId: "attempt_1",
  workerSequence: 1,
  observedAt: "2026-08-26T06:00:00.000Z",
  source: "telephony_worker",
  type: "connected",
  publicPayload: {},
} as const;

describe("signed hotel demo event bridge", () => {
  it("authenticates the timestamped body and returns the event envelope", () => {
    const secret = "hotel-demo-callback-secret";
    const timestamp = "1787724000";
    const rawBody = JSON.stringify({ event });
    const signature = signHotelDemoEvent({ rawBody, secret, timestamp });
    expect(verifySignedHotelDemoEvent({ rawBody, signature, timestamp, secret, nowMs: Number(timestamp) * 1_000 })).toEqual(event);
  });

  it("rejects replayed timestamps, bad signatures, and oversized events", () => {
    const secret = "hotel-demo-callback-secret";
    const timestamp = "1787724000";
    const rawBody = JSON.stringify({ event });
    const signature = signHotelDemoEvent({ rawBody, secret, timestamp });
    expect(() => verifySignedHotelDemoEvent({ rawBody, signature, timestamp, secret, nowMs: Number(timestamp) * 1_000 + 300_001 })).toThrow("outside");
    expect(() => verifySignedHotelDemoEvent({ rawBody, signature: "0".repeat(64), timestamp, secret, nowMs: Number(timestamp) * 1_000 })).toThrow("signature");

    const oversizedBody = JSON.stringify({ event: { ...event, publicPayload: { code: "x".repeat(5_000) } } });
    const oversizedSignature = signHotelDemoEvent({ rawBody: oversizedBody, secret, timestamp });
    expect(() => verifySignedHotelDemoEvent({ rawBody: oversizedBody, signature: oversizedSignature, timestamp, secret, nowMs: Number(timestamp) * 1_000 })).toThrow("too large");
  });
});
