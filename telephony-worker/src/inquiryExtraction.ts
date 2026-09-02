import type { InquiryDispatchRequest } from "../../shared/inquiryDispatchContracts.js";
import { parseInquiryExtraction, type InquiryExtraction } from "./inquiryResult.js";

export const INQUIRY_EXTRACTION_PROMPT_VERSION = "inquiry-result-v1" as const;

export function formatInquiryTranscript(turns: readonly { speaker: "provider" | "callbridge"; text: string }[]): string {
  return turns
    .map(({ speaker, text }) => `${speaker === "provider" ? "Provider" : "CallBridge"}: ${text}`)
    .join("\n")
    .slice(0, 80_000);
}

type ResponseEnvelope = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
};

export function inquiryExtractionSchema(request: InquiryDispatchRequest): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    required: ["answers", "possibleCommitmentViolation", "recipientRequestedNoFurtherCalls"],
    properties: {
      answers: {
        type: "array",
        minItems: request.contract.questions.length,
        maxItems: request.contract.questions.length,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["questionId", "status", "value", "sourceExcerpt"],
          properties: {
            questionId: { type: "string", enum: request.contract.questions.map(({ id }) => id) },
            status: { type: "string", enum: ["reported", "not_answered", "ambiguous"] },
            value: { type: ["string", "null"], maxLength: 2_000 },
            sourceExcerpt: { type: ["string", "null"], maxLength: 1_000 },
          },
        },
      },
      possibleCommitmentViolation: { type: "boolean" },
      recipientRequestedNoFurtherCalls: { type: "boolean" },
    },
  };
}

export function buildInquiryExtractionRequest(input: {
  model: string;
  request: InquiryDispatchRequest;
  rawTranscript: string;
  safetyIdentifier: string;
}): Record<string, unknown> {
  return {
    model: input.model,
    store: false,
    safety_identifier: input.safetyIdentifier,
    metadata: { eval_or_runtime: "callbridge", prompt_version: INQUIRY_EXTRACTION_PROMPT_VERSION },
    input: [
      {
        role: "system",
        content: [{
          type: "input_text",
          text: "Return exactly one answer for every approved question. Extract only facts explicitly stated by the Provider. Never infer availability, price, terms, completion, or success. Use reported only for a direct, definite answer. Use ambiguous when the Provider hedges, says sometimes/may/might/depends, asks the caller to confirm elsewhere, or otherwise leaves the answer conditional or uncertain. When a Provider explicitly corrects an earlier statement, use the latest correction and do not preserve the superseded value. For reported or ambiguous answers, sourceExcerpt must be an exact contiguous quote copied from one Provider turn in the transcript; quoting the entire relevant Provider turn is valid. Translate value into the target language. For not_answered, value and sourceExcerpt must be null. Mark possibleCommitmentViolation only if CallBridge itself audibly booked, changed, cancelled, paid, accepted a fee or terms, or made another commitment. Set recipientRequestedNoFurtherCalls only when the Provider explicitly asks CallBridge not to call this number again; do not infer it from declining the current inquiry or ending the call.",
        }],
      },
      {
        role: "user",
        content: [{
          type: "input_text",
          text: `Target language: ${input.request.contract.languages.result}\nObjective: ${input.request.contract.objective}\nApproved questions: ${input.request.contract.questions.map(({ id, prompt }) => `[${id}] ${prompt}`).join(" | ")}\nTranscript:\n${input.rawTranscript}`,
        }],
      },
    ],
    text: {
      format: {
        type: "json_schema",
        name: "call_result",
        strict: true,
        schema: inquiryExtractionSchema(input.request),
      },
    },
  };
}

export function responseOutputText(response: ResponseEnvelope): string | null {
  if (typeof response.output_text === "string" && response.output_text.trim()) return response.output_text;
  return response.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text" && typeof item.text === "string")
    ?.text ?? null;
}

export async function analyzeInquiryTranscript(input: {
  apiKey: string;
  model: string;
  request: InquiryDispatchRequest;
  rawTranscript: string;
  providerTurns: readonly string[];
  safetyIdentifier: string;
  fetchImpl?: typeof fetch;
}): Promise<InquiryExtraction | null> {
  try {
    const response = await (input.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        authorization: `Bearer ${input.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(buildInquiryExtractionRequest(input)),
    });
    if (!response.ok) return null;
    const text = responseOutputText(await response.json<ResponseEnvelope>());
    if (!text) return null;
    return parseInquiryExtraction(JSON.parse(text), input.request, input.providerTurns);
  } catch {
    return null;
  }
}
