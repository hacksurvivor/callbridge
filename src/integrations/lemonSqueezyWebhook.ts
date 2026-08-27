import { createHash, createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { LemonSqueezyEntitlementEvent } from "./ports.js";

const subscriptionEventSchema = z.object({
  meta: z.object({
    event_name: z.enum([
      "subscription_created",
      "subscription_updated",
      "subscription_cancelled",
      "subscription_expired",
    ]),
    custom_data: z.object({ user_id: z.string().trim().min(1) }),
  }),
  data: z.object({
    id: z.union([z.string(), z.number()]),
    attributes: z.object({
      customer_id: z.union([z.string(), z.number()]),
      variant_id: z.union([z.string(), z.number()]).optional(),
      status: z.string().trim().min(1),
      renews_at: z.string().nullable().optional(),
      ends_at: z.string().nullable().optional(),
    }),
  }),
});

function sameSignature(expected: string, received: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(received)) return false;
  const expectedBytes = Buffer.from(expected, "hex");
  const receivedBytes = Buffer.from(received, "hex");
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}

export function verifyAndParseLemonSqueezyWebhook(input: {
  rawBody: Uint8Array;
  signature: string | null;
  secret: string;
}): LemonSqueezyEntitlementEvent {
  if (!input.secret.trim()) throw new Error("Lemon Squeezy webhook secret is not configured");
  if (!input.signature) throw new Error("Lemon Squeezy signature is missing");
  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  if (!sameSignature(expected, input.signature.trim())) {
    throw new Error("Lemon Squeezy signature is invalid");
  }

  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    throw new Error("Lemon Squeezy payload is not valid JSON");
  }
  const parsed = subscriptionEventSchema.safeParse(body);
  if (!parsed.success) throw new Error("Lemon Squeezy payload is invalid");
  const { meta, data } = parsed.data;
  return {
    eventId: createHash("sha256").update(input.rawBody).digest("hex"),
    eventName: meta.event_name,
    externalCustomerId: String(data.attributes.customer_id),
    externalSubscriptionId: String(data.id),
    status: data.attributes.status,
    plan: data.attributes.variant_id === undefined ? null : String(data.attributes.variant_id),
    renewsAt: data.attributes.renews_at ?? null,
    endsAt: data.attributes.ends_at ?? null,
    userId: meta.custom_data.user_id,
  };
}
