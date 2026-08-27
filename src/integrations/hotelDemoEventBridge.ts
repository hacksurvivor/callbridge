import { createHmac, timingSafeEqual } from "node:crypto";

import { HOTEL_DEMO_MAX_EVENT_BYTES, type AttemptEvent } from "../../shared/hotelDemoContracts.js";

function signaturesMatch(expected: string, received: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(received)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(received, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function signHotelDemoEvent(input: { rawBody: string; secret: string; timestamp: string }): string {
  return createHmac("sha256", input.secret).update(`${input.timestamp}.${input.rawBody}`).digest("hex");
}

export function verifySignedHotelDemoEvent(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  secret: string;
  nowMs?: number;
}): AttemptEvent {
  if (!input.secret.trim()) throw new Error("Hotel demo webhook secret is not configured");
  if (!input.signature || !input.timestamp) throw new Error("Hotel demo webhook authentication is missing");
  if (!/^\d{10}$/.test(input.timestamp)) throw new Error("Hotel demo webhook timestamp is invalid");
  const timestampMs = Number(input.timestamp) * 1_000;
  const nowMs = input.nowMs ?? Date.now();
  if (!Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > 5 * 60 * 1_000) {
    throw new Error("Hotel demo webhook timestamp is outside the allowed window");
  }
  const expected = signHotelDemoEvent({ rawBody: input.rawBody, secret: input.secret, timestamp: input.timestamp });
  if (!signaturesMatch(expected, input.signature.trim())) throw new Error("Hotel demo webhook signature is invalid");
  let decoded: unknown;
  try {
    decoded = JSON.parse(input.rawBody);
  } catch {
    throw new Error("Hotel demo event is not valid JSON");
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || !("event" in decoded)) {
    throw new Error("Hotel demo event envelope is invalid");
  }
  const event = (decoded as { event: unknown }).event;
  if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("Hotel demo event is invalid");
  if (new TextEncoder().encode(JSON.stringify(event)).byteLength > HOTEL_DEMO_MAX_EVENT_BYTES) {
    throw new Error("Hotel demo event is too large");
  }
  const candidate = event as Partial<AttemptEvent>;
  if (candidate.schemaVersion !== 1 || candidate.source !== "telephony_worker" || typeof candidate.eventId !== "string") {
    throw new Error("Hotel demo event is invalid");
  }
  return event as AttemptEvent;
}
