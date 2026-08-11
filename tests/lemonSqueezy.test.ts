import { describe, expect, it, vi } from "vitest";

import { processLemonSqueezyWebhook } from "../src/integrations/lemonSqueezy.js";
import type {
  EntitlementEventStore,
  EntitlementWebhookVerifier,
  LemonSqueezyEntitlementEvent,
} from "../src/integrations/ports.js";

const event: LemonSqueezyEntitlementEvent = {
  eventId: "event_123",
  eventName: "subscription_updated",
  externalCustomerId: "customer_123",
  externalSubscriptionId: "subscription_123",
  status: "active",
  renewsAt: "2026-09-11T00:00:00.000Z",
  endsAt: null,
  userId: "user_123",
};

describe("Lemon Squeezy webhook boundary", () => {
  it("verifies before applying and leaves idempotency to the event store", async () => {
    const verifier: EntitlementWebhookVerifier = { verifyAndParse: vi.fn(async () => event) };
    const store: EntitlementEventStore = { applyOnce: vi.fn(async () => "duplicate" as const) };
    await expect(
      processLemonSqueezyWebhook(verifier, store, {
        rawBody: new TextEncoder().encode("{}"),
        signature: "signature",
      }),
    ).resolves.toBe("duplicate");
    expect(store.applyOnce).toHaveBeenCalledWith(event);
  });

  it("does not persist an event when signature verification fails", async () => {
    const verifier: EntitlementWebhookVerifier = {
      verifyAndParse: vi.fn(async () => {
        throw new Error("invalid signature");
      }),
    };
    const store: EntitlementEventStore = { applyOnce: vi.fn(async () => "applied" as const) };
    await expect(
      processLemonSqueezyWebhook(verifier, store, {
        rawBody: new TextEncoder().encode("{}"),
        signature: null,
      }),
    ).rejects.toThrow("invalid signature");
    expect(store.applyOnce).not.toHaveBeenCalled();
  });
});
