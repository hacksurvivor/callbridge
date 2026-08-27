import { v } from "convex/values";

export const hotelDemoQuestionIdValidator = v.union(
  v.literal("after-midnight-allowed"),
  v.literal("latest-check-in-time"),
  v.literal("advance-notice-required"),
  v.literal("late-arrival-fee"),
);

export const hotelDemoTaskStatusValidator = v.union(
  v.literal("draft"),
  v.literal("awaiting_confirmation"),
  v.literal("confirmed"),
  v.literal("in_progress"),
  v.literal("completed"),
  v.literal("failed"),
  v.literal("stopped"),
);

export const hotelDemoAttemptStatusValidator = v.union(
  v.literal("queued"),
  v.literal("dialing"),
  v.literal("connected"),
  v.literal("ending"),
  v.literal("ended"),
  v.literal("failed"),
  v.literal("cancelled"),
  v.literal("timed_out"),
);

export const hotelDemoConfirmationStateValidator = v.union(
  v.literal("not_ready"),
  v.literal("ready"),
  v.literal("confirmed"),
  v.literal("expired"),
);

export const hotelDemoTaskActivityTypeValidator = v.union(
  v.literal("draft_created"),
  v.literal("draft_updated"),
  v.literal("confirmation_ready"),
  v.literal("confirmation_expired"),
  v.literal("confirmed"),
  v.literal("queued_cancelled"),
  v.literal("end_requested"),
  v.literal("result_ready"),
);

export const hotelDemoTaskActivityEventValidator = v.object({
  schemaVersion: v.literal(1),
  eventId: v.string(),
  taskId: v.string(),
  type: hotelDemoTaskActivityTypeValidator,
  occurredAt: v.string(),
  source: v.literal("callbridge_server"),
  publicPayload: v.object({ revision: v.number() }),
});

const emptyPayloadValidator = v.object({});

export const hotelDemoAttemptEventValidator = v.union(
  ...(["dispatch_accepted", "dialing", "connected"] as const).map((type) => v.object({
    schemaVersion: v.literal(1),
    eventId: v.string(),
    taskId: v.string(),
    attemptId: v.string(),
    workerSequence: v.number(),
    observedAt: v.string(),
    source: v.literal("telephony_worker"),
    type: v.literal(type),
    publicPayload: emptyPayloadValidator,
  })),
  v.object({
    schemaVersion: v.literal(1), eventId: v.string(), taskId: v.string(), attemptId: v.string(), workerSequence: v.number(), observedAt: v.string(), source: v.literal("telephony_worker"),
    type: v.literal("disclosure_delivered"), publicPayload: v.object({ disclosureId: v.literal("ai-assistant-ja-v2") }),
  }),
  v.object({
    schemaVersion: v.literal(1), eventId: v.string(), taskId: v.string(), attemptId: v.string(), workerSequence: v.number(), observedAt: v.string(), source: v.literal("telephony_worker"),
    type: v.literal("question_started"), publicPayload: v.object({ questionId: hotelDemoQuestionIdValidator }),
  }),
  v.object({
    schemaVersion: v.literal(1), eventId: v.string(), taskId: v.string(), attemptId: v.string(), workerSequence: v.number(), observedAt: v.string(), source: v.literal("telephony_worker"),
    type: v.literal("fact_observed"),
    publicPayload: v.object({
      questionId: hotelDemoQuestionIdValidator,
      sourceText: v.string(),
      translatedValue: v.string(),
      extractionConfidence: v.number(),
      translationConfidence: v.number(),
    }),
  }),
  v.object({
    schemaVersion: v.literal(1), eventId: v.string(), taskId: v.string(), attemptId: v.string(), workerSequence: v.number(), observedAt: v.string(), source: v.literal("telephony_worker"),
    type: v.literal("prohibited_request_declined"),
    publicPayload: v.object({ action: v.union(
      v.literal("book"), v.literal("change_reservation"), v.literal("cancel"), v.literal("pay"),
      v.literal("accept_fee"), v.literal("accept_terms"), v.literal("make_commitment"),
    ) }),
  }),
  v.object({
    schemaVersion: v.literal(1), eventId: v.string(), taskId: v.string(), attemptId: v.string(), workerSequence: v.number(), observedAt: v.string(), source: v.literal("telephony_worker"),
    type: v.literal("policy_violation_detected"),
    publicPayload: v.object({
      category: v.union(v.literal("unauthorized_commitment"), v.literal("forbidden_action_attempt"), v.literal("disclosure_failure")),
      evidenceExcerpt: v.string(),
    }),
  }),
  v.object({
    schemaVersion: v.literal(1), eventId: v.string(), taskId: v.string(), attemptId: v.string(), workerSequence: v.number(), observedAt: v.string(), source: v.literal("telephony_worker"),
    type: v.literal("hangup_requested"), publicPayload: v.object({ reason: v.union(v.literal("user"), v.literal("connected_timeout"), v.literal("policy")) }),
  }),
  v.object({
    schemaVersion: v.literal(1), eventId: v.string(), taskId: v.string(), attemptId: v.string(), workerSequence: v.number(), observedAt: v.string(), source: v.literal("telephony_worker"),
    type: v.literal("ended"), publicPayload: v.object({ reason: v.union(v.literal("completed"), v.literal("user"), v.literal("connected_timeout"), v.literal("remote_hangup")) }),
  }),
  v.object({
    schemaVersion: v.literal(1), eventId: v.string(), taskId: v.string(), attemptId: v.string(), workerSequence: v.number(), observedAt: v.string(), source: v.literal("telephony_worker"),
    type: v.literal("failed"), publicPayload: v.object({ stage: v.union(v.literal("dispatch"), v.literal("dialing"), v.literal("connection"), v.literal("callback")), code: v.string() }),
  }),
);

export const hotelDemoPublicActivityItemValidator = v.object({
  activitySequence: v.number(),
  projectedAt: v.string(),
  gapBefore: v.boolean(),
  event: v.union(hotelDemoTaskActivityEventValidator, hotelDemoAttemptEventValidator),
});

export const hotelDemoCallResultValidator = v.object({
  schemaVersion: v.literal(1),
  taskId: v.string(),
  attemptId: v.string(),
  outcome: v.union(v.literal("answered"), v.literal("partial"), v.literal("no_answer"), v.literal("failed"), v.literal("stopped")),
  sourceLanguage: v.literal("ja-JP"),
  outputLanguage: v.literal("en"),
  summary: v.union(v.string(), v.null()),
  facts: v.array(v.object({
    questionId: hotelDemoQuestionIdValidator,
    status: v.union(v.literal("reported"), v.literal("not_answered"), v.literal("ambiguous")),
    value: v.union(v.string(), v.null()),
    evidence: v.union(v.object({ sourceEventId: v.string(), sourceExcerpt: v.string() }), v.null()),
  })),
  durationSeconds: v.number(),
  disclosureStatus: v.union(v.literal("delivered"), v.literal("not_observed"), v.literal("failed")),
  commitmentSafety: v.union(v.literal("none_observed"), v.literal("possible_violation")),
  policyViolations: v.array(v.object({ eventId: v.string(), description: v.string() })),
  terminalReason: v.union(
    v.literal("completed"), v.literal("remote_hangup"), v.literal("no_answer"), v.literal("provider_failure"),
    v.literal("user_cancelled"), v.literal("user_ended"), v.literal("connected_timeout"),
  ),
  terminalAt: v.string(),
});

export const hotelDemoDisclosureValidator = v.object({
  id: v.literal("ai-assistant-ja-v2"),
  locale: v.literal("ja-JP"),
  text: v.string(),
  requiredClaims: v.array(v.union(
    v.literal("ai_identity"),
    v.literal("speech_transcription"),
    v.literal("no_audio_recording"),
    v.literal("structured_retention_24h"),
  )),
  approvedAt: v.string(),
});

export const hotelDemoCallDraftValidator = v.object({
  schemaVersion: v.literal(1),
  taskId: v.string(),
  revision: v.number(),
  status: hotelDemoTaskStatusValidator,
  policyVersion: v.literal("hotel-ja-v1"),
  owner: v.object({ isCurrentUser: v.literal(true) }),
  destination: v.object({
    id: v.literal("controlled-hotel"),
    displayName: v.string(),
    maskedPhone: v.string(),
  }),
  objectiveId: v.literal("late-check-in"),
  questionIds: v.array(hotelDemoQuestionIdValidator),
  sourceLanguage: v.literal("ja-JP"),
  outputLanguage: v.literal("en"),
  disclosure: hotelDemoDisclosureValidator,
  authority: v.literal("gather_facts_only"),
  forbiddenActions: v.array(v.union(
    v.literal("book"),
    v.literal("change_reservation"),
    v.literal("cancel"),
    v.literal("pay"),
    v.literal("accept_fee"),
    v.literal("accept_terms"),
    v.literal("make_commitment"),
  )),
  pricing: v.union(
    v.object({ state: v.literal("not_ready") }),
    v.object({
      state: v.literal("ready"),
      revision: v.number(),
      destinationCountry: v.string(),
      destinationIsoCountry: v.string(),
      rateDescription: v.string(),
      currentPricePerMinute: v.string(),
      currency: v.string(),
      maximumConnectedSeconds: v.number(),
      estimatedMaximumPstnCharge: v.string(),
      quotedAt: v.string(),
      expiresAt: v.string(),
      source: v.union(v.literal("twilio_voice_number_pricing_api_v2"), v.literal("twilio_public_outbound_pricing_csv")),
      accountSpecific: v.boolean(),
    }),
  ),
  confirmation: v.object({
    state: hotelDemoConfirmationStateValidator,
    intentId: v.union(v.string(), v.null()),
    expiresAt: v.union(v.string(), v.null()),
  }),
  createdAt: v.string(),
  updatedAt: v.string(),
});
