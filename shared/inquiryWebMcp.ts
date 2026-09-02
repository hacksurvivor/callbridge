import {
  INQUIRY_CATEGORIES,
  INQUIRY_CONTRACT_SCHEMA_VERSION,
  INQUIRY_FORBIDDEN_ACTIONS,
  INQUIRY_REQUIRED_DISCLOSURE_CLAIMS,
  type InquiryCallContract,
} from "./inquiryContracts.js";
import type {
  InquiryCallResult,
  InquiryEventType,
  InquiryResultOutcome,
  InquiryTaskSnapshot,
  InquiryTaskStatus,
} from "./inquiryState.js";

export const INQUIRY_TOOL_NAMES = [
  "create_call_draft",
  "update_call_draft",
  "read_call_draft",
  "get_call_status",
  "get_call_result",
] as const;

export type InquiryToolName = (typeof INQUIRY_TOOL_NAMES)[number];

export type CreateInquiryDraftInput = {
  schemaVersion: typeof INQUIRY_CONTRACT_SCHEMA_VERSION;
  idempotencyKey: string;
  contract: InquiryCallContract;
};

export type UpdateInquiryDraftInput = {
  schemaVersion: typeof INQUIRY_CONTRACT_SCHEMA_VERSION;
  taskId: string;
  expectedRevision: number;
  contract: InquiryCallContract;
};

export type ReadInquiryDraftInput = {
  schemaVersion: typeof INQUIRY_CONTRACT_SCHEMA_VERSION;
  taskId: string;
};

export type GetInquiryStatusInput = ReadInquiryDraftInput & {
  afterSequence?: number;
};

export type GetInquiryResultInput = ReadInquiryDraftInput;

export type UpdateInquiryDraftOutput = {
  task: InquiryTaskSnapshot;
  confirmationReset: boolean;
};

export type InquiryActivityEvent = {
  eventId: string;
  sequence: number;
  type: InquiryEventType;
  source: "callbridge_server" | "telephony_worker";
  revision: number;
  executionRevision: string;
  occurredAt: string;
  questionId?: string;
};

export type GetInquiryStatusOutput = {
  taskId: string;
  taskStatus: InquiryTaskStatus;
  events: InquiryActivityEvent[];
  nextSequence: number | null;
};

export type InquiryProofReceipt = {
  schemaVersion: 1;
  taskId: string;
  attemptId: string;
  executionRevision: string;
  outcome: InquiryResultOutcome;
  callLanguage: string;
  resultLanguage: string;
  answeredQuestionIds: string[];
  unresolvedQuestionIds: string[];
  sourceEventIds: string[];
  durationSeconds: number;
  terminalReason: InquiryCallResult["terminalReason"];
  disclosureStatus: InquiryCallResult["disclosureStatus"];
  commitmentSafety: InquiryCallResult["commitmentSafety"];
  terminalAt: string;
  cost: {
    currency: string;
    status: "provider_reported" | "pending";
    actualMinorUnits: number | null;
  };
};

export type GetInquiryResultOutput =
  | { status: "not_ready" }
  | { status: "processing"; retryAfterMs: number }
  | {
      status: "failed";
      failure: { stage: "result_processing"; code: "RESULT_PROJECTION_FAILED"; retryable: false };
    }
  | {
      status: "ready";
      result: InquiryCallResult;
      receipt: InquiryProofReceipt;
    };

export const INQUIRY_WEBMCP_ERROR_CODES = [
  "AUTH_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "INVALID_INPUT",
  "REVISION_CONFLICT",
  "INVALID_STATE",
  "POLICY_DENIED",
  "CREDITS_REQUIRED",
  "PRICING_REQUIRED",
  "RATE_LIMITED",
  "RECIPIENT_OPTED_OUT",
  "PLAYBOOK_APPROVAL_REQUIRED",
  "UNSUPPORTED_ENVIRONMENT",
  "INTERNAL_ERROR",
] as const;

export type InquiryWebMcpErrorCode = (typeof INQUIRY_WEBMCP_ERROR_CODES)[number];

export type InquiryWebMcpError = {
  code: InquiryWebMcpErrorCode;
  message: string;
  retryable: boolean;
};

const ERROR_MESSAGES: Record<InquiryWebMcpErrorCode, string> = {
  AUTH_REQUIRED: "Sign in to CallBridge to continue.",
  FORBIDDEN: "You do not have access to this call task.",
  NOT_FOUND: "The call task was not found.",
  INVALID_INPUT: "The request does not match the CallBridge inquiry contract.",
  REVISION_CONFLICT: "The call draft changed. Read the current revision before trying again.",
  INVALID_STATE: "The call task is not in a state that allows this action.",
  POLICY_DENIED: "The request exceeds CallBridge's information-only authority.",
  CREDITS_REQUIRED: "Add enough CallBridge credits to cover the displayed spending limit.",
  PRICING_REQUIRED: "CallBridge needs a fresh destination price before this call can be confirmed.",
  RATE_LIMITED: "This call is temporarily limited to protect users and recipients. Try again later.",
  RECIPIENT_OPTED_OUT: "This recipient has asked CallBridge not to call this number again.",
  PLAYBOOK_APPROVAL_REQUIRED: "Approve this call playbook in the webpage before confirming.",
  UNSUPPORTED_ENVIRONMENT: "This browser does not support the required WebMCP interface.",
  INTERNAL_ERROR: "CallBridge could not complete the request.",
};

const RETRYABLE_ERRORS = new Set<InquiryWebMcpErrorCode>([
  "AUTH_REQUIRED",
  "REVISION_CONFLICT",
  "CREDITS_REQUIRED",
  "PRICING_REQUIRED",
  "RATE_LIMITED",
  "PLAYBOOK_APPROVAL_REQUIRED",
  "INTERNAL_ERROR",
]);

const INTERNAL_ERROR_MAP = {
  UNAUTHENTICATED: "AUTH_REQUIRED",
  AUTH_REQUIRED: "AUTH_REQUIRED",
  FORBIDDEN: "FORBIDDEN",
  NOT_FOUND: "NOT_FOUND",
  VALIDATION_FAILED: "INVALID_INPUT",
  INVALID_INPUT: "INVALID_INPUT",
  IDEMPOTENCY_CONFLICT: "INVALID_INPUT",
  ARTIFACT_SOURCE_NOT_ALLOWED: "POLICY_DENIED",
  ARTIFACT_SECRET_REJECTED: "POLICY_DENIED",
  UNSUPPORTED_PROVIDER: "POLICY_DENIED",
  UNAPPROVED_ASSET: "POLICY_DENIED",
  STALE_REVISION: "REVISION_CONFLICT",
  ARTIFACT_REVISION_CONFLICT: "REVISION_CONFLICT",
  REVISION_CONFLICT: "REVISION_CONFLICT",
  EXECUTION_REVISION_MISMATCH: "REVISION_CONFLICT",
  INTENT_REVOKED: "REVISION_CONFLICT",
  INVALID_TRANSITION: "INVALID_STATE",
  INVALID_ARTIFACT_TRANSITION: "INVALID_STATE",
  INVALID_STATE: "INVALID_STATE",
  INTENT_EXPIRED: "INVALID_STATE",
  INTENT_ALREADY_CONFIRMED: "INVALID_STATE",
  ATTEMPT_ALREADY_EXISTS: "INVALID_STATE",
  POLICY_DENIED: "POLICY_DENIED",
  INSUFFICIENT_CREDITS: "CREDITS_REQUIRED",
  PRICING_REQUIRED: "PRICING_REQUIRED",
  PRICING_UNAVAILABLE: "PRICING_REQUIRED",
  PRICING_LOCKED: "PRICING_REQUIRED",
  PRICING_RATE_LIMITED: "RATE_LIMITED",
  PRICING_REQUEST_SUPERSEDED: "PRICING_REQUIRED",
  PRICING_QUOTE_EXPIRED: "PRICING_REQUIRED",
  PRICING_REVISION_MISMATCH: "REVISION_CONFLICT",
  PRICING_DURATION_MISMATCH: "REVISION_CONFLICT",
  PRICING_CURRENCY_MISMATCH: "POLICY_DENIED",
  DESTINATION_COUNTRY_MISMATCH: "POLICY_DENIED",
  HIGH_RISK_DESTINATION_TYPE: "POLICY_DENIED",
  COST_CEILING_EXCEEDED: "POLICY_DENIED",
  RECIPIENT_OPTED_OUT: "RECIPIENT_OPTED_OUT",
  ACTIVE_CALL_LIMIT: "RATE_LIMITED",
  DESTINATION_BUSY: "RATE_LIMITED",
  USER_RATE_LIMITED: "RATE_LIMITED",
  DESTINATION_RATE_LIMITED: "RATE_LIMITED",
  PLAYBOOK_APPROVAL_REQUIRED: "PLAYBOOK_APPROVAL_REQUIRED",
  UNSUPPORTED_ENVIRONMENT: "UNSUPPORTED_ENVIRONMENT",
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const satisfies Record<string, InquiryWebMcpErrorCode>;

function readErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const candidate = error as { code?: unknown; data?: unknown };
  if (typeof candidate.code === "string") return candidate.code;
  if (candidate.data && typeof candidate.data === "object") {
    const nested = candidate.data as { code?: unknown };
    if (typeof nested.code === "string") return nested.code;
  }
  return undefined;
}

export function toInquiryWebMcpError(error: unknown): InquiryWebMcpError {
  const internalCode = readErrorCode(error);
  const code = internalCode && internalCode in INTERNAL_ERROR_MAP
    ? INTERNAL_ERROR_MAP[internalCode as keyof typeof INTERNAL_ERROR_MAP]
    : "INTERNAL_ERROR";
  return { code, message: ERROR_MESSAGES[code], retryable: RETRYABLE_ERRORS.has(code) };
}

type JsonSchema = Readonly<Record<string, unknown>>;

const identifier = { type: "string", pattern: "^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,62}[A-Za-z0-9])?$" } as const;
const boundedText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength }) as const;
const languageTag = { type: "string", pattern: "^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$" } as const;
const countryCode = { type: "string", pattern: "^[A-Z]{2}$" } as const;
const currencyCode = { type: "string", pattern: "^[A-Z]{3}$" } as const;

const questionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "prompt", "required"],
  properties: { id: identifier, prompt: boundedText(500), required: { type: "boolean" } },
} as const;

const shareableFactSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label", "value"],
  properties: {
    id: identifier,
    label: boundedText(120),
    value: boundedText(1_000),
    shareWhen: boundedText(300),
  },
} as const;

const playbookSchema = {
  type: "object",
  additionalProperties: false,
  required: ["id", "revision", "name", "source", "steps"],
  properties: {
    id: identifier,
    revision: { type: "integer", minimum: 1 },
    name: boundedText(120),
    source: { enum: ["system", "user_created"] },
    steps: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "instruction"],
        properties: { id: identifier, instruction: boundedText(500) },
      },
    },
  },
} as const;

const inquiryContractJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "schemaVersion",
    "category",
    "destination",
    "objective",
    "questions",
    "languages",
    "context",
    "disclosure",
    "costCeiling",
    "policy",
  ],
  properties: {
    schemaVersion: { const: INQUIRY_CONTRACT_SCHEMA_VERSION },
    category: { enum: INQUIRY_CATEGORIES },
    destination: {
      type: "object",
      additionalProperties: false,
      required: ["displayName", "e164PhoneNumber", "countryCode"],
      properties: {
        displayName: boundedText(300),
        e164PhoneNumber: { type: "string", pattern: "^\\+[1-9][0-9]{6,14}$" },
        countryCode,
        address: boundedText(500),
        website: { type: "string", minLength: 1, maxLength: 2_048 },
      },
    },
    objective: boundedText(1_000),
    questions: { type: "array", minItems: 1, maxItems: 20, items: questionSchema },
    languages: {
      type: "object",
      additionalProperties: false,
      required: ["call", "result"],
      properties: { call: languageTag, result: languageTag },
    },
    context: {
      type: "object",
      additionalProperties: false,
      required: ["shareableFacts"],
      properties: {
        privateBackground: boundedText(8_000),
        shareableFacts: { type: "array", maxItems: 30, items: shareableFactSchema },
      },
    },
    disclosure: {
      type: "object",
      additionalProperties: false,
      required: ["id", "locale", "text", "requiredClaims"],
      properties: {
        id: identifier,
        locale: languageTag,
        text: boundedText(1_000),
        requiredClaims: {
          type: "array",
          minItems: INQUIRY_REQUIRED_DISCLOSURE_CLAIMS.length,
          maxItems: INQUIRY_REQUIRED_DISCLOSURE_CLAIMS.length,
          uniqueItems: true,
          items: { enum: INQUIRY_REQUIRED_DISCLOSURE_CLAIMS },
        },
      },
    },
    playbook: playbookSchema,
    costCeiling: {
      type: "object",
      additionalProperties: false,
      required: ["currency", "maxTotalMinorUnits"],
      properties: {
        currency: currencyCode,
        maxTotalMinorUnits: { type: "integer", minimum: 1 },
      },
    },
    policy: {
      type: "object",
      additionalProperties: false,
      required: ["id", "authority", "forbiddenActions", "maxAttempts", "automaticRetry", "maxConnectedSeconds", "audioRecording"],
      properties: {
        id: identifier,
        authority: { const: "gather_information_only" },
        forbiddenActions: {
          type: "array",
          minItems: INQUIRY_FORBIDDEN_ACTIONS.length,
          maxItems: INQUIRY_FORBIDDEN_ACTIONS.length,
          uniqueItems: true,
          items: { enum: INQUIRY_FORBIDDEN_ACTIONS },
        },
        maxAttempts: { const: 1 },
        automaticRetry: { const: false },
        maxConnectedSeconds: { type: "integer", minimum: 30, maximum: 900 },
        audioRecording: { const: false },
      },
    },
  },
} as const;

const schemaVersion = { const: INQUIRY_CONTRACT_SCHEMA_VERSION } as const;
const taskId = { type: "string", minLength: 1, maxLength: 128 } as const;
const expectedRevision = { type: "integer", minimum: 1 } as const;

export const inquiryToolInputSchemas = {
  create_call_draft: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "idempotencyKey", "contract"],
    properties: {
      schemaVersion,
      idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
      contract: inquiryContractJsonSchema,
    },
  },
  update_call_draft: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId", "expectedRevision", "contract"],
    properties: { schemaVersion, taskId, expectedRevision, contract: inquiryContractJsonSchema },
  },
  read_call_draft: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId"],
    properties: { schemaVersion, taskId },
  },
  get_call_status: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId"],
    properties: {
      schemaVersion,
      taskId,
      afterSequence: { type: "integer", minimum: 0 },
    },
  },
  get_call_result: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId"],
    properties: { schemaVersion, taskId },
  },
} as const satisfies Record<InquiryToolName, JsonSchema>;
