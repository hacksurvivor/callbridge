import { z } from "zod";

import { validateInquiryDispatchRequest, type InquiryDispatchRequest } from "../../shared/inquiryDispatchContracts.js";

const responseSchema = z.discriminatedUnion("creationState", [
  z.object({
    creationState: z.literal("accepted"),
    externalCallId: z.string().trim().min(1).max(300),
  }),
  z.object({
    creationState: z.literal("definitely_not_created"),
    error: z.string().trim().min(1).max(300).optional(),
  }),
  z.object({
    creationState: z.literal("creation_uncertain"),
    error: z.string().trim().min(1).max(300).optional(),
  }),
]);

export type InquiryTelephonyDispatchOutcome =
  | { creationState: "accepted"; externalCallId: string }
  | { creationState: "definitely_not_created"; failureCode: string }
  | { creationState: "creation_uncertain"; failureCode: string };

function failureCode(value: string | undefined, fallback: string): string {
  const normalized = value
    ?.trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized || fallback;
}

function requireHttpsEndpoint(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Telephony dispatch URL must use HTTPS");
  if (url.username || url.password || url.hash) throw new Error("Telephony dispatch URL contains forbidden credentials or fragment");
  return url.toString();
}

export async function dispatchInquiryCall(input: {
  endpoint: string;
  apiKey: string;
  request: InquiryDispatchRequest;
  fetchImpl?: typeof fetch;
}): Promise<InquiryTelephonyDispatchOutcome> {
  let endpoint: string;
  let request: InquiryDispatchRequest;
  try {
    endpoint = requireHttpsEndpoint(input.endpoint);
    if (!input.apiKey.trim()) throw new Error("Telephony API key is missing");
    request = validateInquiryDispatchRequest(input.request);
  } catch (error) {
    return {
      creationState: "definitely_not_created",
      failureCode: failureCode(error instanceof Error ? error.message : undefined, "LOCAL_PREFLIGHT_FAILED"),
    };
  }

  let response: Response;
  try {
    response = await (input.fetchImpl ?? fetch)(endpoint, {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
        "idempotency-key": request.dispatchIdempotencyKey,
      },
      body: JSON.stringify(request),
    });
  } catch {
    return { creationState: "creation_uncertain", failureCode: "TELEPHONY_REQUEST_OUTCOME_UNKNOWN" };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { creationState: "creation_uncertain", failureCode: "TELEPHONY_RESPONSE_INVALID" };
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success) {
    return { creationState: "creation_uncertain", failureCode: "TELEPHONY_RESPONSE_INVALID" };
  }
  if (parsed.data.creationState === "accepted") {
    return { creationState: "accepted", externalCallId: parsed.data.externalCallId };
  }
  if (parsed.data.creationState === "definitely_not_created") {
    return {
      creationState: "definitely_not_created",
      failureCode: failureCode(parsed.data.error, `TELEPHONY_REJECTED_${response.status}`),
    };
  }
  return {
    creationState: "creation_uncertain",
    failureCode: failureCode(parsed.data.error, `TELEPHONY_UNCERTAIN_${response.status}`),
  };
}
