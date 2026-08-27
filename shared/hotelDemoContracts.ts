export const HOTEL_DEMO_SCHEMA_VERSION = 1 as const;
export const HOTEL_DEMO_POLICY_VERSION = "hotel-ja-v1" as const;
export const HOTEL_DEMO_DESTINATION_ID = "controlled-hotel" as const;
export const HOTEL_DEMO_OBJECTIVE_ID = "late-check-in" as const;
export const HOTEL_DEMO_DISCLOSURE_ID = "ai-assistant-ja-v2" as const;

export const HOTEL_DEMO_QUESTION_IDS = [
  "after-midnight-allowed",
  "latest-check-in-time",
  "advance-notice-required",
  "late-arrival-fee",
] as const;

export const HOTEL_DEMO_FORBIDDEN_ACTIONS = [
  "book",
  "change_reservation",
  "cancel",
  "pay",
  "accept_fee",
  "accept_terms",
  "make_commitment",
] as const;

export const HOTEL_DEMO_REQUIRED_DISCLOSURE_CLAIMS = [
  "ai_identity",
  "speech_transcription",
  "no_audio_recording",
  "structured_retention_24h",
] as const;

export const HOTEL_DEMO_TASK_STATUSES = [
  "draft",
  "awaiting_confirmation",
  "confirmed",
  "in_progress",
  "completed",
  "failed",
  "stopped",
] as const;

export const HOTEL_DEMO_ATTEMPT_STATUSES = [
  "queued",
  "dialing",
  "connected",
  "ending",
  "ended",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export const WEBMCP_ERROR_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "REVISION_CONFLICT",
  "INVALID_STATE",
  "DEMO_POLICY_DENIED",
  "RATE_UNAVAILABLE",
  "UNSUPPORTED_ENVIRONMENT",
  "INTERNAL_ERROR",
] as const;

export const HOTEL_DEMO_TOOL_NAMES = [
  "create_call_draft",
  "update_call_draft",
  "read_call_draft",
  "get_call_status",
  "get_call_result",
] as const;

export type HotelDemoQuestionId = (typeof HOTEL_DEMO_QUESTION_IDS)[number];
export type HotelDemoForbiddenAction = (typeof HOTEL_DEMO_FORBIDDEN_ACTIONS)[number];
export type HotelDemoDisclosureClaim = (typeof HOTEL_DEMO_REQUIRED_DISCLOSURE_CLAIMS)[number];
export type HotelDemoTaskStatus = (typeof HOTEL_DEMO_TASK_STATUSES)[number];
export type HotelDemoAttemptStatus = (typeof HOTEL_DEMO_ATTEMPT_STATUSES)[number];
export type WebMcpErrorCode = (typeof WEBMCP_ERROR_CODES)[number];
export type HotelDemoToolName = (typeof HOTEL_DEMO_TOOL_NAMES)[number];

export type DemoPolicy = {
  version: typeof HOTEL_DEMO_POLICY_VERSION;
  destinationIds: readonly [typeof HOTEL_DEMO_DESTINATION_ID];
  sourceLanguage: "ja-JP";
  outputLanguage: "en";
  objectiveId: typeof HOTEL_DEMO_OBJECTIVE_ID;
  disclosure: {
    id: typeof HOTEL_DEMO_DISCLOSURE_ID;
    locale: "ja-JP";
    text: string;
    requiredClaims: HotelDemoDisclosureClaim[];
    approvedAt: string;
  };
  allowedQuestionIds: HotelDemoQuestionId[];
  authority: "gather_facts_only";
  forbiddenActions: HotelDemoForbiddenAction[];
  maxAttempts: 1;
  maxConnectedSeconds: 180;
  automaticRetry: false;
  audioRecording: false;
};

export type CallDraft = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  taskId: string;
  revision: number;
  status: HotelDemoTaskStatus;
  policyVersion: typeof HOTEL_DEMO_POLICY_VERSION;
  owner: { isCurrentUser: true };
  destination: {
    id: typeof HOTEL_DEMO_DESTINATION_ID;
    displayName: string;
    maskedPhone: string;
  };
  objectiveId: typeof HOTEL_DEMO_OBJECTIVE_ID;
  questionIds: HotelDemoQuestionId[];
  sourceLanguage: "ja-JP";
  outputLanguage: "en";
  disclosure: DemoPolicy["disclosure"];
  authority: "gather_facts_only";
  forbiddenActions: HotelDemoForbiddenAction[];
  pricing:
    | { state: "not_ready" }
    | {
        state: "ready";
        revision: number;
        destinationCountry: string;
        destinationIsoCountry: string;
        rateDescription: string;
        currentPricePerMinute: string;
        currency: string;
        maximumConnectedSeconds: number;
        estimatedMaximumPstnCharge: string;
        quotedAt: string;
        expiresAt: string;
        source: "twilio_voice_number_pricing_api_v2" | "twilio_public_outbound_pricing_csv";
        accountSpecific: boolean;
      };
  confirmation: {
    state: "not_ready" | "ready" | "confirmed" | "expired";
    intentId: string | null;
    expiresAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type CreateCallDraftInput = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  idempotencyKey: string;
  questionIds: HotelDemoQuestionId[];
};

export type CreateCallDraftOutput = {
  taskId: string;
  revision: number;
  status: HotelDemoTaskStatus;
  draft: CallDraft;
};

export type UpdateCallDraftInput = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  taskId: string;
  expectedRevision: number;
  patch: { questionIds: HotelDemoQuestionId[] };
};

export type UpdateCallDraftOutput = {
  taskId: string;
  revision: number;
  status: "draft";
  confirmationReset: boolean;
  draft: CallDraft;
};

export type ReadCallDraftInput = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  taskId: string;
};

export type ReadCallDraftOutput = {
  taskId: string;
  revision: number;
  status: HotelDemoTaskStatus;
  draft: CallDraft;
};

export type AttemptEventBase = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  eventId: string;
  taskId: string;
  attemptId: string;
  workerSequence: number;
  observedAt: string;
  source: "telephony_worker";
};

export type AttemptEvent = AttemptEventBase & (
  | { type: "dispatch_accepted" | "dialing" | "connected"; publicPayload: Record<string, never> }
  | { type: "disclosure_delivered"; publicPayload: { disclosureId: typeof HOTEL_DEMO_DISCLOSURE_ID } }
  | { type: "question_started"; publicPayload: { questionId: HotelDemoQuestionId } }
  | {
      type: "fact_observed";
      publicPayload: {
        questionId: HotelDemoQuestionId;
        sourceText: string;
        translatedValue: string;
        extractionConfidence: number;
        translationConfidence: number;
      };
    }
  | { type: "prohibited_request_declined"; publicPayload: { action: HotelDemoForbiddenAction } }
  | {
      type: "policy_violation_detected";
      publicPayload: {
        category: "unauthorized_commitment" | "forbidden_action_attempt" | "disclosure_failure";
        evidenceExcerpt: string;
      };
    }
  | { type: "hangup_requested"; publicPayload: { reason: "user" | "connected_timeout" | "policy" } }
  | { type: "ended"; publicPayload: { reason: "completed" | "user" | "connected_timeout" | "remote_hangup" } }
  | { type: "failed"; publicPayload: { stage: "dispatch" | "dialing" | "connection" | "callback"; code: string } }
);

export type TaskActivityEvent = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  eventId: string;
  taskId: string;
  type:
    | "draft_created"
    | "draft_updated"
    | "confirmation_ready"
    | "confirmation_expired"
    | "confirmed"
    | "queued_cancelled"
    | "end_requested"
    | "result_ready";
  occurredAt: string;
  source: "callbridge_server";
  publicPayload: { revision: number };
};

export type PublicActivityItem = {
  activitySequence: number;
  projectedAt: string;
  gapBefore: boolean;
  event: TaskActivityEvent | AttemptEvent;
};

export type GetCallStatusInput = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  taskId: string;
  afterActivitySequence?: number;
};

export type GetCallStatusOutput = {
  taskStatus: HotelDemoTaskStatus;
  attemptStatus?: HotelDemoAttemptStatus;
  events: PublicActivityItem[];
  nextActivitySequence: number | null;
};

export type CallResult = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  taskId: string;
  attemptId: string;
  outcome: "answered" | "partial" | "no_answer" | "failed" | "stopped";
  sourceLanguage: "ja-JP";
  outputLanguage: "en";
  summary: string | null;
  facts: Array<{
    questionId: HotelDemoQuestionId;
    status: "reported" | "not_answered" | "ambiguous";
    value: string | null;
    evidence: { sourceEventId: string; sourceExcerpt: string } | null;
  }>;
  durationSeconds: number;
  disclosureStatus: "delivered" | "not_observed" | "failed";
  commitmentSafety: "none_observed" | "possible_violation";
  policyViolations: Array<{ eventId: string; description: string }>;
  terminalReason:
    | "completed"
    | "remote_hangup"
    | "no_answer"
    | "provider_failure"
    | "user_cancelled"
    | "user_ended"
    | "connected_timeout";
  terminalAt: string;
};

export type GetCallResultInput = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  taskId: string;
};

export type GetCallResultOutput =
  | { status: "not_ready" }
  | { status: "processing"; retryAfterMs: number }
  | { status: "ready"; result: CallResult }
  | {
      status: "failed";
      failure: { stage: "result_processing"; code: "RESULT_PROJECTION_FAILED"; retryable: false };
    };

export type WebMcpError = {
  code: WebMcpErrorCode;
  message: string;
  retryable: boolean;
};

const WEBMCP_ERROR_MESSAGES: Record<WebMcpErrorCode, string> = {
  AUTH_REQUIRED: "Sign in to CallBridge to continue.",
  FORBIDDEN: "You do not have access to this call task.",
  NOT_FOUND: "The call task was not found.",
  INVALID_INPUT: "The request does not match the hotel demo contract.",
  REVISION_CONFLICT: "The call draft changed. Reload it before trying again.",
  INVALID_STATE: "The call task is not in a state that allows this action.",
  DEMO_POLICY_DENIED: "The request is outside the controlled hotel demo policy.",
  RATE_UNAVAILABLE: "A current destination rate is required before this call can be confirmed.",
  UNSUPPORTED_ENVIRONMENT: "This browser does not support the required WebMCP interface.",
  INTERNAL_ERROR: "CallBridge could not complete the request.",
};

const RETRYABLE_WEBMCP_ERRORS = new Set<WebMcpErrorCode>([
  "AUTH_REQUIRED",
  "REVISION_CONFLICT",
  "RATE_UNAVAILABLE",
  "INTERNAL_ERROR",
]);

const INTERNAL_TO_WEBMCP_ERROR = {
  UNAUTHENTICATED: "AUTH_REQUIRED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "INVALID_INPUT",
  INVALID_INPUT: "INVALID_INPUT",
  STALE_REVISION: "REVISION_CONFLICT",
  REVISION_CONFLICT: "REVISION_CONFLICT",
  INVALID_TRANSITION: "INVALID_STATE",
  INVALID_STATE: "INVALID_STATE",
  INTENT_EXPIRED: "INVALID_STATE",
  INTENT_ALREADY_CONFIRMED: "INVALID_STATE",
  CALL_WINDOW_CLOSED: "DEMO_POLICY_DENIED",
  ENTITLEMENT_REQUIRED: "DEMO_POLICY_DENIED",
  DEMO_POLICY_DENIED: "DEMO_POLICY_DENIED",
  PRICE_QUOTE_REQUIRED: "RATE_UNAVAILABLE",
  PRICE_QUOTE_UNAVAILABLE: "RATE_UNAVAILABLE",
  UNSUPPORTED_ENVIRONMENT: "UNSUPPORTED_ENVIRONMENT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const satisfies Record<string, WebMcpErrorCode>;

type ErrorLike = {
  code?: unknown;
  data?: unknown;
};

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as ErrorLike;
  if (typeof candidate.code === "string") return candidate.code;
  if (candidate.data && typeof candidate.data === "object") {
    const nested = candidate.data as ErrorLike;
    if (typeof nested.code === "string") return nested.code;
  }
  return undefined;
}

export function toWebMcpError(error: unknown): WebMcpError {
  const internalCode = readErrorCode(error);
  const code = internalCode && internalCode in INTERNAL_TO_WEBMCP_ERROR
    ? INTERNAL_TO_WEBMCP_ERROR[internalCode as keyof typeof INTERNAL_TO_WEBMCP_ERROR]
    : "INTERNAL_ERROR";
  return {
    code,
    message: WEBMCP_ERROR_MESSAGES[code],
    retryable: RETRYABLE_WEBMCP_ERRORS.has(code),
  };
}

export function isHotelDemoQuestionId(value: unknown): value is HotelDemoQuestionId {
  return typeof value === "string" && (HOTEL_DEMO_QUESTION_IDS as readonly string[]).includes(value);
}

export function validateHotelDemoQuestionIds(value: unknown):
  | { ok: true; value: HotelDemoQuestionId[] }
  | { ok: false; error: WebMcpError } {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    return { ok: false, error: toWebMcpError({ code: "INVALID_INPUT" }) };
  }
  if (!value.every(isHotelDemoQuestionId) || new Set(value).size !== value.length) {
    return { ok: false, error: toWebMcpError({ code: "INVALID_INPUT" }) };
  }
  return { ok: true, value: [...value] };
}

type JsonSchema = Readonly<Record<string, unknown>>;

const schemaVersionProperty = { const: HOTEL_DEMO_SCHEMA_VERSION } as const;
const taskIdProperty = { type: "string", minLength: 1, maxLength: 128 } as const;
const idempotencyKeyProperty = { type: "string", minLength: 8, maxLength: 128 } as const;
const revisionProperty = { type: "integer", minimum: 1 } as const;
const questionIdsProperty = {
  type: "array",
  minItems: 1,
  maxItems: 4,
  uniqueItems: true,
  items: { enum: HOTEL_DEMO_QUESTION_IDS },
} as const;

export const hotelDemoToolInputSchemas = {
  create_call_draft: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "idempotencyKey", "questionIds"],
    properties: {
      schemaVersion: schemaVersionProperty,
      idempotencyKey: idempotencyKeyProperty,
      questionIds: questionIdsProperty,
    },
  },
  update_call_draft: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId", "expectedRevision", "patch"],
    properties: {
      schemaVersion: schemaVersionProperty,
      taskId: taskIdProperty,
      expectedRevision: revisionProperty,
      patch: {
        type: "object",
        additionalProperties: false,
        required: ["questionIds"],
        properties: { questionIds: questionIdsProperty },
      },
    },
  },
  read_call_draft: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId"],
    properties: { schemaVersion: schemaVersionProperty, taskId: taskIdProperty },
  },
  get_call_status: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId"],
    properties: {
      schemaVersion: schemaVersionProperty,
      taskId: taskIdProperty,
      afterActivitySequence: { type: "integer", minimum: 0 },
    },
  },
  get_call_result: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId"],
    properties: { schemaVersion: schemaVersionProperty, taskId: taskIdProperty },
  },
} as const satisfies Record<HotelDemoToolName, JsonSchema>;

export const HOTEL_DEMO_PUBLIC_ACTIVITY_PAGE_SIZE = 25 as const;
export const HOTEL_DEMO_MAX_PUBLIC_ATTEMPT_EVENTS = 64 as const;
export const HOTEL_DEMO_RETENTION_MS = 24 * 60 * 60 * 1_000;
export const HOTEL_DEMO_MAX_EVENT_BYTES = 4 * 1_024;
export const HOTEL_DEMO_MAX_DISPLAY_UTF8_BYTES = 240;
