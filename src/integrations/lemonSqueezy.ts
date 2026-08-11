import type {
  EntitlementEventStore,
  EntitlementWebhookVerifier,
} from "./ports.js";

/** Verification happens before persistence; an invalid signature cannot reach the store. */
export async function processLemonSqueezyWebhook(
  verifier: EntitlementWebhookVerifier,
  store: EntitlementEventStore,
  input: { rawBody: Uint8Array; signature: string | null },
): Promise<"applied" | "duplicate"> {
  const event = await verifier.verifyAndParse(input);
  return store.applyOnce(event);
}
export function isActiveSubscriptionStatus(status: string): boolean {
  return status === "active" || status === "on_trial";
}
