import type { InquiryCallResult } from "../../shared/inquiryState.js";
import type { InquiryDispatchRequest } from "../../shared/inquiryDispatchContracts.js";
import type { InquiryExecutionRevision } from "../../shared/inquiryContracts.js";
import type { InquiryWorkerCallback } from "../../shared/inquiryWorkerCallbacks.js";

export type ExtractedInquiryAnswer = {
  questionId: string;
  status: "reported" | "not_answered" | "ambiguous";
  value: string | null;
  sourceExcerpt: string | null;
};

export type InquiryExtraction = {
  answers: ExtractedInquiryAnswer[];
  possibleCommitmentViolation: boolean;
  recipientRequestedNoFurtherCalls: boolean;
};

type TerminalReason = InquiryCallResult["terminalReason"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function boundedString(value: unknown, maximum: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= maximum ? trimmed : null;
}

export function parseInquiryExtraction(
  value: unknown,
  request: InquiryDispatchRequest,
  providerTurns: readonly string[],
): InquiryExtraction | null {
  if (
    !isRecord(value) ||
    !Array.isArray(value.answers) ||
    typeof value.possibleCommitmentViolation !== "boolean" ||
    typeof value.recipientRequestedNoFurtherCalls !== "boolean"
  ) return null;
  const expectedIds = request.contract.questions.map(({ id }) => id);
  if (value.answers.length !== expectedIds.length) return null;
  const answers: ExtractedInquiryAnswer[] = [];
  for (const candidate of value.answers) {
    if (!isRecord(candidate)) return null;
    const questionId = boundedString(candidate.questionId, 128);
    if (!questionId || !expectedIds.includes(questionId) || answers.some((answer) => answer.questionId === questionId)) return null;
    if (candidate.status !== "reported" && candidate.status !== "not_answered" && candidate.status !== "ambiguous") return null;
    const valueText = candidate.value === null ? null : boundedString(candidate.value, 2_000);
    const sourceExcerpt = candidate.sourceExcerpt === null ? null : boundedString(candidate.sourceExcerpt, 1_000);
    if (candidate.status === "reported" && (!valueText || !sourceExcerpt)) return null;
    if (candidate.status === "ambiguous" && !sourceExcerpt) return null;
    if (candidate.status === "not_answered" && (candidate.value !== null || candidate.sourceExcerpt !== null)) return null;
    if (sourceExcerpt && !providerTurns.some((turn) => turn.includes(sourceExcerpt))) return null;
    answers.push({ questionId, status: candidate.status, value: valueText, sourceExcerpt });
  }
  answers.sort((left, right) => expectedIds.indexOf(left.questionId) - expectedIds.indexOf(right.questionId));
  return {
    answers,
    possibleCommitmentViolation: value.possibleCommitmentViolation,
    recipientRequestedNoFurtherCalls: value.recipientRequestedNoFurtherCalls,
  };
}

function resultSummary(answers: ExtractedInquiryAnswer[]): string | null {
  const reported = answers.filter((answer): answer is ExtractedInquiryAnswer & { value: string } => answer.status === "reported" && Boolean(answer.value));
  if (reported.length > 0) return reported.map(({ value }) => value).join(" ").slice(0, 4_000);
  if (answers.some(({ status }) => status === "ambiguous")) return "The recipient responded, but the requested facts were not clear enough to report as answers.";
  return null;
}

export function buildDecisionReadyResult(input: {
  request: InquiryDispatchRequest;
  extraction: InquiryExtraction | null;
  evidenceEventIds: Readonly<Record<string, string>>;
  durationSeconds: number;
  disclosureStatus: InquiryCallResult["disclosureStatus"];
  terminalReason: TerminalReason;
  terminalAt: string;
}): InquiryCallResult {
  const extracted = new Map(input.extraction?.answers.map((answer) => [answer.questionId, answer]));
  const answers = input.request.contract.questions.map(({ id }) => {
    const answer = extracted.get(id) ?? { questionId: id, status: "not_answered" as const, value: null, sourceExcerpt: null };
    const eventId = input.evidenceEventIds[id];
    if (!answer.sourceExcerpt || !eventId) {
      return { questionId: id, status: "not_answered" as const, value: null, evidence: null };
    }
    return {
      questionId: id,
      status: answer.status,
      value: answer.value,
      evidence: { sourceEventId: eventId, sourceExcerpt: answer.sourceExcerpt },
    };
  });
  const unresolvedQuestionIds = answers.filter(({ status }) => status !== "reported").map(({ questionId }) => questionId);
  const hasObservedAnswer = answers.some(({ status }) => status !== "not_answered");
  const outcome: InquiryCallResult["outcome"] = input.terminalReason === "provider_failure"
    ? "failed"
    : input.terminalReason === "no_answer"
      ? "no_answer"
      : input.terminalReason === "user_cancelled" || input.terminalReason === "user_ended"
        ? "stopped"
        : unresolvedQuestionIds.length === 0
          ? "answered"
          : hasObservedAnswer || input.disclosureStatus === "delivered"
            ? "partial"
            : "failed";
  return {
    schemaVersion: 1,
    executionRevision: input.request.confirmedExecutionRevision as InquiryExecutionRevision,
    outcome,
    summary: outcome === "answered" || outcome === "partial" ? resultSummary(input.extraction?.answers ?? []) ?? "The call ended without a clear answer to the requested questions." : null,
    answers,
    unresolvedQuestionIds,
    durationSeconds: Math.max(0, Math.min(input.request.contract.policy.maxConnectedSeconds, Math.floor(input.durationSeconds))),
    disclosureStatus: input.disclosureStatus,
    commitmentSafety: input.extraction?.possibleCommitmentViolation ? "possible_violation" : "none_observed",
    terminalReason: input.terminalReason,
    terminalAt: input.terminalAt,
  };
}

async function signature(input: { body: string; secret: string; timestamp: string }): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${input.timestamp}.${input.body}`));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function deliverInquiryWorkerCallback(input: {
  callbackUrl: string;
  secret: string;
  callback: InquiryWorkerCallback;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  const url = new URL(input.callbackUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Inquiry callback URL must be credential-free HTTPS");
  if (!input.secret.trim()) throw new Error("Inquiry callback secret is missing");
  const fetchImpl = input.fetchImpl ?? fetch;
  const wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const body = JSON.stringify(input.callback);
  const delays = [250, 750, 1_500, 3_000];
  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    const timestamp = Math.floor((input.nowMs?.() ?? Date.now()) / 1_000).toString();
    let response: Response | null = null;
    try {
      response = await fetchImpl(input.callbackUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-callbridge-signature": await signature({ body, secret: input.secret, timestamp }),
          "x-callbridge-timestamp": timestamp,
        },
        body,
      });
    } catch {
      response = null;
    }
    if (response?.ok) return;
    if (attempt < delays.length) await wait(delays[attempt]!);
  }
  throw new Error("Inquiry callback delivery exhausted retries");
}

export async function readTwilioReportedCost(input: {
  accountSid: string;
  apiKey: string;
  apiKeySecret: string;
  callSid: string;
  currency: string;
  fetchImpl?: typeof fetch;
}): Promise<number | null> {
  try {
    const response = await (input.fetchImpl ?? fetch)(
      `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.accountSid)}/Calls/${encodeURIComponent(input.callSid)}.json`,
      { headers: { authorization: `Basic ${btoa(`${input.apiKey}:${input.apiKeySecret}`)}` } },
    );
    if (!response.ok) return null;
    const data = await response.json<{ price?: string | null; price_unit?: string | null }>();
    if (!data.price || data.price_unit?.toUpperCase() !== input.currency.toUpperCase()) return null;
    const amount = Math.abs(Number(data.price));
    return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : null;
  } catch {
    return null;
  }
}
