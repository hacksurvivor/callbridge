import {
  INQUIRY_FORBIDDEN_ACTIONS,
  INQUIRY_REQUIRED_DISCLOSURE_CLAIMS,
  computeInquiryExecutionRevision,
  parseInquiryCallContract,
  type InquiryCallContract,
  type InquiryExecutionRevision,
} from "../../../shared/inquiryContracts.js";
import type {
  GetInquiryResultOutput,
  InquiryActivityEvent,
} from "../../../shared/inquiryWebMcp.js";
import type { InquiryTaskSnapshot } from "../../../shared/inquiryState.js";
import type { InquiryToolClient } from "../webmcp/registerTools.js";

const fixtureNow = "2026-08-26T07:00:00.000Z";

export const APPROVED_INQUIRY_FIXTURE: InquiryCallContract = {
  schemaVersion: 1,
  category: "accommodation",
  destination: {
    displayName: "Sakura Hotel Kyoto",
    e164PhoneNumber: "+81751234142",
    countryCode: "JP",
    address: "Kyoto, Japan",
  },
  objective: "Find out whether Maya can arrive after midnight and what she needs to do beforehand.",
  questions: [
    { id: "latest-check-in-time", prompt: "What is the latest check-in time?", required: true },
    { id: "advance-notice-required", prompt: "Does Maya need to notify the front desk?", required: true },
    { id: "late-arrival-fee", prompt: "Does the hotel state a late-arrival fee?", required: true },
  ],
  languages: { call: "ja-JP", result: "en" },
  context: {
    privateBackground: "Maya expects to arrive after midnight and only needs factual information.",
    shareableFacts: [
      { id: "arrival-window", label: "Expected arrival", value: "After midnight", shareWhen: "Only if needed." },
    ],
  },
  disclosure: {
    id: "ai-assistant-ja-v2",
    locale: "ja-JP",
    text: "This is an AI assistant calling for a user. Speech is transcribed, audio is not recorded, and minimal structured evidence is retained temporarily.",
    requiredClaims: [...INQUIRY_REQUIRED_DISCLOSURE_CLAIMS],
  },
  costCeiling: { currency: "USD", maxTotalMinorUnits: 500 },
  policy: {
    id: "inquiry-v1",
    authority: "gather_information_only",
    forbiddenActions: [...INQUIRY_FORBIDDEN_ACTIONS],
    maxAttempts: 1,
    automaticRetry: false,
    maxConnectedSeconds: 180,
    audioRecording: false,
  },
};

function makeSnapshot(
  contract: InquiryCallContract,
  revision = 3,
  executionRevision: InquiryExecutionRevision = "inquiry-v1:sha256:simulation-approved-fixture",
): InquiryTaskSnapshot {
  return {
    taskId: "simulation_inquiry_call",
    status: "awaiting_confirmation",
    revision,
    executionRevision,
    contract,
    confirmation: {
      state: "ready",
      intentId: "simulation_intent",
      expiresAt: "2026-09-04T00:00:00.000Z",
      confirmedExecutionRevision: null,
    },
    resultState: "not_ready",
    pricing: {
      status: "ready",
      quote: {
        quoteId: `00000000-0000-4000-8000-${String(revision).padStart(12, "0")}`,
        revision,
        executionRevision,
        provider: "twilio",
        destination: {
          isoCountry: contract.destination.countryCode,
          country: contract.destination.address?.split(",").at(-1)?.trim() || contract.destination.countryCode,
          maskedPhone: `${contract.destination.e164PhoneNumber.slice(0, 4)}…${contract.destination.e164PhoneNumber.slice(-4)}`,
        },
        policy: { allowed: true, riskTier: "low_risk_only", provisioning: "just_in_time" },
        pstn: {
          rateDescription: `Simulated outbound voice to ${contract.destination.countryCode}`,
          currentPricePerMinute: "0.0746",
          currency: contract.costCeiling.currency,
          maximumConnectedSeconds: contract.policy.maxConnectedSeconds,
          estimatedMaximumCharge: "0.2238",
        },
        quote: {
          quotedAt: fixtureNow,
          expiresAt: "2026-09-04T00:00:00.000Z",
          source: "twilio_public_outbound_pricing_csv",
          accountSpecific: false,
        },
        exclusions: ["twilio_media_streams", "openai_realtime_audio", "taxes_and_carrier_surcharges"],
      },
    },
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  };
}

let currentDraft = makeSnapshot(APPROVED_INQUIRY_FIXTURE);
let currentResult: GetInquiryResultOutput = { status: "not_ready" };
let events: InquiryActivityEvent[] = [
  {
    eventId: "simulation:draft-created",
    sequence: 1,
    type: "draft_created",
    source: "callbridge_server",
    revision: 1,
    executionRevision: currentDraft.executionRevision,
    occurredAt: fixtureNow,
  },
  {
    eventId: "simulation:draft-updated",
    sequence: 2,
    type: "draft_updated",
    source: "callbridge_server",
    revision: 3,
    executionRevision: currentDraft.executionRevision,
    occurredAt: fixtureNow,
  },
  {
    eventId: "simulation:confirmation-ready",
    sequence: 3,
    type: "confirmation_ready",
    source: "callbridge_server",
    revision: 3,
    executionRevision: currentDraft.executionRevision,
    occurredAt: fixtureNow,
  },
];

const listeners = new Set<() => void>();
const creations = new Map<string, InquiryTaskSnapshot>();

function publish(next: InquiryTaskSnapshot): void {
  currentDraft = next;
  for (const listener of listeners) listener();
}

function assertTask(taskId: string): void {
  if (taskId !== currentDraft.taskId) throw { code: "NOT_FOUND" };
}

export function subscribeInquirySimulation(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getInquirySimulationSnapshot(): InquiryTaskSnapshot {
  return currentDraft;
}

export function getInquirySimulationEvents(): InquiryActivityEvent[] {
  return events;
}

export function getInquirySimulationResult(): GetInquiryResultOutput {
  return currentResult;
}

export function confirmInquirySimulation(): InquiryTaskSnapshot {
  if (currentDraft.status === "confirmed") return currentDraft;
  const next: InquiryTaskSnapshot = {
    ...currentDraft,
    status: "confirmed",
    confirmation: {
      state: "confirmed",
      intentId: currentDraft.confirmation.intentId,
      expiresAt: currentDraft.confirmation.expiresAt,
      confirmedExecutionRevision: currentDraft.executionRevision,
    },
    updatedAt: new Date().toISOString(),
  };
  events = [...events, {
    eventId: "simulation:confirmed",
    sequence: events.length + 1,
    type: "confirmed",
    source: "callbridge_server",
    revision: next.revision,
    executionRevision: next.executionRevision,
    occurredAt: next.updatedAt,
  }];
  publish(next);
  return next;
}

export function completeInquirySimulationFixture(): InquiryTaskSnapshot {
  if (currentDraft.status === "completed" && currentResult.status === "ready") return currentDraft;
  const terminalAt = "2026-08-26T07:02:14.000Z";
  const answers = [
    {
      questionId: "latest-check-in-time",
      status: "reported" as const,
      value: "The front desk accepts arrivals until 1:00 a.m.",
      evidence: { sourceEventId: "simulation:answer:latest-check-in-time", sourceExcerpt: "Check-in is possible until 1 a.m." },
    },
    {
      questionId: "advance-notice-required",
      status: "reported" as const,
      value: "The hotel asks guests arriving after midnight to call ahead.",
      evidence: { sourceEventId: "simulation:answer:advance-notice-required", sourceExcerpt: "Please call us before midnight if you will arrive late." },
    },
    {
      questionId: "late-arrival-fee",
      status: "reported" as const,
      value: "The hotel did not state a late-arrival fee.",
      evidence: { sourceEventId: "simulation:answer:late-arrival-fee", sourceExcerpt: "There is no additional late-arrival charge." },
    },
  ];
  const callEvents: InquiryActivityEvent[] = [
    { eventId: "simulation:connected", sequence: events.length + 1, type: "connected", source: "telephony_worker", revision: currentDraft.revision, executionRevision: currentDraft.executionRevision, occurredAt: "2026-08-26T07:00:27.000Z" },
    { eventId: "simulation:disclosure", sequence: events.length + 2, type: "disclosure_delivered", source: "telephony_worker", revision: currentDraft.revision, executionRevision: currentDraft.executionRevision, occurredAt: "2026-08-26T07:00:34.000Z" },
    ...answers.flatMap((answer, index): InquiryActivityEvent[] => [
      { eventId: `simulation:question:${answer.questionId}`, sequence: events.length + 3 + index * 2, type: "question_started", source: "telephony_worker", revision: currentDraft.revision, executionRevision: currentDraft.executionRevision, occurredAt: `2026-08-26T07:0${index}:40.000Z`, questionId: answer.questionId },
      { eventId: answer.evidence.sourceEventId, sequence: events.length + 4 + index * 2, type: "answer_observed", source: "telephony_worker", revision: currentDraft.revision, executionRevision: currentDraft.executionRevision, occurredAt: `2026-08-26T07:0${index}:50.000Z`, questionId: answer.questionId },
    ]),
    { eventId: "simulation:ended", sequence: events.length + 9, type: "call_ended", source: "telephony_worker", revision: currentDraft.revision, executionRevision: currentDraft.executionRevision, occurredAt: terminalAt },
    { eventId: "simulation:result-ready", sequence: events.length + 10, type: "result_ready", source: "callbridge_server", revision: currentDraft.revision, executionRevision: currentDraft.executionRevision, occurredAt: terminalAt },
  ];
  events = [...events, ...callEvents];
  currentResult = {
    status: "ready",
    taskId: currentDraft.taskId,
    attemptId: "simulation_attempt",
    actualCostMinorUnits: 17,
    costStatus: "provider_reported",
    result: {
      schemaVersion: 1,
      executionRevision: currentDraft.executionRevision,
      outcome: "answered",
      summary: "Late arrival is possible until 1:00 a.m. The hotel asks Maya to call ahead before midnight and stated there is no additional late-arrival charge.",
      answers,
      unresolvedQuestionIds: [],
      durationSeconds: 107,
      disclosureStatus: "delivered",
      commitmentSafety: "none_observed",
      terminalReason: "completed",
      terminalAt,
    },
  };
  const next: InquiryTaskSnapshot = {
    ...currentDraft,
    status: "completed",
    confirmation: {
      state: "confirmed",
      intentId: currentDraft.confirmation.intentId,
      expiresAt: currentDraft.confirmation.expiresAt,
      confirmedExecutionRevision: currentDraft.executionRevision,
    },
    resultState: "ready",
    updatedAt: terminalAt,
  };
  publish(next);
  return next;
}

export function prepareInquirySimulation(): InquiryTaskSnapshot {
  if (currentDraft.confirmation.state === "ready" || currentDraft.confirmation.state === "confirmed") return currentDraft;
  const next: InquiryTaskSnapshot = {
    ...currentDraft,
    status: "awaiting_confirmation",
    confirmation: {
      state: "ready",
      intentId: `simulation_intent_${currentDraft.revision}`,
      expiresAt: "2026-09-04T00:00:00.000Z",
      confirmedExecutionRevision: null,
    },
    pricing: makeSnapshot(currentDraft.contract, currentDraft.revision, currentDraft.executionRevision).pricing,
    updatedAt: new Date().toISOString(),
  };
  events = [...events, {
    eventId: `simulation:confirmation-ready:${next.revision}`,
    sequence: events.length + 1,
    type: "confirmation_ready",
    source: "callbridge_server",
    revision: next.revision,
    executionRevision: next.executionRevision,
    occurredAt: next.updatedAt,
  }];
  publish(next);
  return next;
}

export const simulationInquiryClient: InquiryToolClient = {
  async createCallDraft(input) {
    if (input.schemaVersion !== 1 || input.idempotencyKey.trim().length < 8) throw { code: "INVALID_INPUT" };
    const contract = parseInquiryCallContract(input.contract);
    const existing = creations.get(input.idempotencyKey);
    if (existing) return existing;
    const executionRevision = await computeInquiryExecutionRevision(contract);
    const created: InquiryTaskSnapshot = {
      ...makeSnapshot(contract, 1, executionRevision),
      taskId: `simulation_${input.idempotencyKey}`,
      status: "draft",
      confirmation: {
        state: "not_ready",
        intentId: null,
        expiresAt: null,
        confirmedExecutionRevision: null,
      },
      pricing: { status: "not_ready" },
    };
    creations.set(input.idempotencyKey, created);
    events = [{
      eventId: "simulation:draft-created",
      sequence: 1,
      type: "draft_created",
      source: "callbridge_server",
      revision: 1,
      executionRevision,
      occurredAt: fixtureNow,
    }];
    publish(created);
    return created;
  },
  async updateCallDraft(input) {
    if (input.schemaVersion !== 1) throw { code: "INVALID_INPUT" };
    assertTask(input.taskId);
    if (input.expectedRevision !== currentDraft.revision) throw { code: "STALE_REVISION" };
    const contract = parseInquiryCallContract(input.contract);
    const executionRevision = await computeInquiryExecutionRevision(contract);
    if (executionRevision === currentDraft.executionRevision) {
      return { task: currentDraft, confirmationReset: false };
    }
    const updated: InquiryTaskSnapshot = {
      ...currentDraft,
      status: "draft",
      revision: currentDraft.revision + 1,
      executionRevision,
      contract,
      confirmation: {
        state: "revoked",
        intentId: null,
        expiresAt: null,
        confirmedExecutionRevision: null,
      },
      pricing: { status: "not_ready" },
      updatedAt: new Date().toISOString(),
    };
    events = [...events, {
      eventId: `simulation:draft-updated:${updated.revision}`,
      sequence: events.length + 1,
      type: "draft_updated",
      source: "callbridge_server",
      revision: updated.revision,
      executionRevision,
      occurredAt: updated.updatedAt,
    }];
    for (const [key, created] of creations) {
      if (created.taskId === updated.taskId) creations.set(key, updated);
    }
    publish(updated);
    return { task: updated, confirmationReset: true };
  },
  async readCallDraft(input) {
    if (input.schemaVersion !== 1) throw { code: "INVALID_INPUT" };
    assertTask(input.taskId);
    return currentDraft;
  },
  async getCallStatus(input) {
    if (input.schemaVersion !== 1) throw { code: "INVALID_INPUT" };
    assertTask(input.taskId);
    const selected = events.filter(({ sequence }) => sequence > (input.afterSequence ?? 0));
    return {
      taskId: currentDraft.taskId,
      taskStatus: currentDraft.status,
      events: selected,
      nextSequence: selected.at(-1)?.sequence ?? null,
    };
  },
  async getCallResult(input) {
    if (input.schemaVersion !== 1) throw { code: "INVALID_INPUT" };
    assertTask(input.taskId);
    return currentResult;
  },
};
