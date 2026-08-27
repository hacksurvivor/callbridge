import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import type { OptionGatheringRequest } from "./ports.js";

const dispatchResponseSchema = z.object({
  externalSessionId: z.string().trim().min(1).max(300),
});

const callbackSchema = z.object({
  jobId: z.string().trim().min(1),
  taskId: z.string().trim().min(1),
  expectedRevision: z.number().int().positive(),
  externalSessionId: z.string().trim().min(1),
  outcome: z.enum(["success_update", "decision_required"]),
  summary: z.string().trim().min(1).max(500),
  completedAt: z.string().datetime({ offset: true }),
  transcript: z.object({
    sourceLanguage: z.string().trim().min(2).max(35),
    targetLanguage: z.string().trim().min(2).max(35),
    translatedText: z.string().trim().min(1).max(100_000),
  }).optional(),
});

export type TelephonyCompletionCallback = z.infer<typeof callbackSchema>;

function requireHttpsEndpoint(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Telephony dispatch URL is invalid");
  }
  if (url.protocol !== "https:") throw new Error("Telephony dispatch URL must use HTTPS");
  if (url.username || url.password || url.hash) throw new Error("Telephony dispatch URL contains forbidden credentials or fragment");
  return url.toString();
}

export async function dispatchOptionGathering(input: {
  endpoint: string;
  apiKey: string;
  idempotencyKey: string;
  jobId: string;
  expectedRevision: number;
  request: OptionGatheringRequest;
  fetchImpl?: typeof fetch;
}): Promise<{ externalSessionId: string }> {
  const endpoint = requireHttpsEndpoint(input.endpoint);
  if (!input.apiKey.trim()) throw new Error("Telephony API key is missing");
  if (!input.idempotencyKey.trim()) throw new Error("Telephony idempotency key is missing");
  if (input.request.capability !== "gather_options_only") throw new Error("Unsupported telephony capability");
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey}`,
      "content-type": "application/json",
      "idempotency-key": input.idempotencyKey,
    },
    body: JSON.stringify({
      ...input.request,
      dispatch: { jobId: input.jobId, expectedRevision: input.expectedRevision },
    }),
  });
  if (!response.ok) throw new Error(`Telephony dispatch failed with status ${response.status}`);
  const parsed = dispatchResponseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Telephony dispatch response is invalid");
  return parsed.data;
}

function signaturesMatch(expected: string, received: string): boolean {
  if (!/^[a-f\d]{64}$/i.test(received)) return false;
  const left = Buffer.from(expected, "hex");
  const right = Buffer.from(received, "hex");
  return left.length === right.length && timingSafeEqual(left, right);
}

export function verifyTelephonyCallback(input: {
  rawBody: Uint8Array;
  signature: string | null;
  secret: string;
}): TelephonyCompletionCallback {
  if (!input.secret.trim()) throw new Error("Telephony webhook secret is not configured");
  if (!input.signature) throw new Error("Telephony webhook signature is missing");
  const expected = createHmac("sha256", input.secret).update(input.rawBody).digest("hex");
  if (!signaturesMatch(expected, input.signature.trim())) throw new Error("Telephony webhook signature is invalid");
  let body: unknown;
  try {
    body = JSON.parse(new TextDecoder().decode(input.rawBody));
  } catch {
    throw new Error("Telephony callback is not valid JSON");
  }
  const parsed = callbackSchema.safeParse(body);
  if (!parsed.success) throw new Error("Telephony callback is invalid");
  return parsed.data;
}
