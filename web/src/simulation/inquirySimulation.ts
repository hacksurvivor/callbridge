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
import {
  type ArtifactPayload,
  type TaskArtifact,
} from "../../../shared/taskArtifacts.js";
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
    website: "https://sakurahotel.co.jp/guide/english/house-rules/",
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
    recipientKind: null,
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
let artifacts: TaskArtifact[] = [];
let artifactSequence = 0;
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

type SimulationTaskRecord = {
  snapshot: InquiryTaskSnapshot;
  events: InquiryActivityEvent[];
  result: GetInquiryResultOutput;
  artifacts: TaskArtifact[];
};

const taskRecords = new Map<string, SimulationTaskRecord>();
let historyCache: InquiryTaskSnapshot[] = [currentDraft];

const listeners = new Set<() => void>();
const creations = new Map<string, InquiryTaskSnapshot>();

function saveCurrentRecord(): void {
  taskRecords.set(currentDraft.taskId, {
    snapshot: currentDraft,
    events: [...events],
    result: currentResult,
    artifacts: [...artifacts],
  });
  historyCache = [...taskRecords.values()]
    .map(({ snapshot }) => snapshot)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function notify(): void {
  for (const listener of listeners) listener();
}

function publish(next: InquiryTaskSnapshot): void {
  currentDraft = next;
  saveCurrentRecord();
  notify();
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

export function getInquirySimulationArtifacts(): TaskArtifact[] {
  return artifacts;
}

export function getInquirySimulationHistory(): InquiryTaskSnapshot[] {
  return historyCache;
}

export function selectInquirySimulationTask(taskId: string): void {
  if (taskId === currentDraft.taskId) return;
  saveCurrentRecord();
  const record = taskRecords.get(taskId);
  if (!record) return;
  currentDraft = record.snapshot;
  events = [...record.events];
  currentResult = record.result;
  artifacts = [...record.artifacts];
  saveCurrentRecord();
  notify();
}

function publishArtifacts(next: TaskArtifact[]): void {
  artifacts = next;
  saveCurrentRecord();
  notify();
}

function makeArtifact(payload: ArtifactPayload, source: TaskArtifact["source"] = "callbridge_server"): TaskArtifact {
  const sequence = ++artifactSequence;
  return {
    schemaVersion: 1,
    artifactId: `simulation_artifact_${sequence}`,
    taskId: currentDraft.taskId,
    createdSequence: sequence,
    lastEventSequence: sequence,
    revision: 1,
    type: payload.type,
    status: "active",
    visibility: "owner",
    source,
    payload,
    createdAt: fixtureNow,
    updatedAt: fixtureNow,
  };
}

export function beginSimulationArtifactFixture(): TaskArtifact {
  const existing = artifacts.find(({ type }) => type === "auth_required");
  if (existing) return existing;
  const artifact = makeArtifact({
    type: "auth_required",
    providerId: "callbridge_demo",
    providerName: "CallBridge controlled provider",
    reason: "This labeled fixture requires a protected authorization handoff before the provider message is revealed.",
    state: "required",
    continuation: "open_secure_browser",
    simulated: true,
  });
  publishArtifacts([...artifacts, artifact]);
  return artifact;
}

export function completeSimulationArtifactAuthorization(artifactId: string): void {
  const current = artifacts.find(({ artifactId: candidate }) => candidate === artifactId);
  if (!current || current.payload.type !== "auth_required" || current.status !== "active") return;
  const now = new Date().toISOString();
  const resolved: TaskArtifact = {
    ...current,
    revision: current.revision + 1,
    lastEventSequence: ++artifactSequence,
    status: "resolved",
    payload: { ...current.payload, state: "authorized" },
    updatedAt: now,
  };
  const conversation = makeArtifact({
    type: "conversation",
    channel: "web_chat",
    title: "Controlled provider conversation",
    participants: [
      { id: "callbridge-agent", displayName: "CallBridge", role: "agent" },
      { id: "fixture-provider", displayName: "Controlled provider", role: "provider" },
    ],
    latestMessages: [{
      messageId: "fixture-provider-message",
      sequence: 1,
      authorRole: "provider",
      authorDisplayName: "Controlled provider",
      text: "Late arrival is available. Please provide the approximate arrival window so the desk can leave a factual note.",
      state: "observed",
      occurredAt: now,
    }],
    hasEarlierMessages: false,
    simulated: true,
  });
  const question = makeArtifact({
    type: "user_question",
    prompt: "What arrival window should CallBridge share with the provider?",
    responseMode: "single_choice",
    options: [
      { id: "before-midnight", label: "Before midnight" },
      { id: "midnight-to-one", label: "12:00–1:00 AM" },
      { id: "after-one", label: "After 1:00 AM" },
    ],
    simulated: true,
  });
  publishArtifacts([
    ...artifacts.map((artifact) => artifact.artifactId === artifactId ? resolved : artifact),
    conversation,
    question,
  ]);
}

export function answerSimulationArtifactQuestion(artifactId: string, value: string | string[]): void {
  const current = artifacts.find(({ artifactId: candidate }) => candidate === artifactId);
  if (!current || current.payload.type !== "user_question" || current.status !== "active") return;
  const now = new Date().toISOString();
  const resolved: TaskArtifact = {
    ...current,
    revision: current.revision + 1,
    lastEventSequence: ++artifactSequence,
    status: "resolved",
    payload: { ...current.payload, response: { value, submittedAt: now } },
    updatedAt: now,
  };
  const evidence = makeArtifact({
    type: "evidence",
    kind: "screenshot",
    assetRef: "fixture:evidence:late-arrival-policy",
    caption: "Controlled fixture evidence showing the provider's late-arrival policy.",
    capturedAt: now,
    provenance: "browser_capture",
    redactionState: "not_required",
    simulated: true,
  });
  publishArtifacts([
    ...artifacts.map((artifact) => artifact.artifactId === artifactId ? resolved : artifact),
    evidence,
  ]);
  completeInquirySimulationFixture();
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

export function beginInquirySimulationExecution(): InquiryTaskSnapshot {
  if (currentDraft.status === "in_progress") return currentDraft;
  if (currentDraft.status !== "confirmed") return currentDraft;
  const occurredAt = new Date().toISOString();
  const next: InquiryTaskSnapshot = {
    ...currentDraft,
    status: "in_progress",
    updatedAt: occurredAt,
  };
  events = [...events,
    {
      eventId: "simulation:credit-reserved",
      sequence: events.length + 1,
      type: "credit_reserved",
      source: "callbridge_server",
      revision: next.revision,
      executionRevision: next.executionRevision,
      occurredAt,
    },
    {
      eventId: "simulation:attempt-queued",
      sequence: events.length + 2,
      type: "attempt_queued",
      source: "callbridge_server",
      revision: next.revision,
      executionRevision: next.executionRevision,
      occurredAt,
    },
    {
      eventId: "simulation:dialing",
      sequence: events.length + 3,
      type: "dialing",
      source: "telephony_worker",
      revision: next.revision,
      executionRevision: next.executionRevision,
      occurredAt,
    },
  ];
  publish(next);
  return next;
}

export function completeInquirySimulationFixture(): InquiryTaskSnapshot {
  if (currentDraft.status === "completed" && currentResult.status === "ready") return currentDraft;
  const terminalAt = new Date().toISOString();
  const fixtureAnswers: Record<string, { value: string; sourceExcerpt: string }> = {
    "latest-check-in-time": {
      value: "The front desk accepts arrivals until 1:00 a.m.",
      sourceExcerpt: "Check-in is possible until 1 a.m.",
    },
    "advance-notice-required": {
      value: "The hotel asks guests arriving after midnight to call ahead.",
      sourceExcerpt: "Please call us before midnight if you will arrive late.",
    },
    "late-arrival-fee": {
      value: "The hotel did not state a late-arrival fee.",
      sourceExcerpt: "There is no additional late-arrival charge.",
    },
  };
  const answers = currentDraft.contract.questions.map((question) => {
    const fixture = fixtureAnswers[question.id];
    if (!fixture) return { questionId: question.id, status: "not_answered" as const, value: null, evidence: null };
    return {
      questionId: question.id,
      status: "reported" as const,
      value: fixture.value,
      evidence: { sourceEventId: `simulation:answer:${question.id}`, sourceExcerpt: fixture.sourceExcerpt },
    };
  });
  const answered = answers.filter((answer) => answer.status === "reported");
  const unresolvedQuestionIds = answers.filter((answer) => answer.status !== "reported").map(({ questionId }) => questionId);
  let nextSequence = events.length;
  const callEvents: InquiryActivityEvent[] = [];
  const appendCallEvent = (
    eventId: string,
    type: InquiryActivityEvent["type"],
    source: InquiryActivityEvent["source"],
    questionId?: string,
  ) => {
    callEvents.push({
      eventId,
      sequence: ++nextSequence,
      type,
      source,
      revision: currentDraft.revision,
      executionRevision: currentDraft.executionRevision,
      occurredAt: terminalAt,
      ...(questionId ? { questionId } : {}),
    });
  };
  appendCallEvent("simulation:connected", "connected", "telephony_worker");
  appendCallEvent("simulation:disclosure", "disclosure_delivered", "telephony_worker");
  for (const answer of answers) {
    appendCallEvent(`simulation:question:${answer.questionId}`, "question_started", "telephony_worker", answer.questionId);
    if (answer.evidence) appendCallEvent(answer.evidence.sourceEventId, "answer_observed", "telephony_worker", answer.questionId);
  }
  appendCallEvent("simulation:ended", "call_ended", "telephony_worker");
  appendCallEvent("simulation:result-ready", "result_ready", "callbridge_server");
  events = [...events, ...callEvents];
  currentResult = {
    status: "ready",
    result: {
      schemaVersion: 1,
      executionRevision: currentDraft.executionRevision,
      outcome: unresolvedQuestionIds.length ? answered.length ? "partial" : "no_answer" : "answered",
      summary: answered.length ? answered.map(({ value }) => value).join(" ") : "The simulated call ended without an answer to the prepared questions.",
      answers,
      unresolvedQuestionIds,
      durationSeconds: 107,
      disclosureStatus: "delivered",
      commitmentSafety: "none_observed",
      terminalReason: "completed",
      terminalAt,
    },
    receipt: {
      schemaVersion: 1,
      taskId: currentDraft.taskId,
      attemptId: "simulation_attempt",
      executionRevision: currentDraft.executionRevision,
      outcome: unresolvedQuestionIds.length ? answered.length ? "partial" : "no_answer" : "answered",
      callLanguage: currentDraft.contract.languages.call,
      resultLanguage: currentDraft.contract.languages.result,
      answeredQuestionIds: answered.map(({ questionId }) => questionId),
      unresolvedQuestionIds,
      sourceEventIds: answered.flatMap(({ evidence }) => evidence ? [evidence.sourceEventId] : []).sort(),
      durationSeconds: 107,
      terminalReason: "completed",
      disclosureStatus: "delivered",
      commitmentSafety: "none_observed",
      terminalAt,
      cost: {
        currency: currentDraft.contract.costCeiling.currency,
        status: "provider_reported",
        actualMinorUnits: 17,
      },
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
    if (existing) {
      selectInquirySimulationTask(existing.taskId);
      return existing;
    }
    saveCurrentRecord();
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
    currentResult = { status: "not_ready" };
    artifacts = [];
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
  async createDemoCallDraft(input) {
    return this.createCallDraft({
      schemaVersion: 1,
      idempotencyKey: input.idempotencyKey,
      contract: {
        ...APPROVED_INQUIRY_FIXTURE,
        destination: {
          displayName: "Aurora Demo Hotel · Controlled demo recipient",
          e164PhoneNumber: "+10000000000",
          countryCode: "US",
        },
        objective: input.objective,
        questions: input.questions,
        languages: { call: "en-US", result: input.resultLanguage ?? "en" },
        context: {
          shareableFacts: input.shareableContext
            ? [{ id: "judge-context", label: "Context from the caller", value: input.shareableContext }]
            : [],
        },
      },
    }, new AbortController().signal);
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
