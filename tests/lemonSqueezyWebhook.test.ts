import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyAndParseLemonSqueezyWebhook } from "../src/integrations/lemonSqueezyWebhook.js";

const secret = "test-secret";
const body = JSON.stringify({
  meta: { event_name: "subscription_updated", custom_data: { user_id: "user_123" } },
  data: {
    id: 42,
    attributes: {
      customer_id: 7,
      variant_id: 99,
      status: "active",
      renews_at: "2026-09-11T00:00:00.000Z",
      ends_at: null,
    },
  },
});

function signature(value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

describe("Lemon Squeezy HTTP webhook verifier", () => {
  it("verifies the untouched body and maps a subscription event", () => {
    const event = verifyAndParseLemonSqueezyWebhook({
      rawBody: new TextEncoder().encode(body),
      signature: signature(body),
      secret,
    });
    expect(event).toMatchObject({
      eventName: "subscription_updated",
      externalCustomerId: "7",
      externalSubscriptionId: "42",
      plan: "99",
      userId: "user_123",
    });
    expect(event.eventId).toHaveLength(64);
  });

  it("rejects invalid signatures before parsing", () => {
    expect(() => verifyAndParseLemonSqueezyWebhook({
      rawBody: new TextEncoder().encode("not-json"),
      signature: "0".repeat(64),
      secret,
    })).toThrow("signature is invalid");
  });

  it("rejects unsupported or malformed payloads", () => {
    const malformed = JSON.stringify({ meta: { event_name: "order_created", custom_data: {} }, data: {} });
    expect(() => verifyAndParseLemonSqueezyWebhook({
      rawBody: new TextEncoder().encode(malformed),
      signature: signature(malformed),
      secret,
    })).toThrow("payload is invalid");
  });
});
