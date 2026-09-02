import { z } from "zod";

export const TASK_ARTIFACT_SCHEMA_VERSION = 1 as const;
export const TASK_ARTIFACT_TYPES = [
  "conversation",
  "auth_required",
  "user_question",
  "evidence",
] as const;
export const TASK_ARTIFACT_STATUSES = ["active", "resolved", "superseded", "failed"] as const;
export const TASK_ARTIFACT_SOURCES = ["chatgpt", "callbridge_server", "channel_adapter", "user"] as const;

export const TASK_ARTIFACT_TOOL_NAMES = [
  "create_task_artifact",
  "update_task_artifact",
  "read_task_artifacts",
] as const;

export const ARTIFACT_PROVIDER_IDS = [
  "callbridge_demo",
  "airbnb",
  "booking_com",
  "google",
] as const;

export const APPROVED_EVIDENCE_ASSET_REFS = [
  "fixture:evidence:late-arrival-policy",
] as const;

const identifier = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9](?:[A-Za-z0-9:_-]{0,126}[A-Za-z0-9])?$/);
const shortText = z.string().trim().min(1).max(500);
const bodyText = z.string().trim().min(1).max(4_000);
const isoInstant = z.string().datetime({ offset: true });

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:password|passwd|passcode|one[- ]?time code|otp|api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|session[-_ ]?token|cookie)\s*[:=]\s*\S+/i,
  /\b(?:sk|rk|pk)[-_](?:live|test)[-_][A-Za-z0-9]{12,}\b/,
  /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  /\b\d{6}\b.*\b(?:otp|code|passcode)\b/i,
];

export function containsCredentialLikeText(value: string): boolean {
  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

function safeText<T extends z.ZodType<string>>(schema: T): T {
  return schema.refine((value) => !containsCredentialLikeText(value), {
    message: "Credential-like content is not allowed in task artifacts.",
  }) as T;
}

const participantSchema = z.object({
  id: identifier,
  displayName: safeText(shortText),
  role: z.enum(["user", "agent", "provider"]),
}).strict();

export const conversationMessageProjectionSchema = z.object({
  messageId: identifier,
  sequence: z.number().int().positive(),
  authorRole: z.enum(["agent", "provider"]),
  authorDisplayName: safeText(shortText),
  text: safeText(bodyText),
  state: z.enum(["draft", "observed"]),
  occurredAt: isoInstant,
}).strict();

export type ConversationMessageProjection = z.infer<typeof conversationMessageProjectionSchema>;

export const conversationArtifactSchema = z.object({
  type: z.literal("conversation"),
  channel: z.enum(["sms", "email", "whatsapp", "web_chat", "call_facts"]),
  title: safeText(shortText),
  participants: z.array(participantSchema).min(1).max(12),
  latestMessages: z.array(conversationMessageProjectionSchema).max(24),
  hasEarlierMessages: z.boolean(),
  simulated: z.boolean().optional(),
}).strict();

export const authRequiredArtifactSchema = z.object({
  type: z.literal("auth_required"),
  providerId: z.enum(ARTIFACT_PROVIDER_IDS),
  providerName: safeText(shortText),
  reason: safeText(bodyText),
  state: z.enum(["required", "waiting_for_user", "authorized", "expired", "failed"]),
  continuation: z.enum(["open_secure_browser", "oauth_redirect", "return_to_task"]),
  simulated: z.boolean().optional(),
}).strict();

const questionOptionSchema = z.object({ id: identifier, label: safeText(shortText) }).strict();

export const userQuestionArtifactSchema = z.object({
  type: z.literal("user_question"),
  prompt: safeText(bodyText),
  responseMode: z.enum(["text", "single_choice", "multi_choice"]),
  options: z.array(questionOptionSchema).min(1).max(12).optional(),
  response: z.object({
    value: z.union([safeText(bodyText), z.array(safeText(shortText)).min(1).max(12)]),
    submittedAt: isoInstant,
  }).strict().optional(),
  simulated: z.boolean().optional(),
}).strict().superRefine((value, ctx) => {
  if (value.responseMode === "text" && value.options !== undefined) {
    ctx.addIssue({ code: "custom", message: "Text questions cannot include options." });
  }
  if (value.responseMode !== "text" && !value.options?.length) {
    ctx.addIssue({ code: "custom", message: "Choice questions require options." });
  }
});

export const evidenceArtifactSchema = z.object({
  type: z.literal("evidence"),
  kind: z.enum(["screenshot", "document", "receipt"]),
  assetRef: z.enum(APPROVED_EVIDENCE_ASSET_REFS),
  caption: safeText(bodyText),
  capturedAt: isoInstant,
  provenance: z.enum(["user_upload", "browser_capture", "provider_receipt"]),
  redactionState: z.enum(["not_required", "redacted", "blocked"]),
  sha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  mimeType: z.enum(["image/png", "image/jpeg", "application/pdf"]).optional(),
  sizeBytes: z.number().int().positive().max(10_000_000).optional(),
  simulated: z.boolean().optional(),
}).strict();

export const artifactPayloadSchema = z.discriminatedUnion("type", [
  conversationArtifactSchema,
  authRequiredArtifactSchema,
  userQuestionArtifactSchema,
  evidenceArtifactSchema,
]);

export type ArtifactPayload = z.infer<typeof artifactPayloadSchema>;
export type ConversationArtifactPayload = z.infer<typeof conversationArtifactSchema>;
export type AuthRequiredArtifactPayload = z.infer<typeof authRequiredArtifactSchema>;
export type UserQuestionArtifactPayload = z.infer<typeof userQuestionArtifactSchema>;
export type EvidenceArtifactPayload = z.infer<typeof evidenceArtifactSchema>;

export type TaskArtifact<T extends ArtifactPayload = ArtifactPayload> = {
  schemaVersion: typeof TASK_ARTIFACT_SCHEMA_VERSION;
  artifactId: string;
  taskId: string;
  createdSequence: number;
  lastEventSequence: number;
  revision: number;
  type: T["type"];
  status: (typeof TASK_ARTIFACT_STATUSES)[number];
  visibility: "owner";
  source: (typeof TASK_ARTIFACT_SOURCES)[number];
  payload: T;
  createdAt: string;
  updatedAt: string;
};

const webMcpConversationCreateSchema = z.object({
  type: z.literal("conversation"),
  channel: z.enum(["sms", "email", "whatsapp", "web_chat", "call_facts"]),
  title: safeText(shortText),
  participants: z.array(participantSchema).min(1).max(12),
}).strict();

const webMcpAuthCreateSchema = z.object({
  type: z.literal("auth_required"),
  providerId: z.enum(ARTIFACT_PROVIDER_IDS),
  providerName: safeText(shortText),
  reason: safeText(bodyText),
  continuation: z.enum(["open_secure_browser", "oauth_redirect", "return_to_task"]),
}).strict();

const webMcpQuestionCreateSchema = z.object({
  type: z.literal("user_question"),
  prompt: safeText(bodyText),
  responseMode: z.enum(["text", "single_choice", "multi_choice"]),
  options: z.array(questionOptionSchema).min(1).max(12).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.responseMode === "text" && value.options !== undefined) {
    ctx.addIssue({ code: "custom", message: "Text questions cannot include options." });
  }
  if (value.responseMode !== "text" && !value.options?.length) {
    ctx.addIssue({ code: "custom", message: "Choice questions require options." });
  }
});

export const createArtifactPayloadSchema = z.discriminatedUnion("type", [
  webMcpConversationCreateSchema,
  webMcpAuthCreateSchema,
  webMcpQuestionCreateSchema,
]);

export type CreateArtifactPayload = z.infer<typeof createArtifactPayloadSchema>;

const conversationPatchSchema = z.object({
  type: z.literal("conversation"),
  title: safeText(shortText).optional(),
  appendAgentDraft: z.object({
    authorDisplayName: safeText(shortText),
    text: safeText(bodyText),
  }).strict().optional(),
  status: z.enum(["active", "superseded"]).optional(),
}).strict().refine((value) => value.title !== undefined || value.appendAgentDraft !== undefined || value.status !== undefined, {
  message: "At least one conversation change is required.",
});

const authPatchSchema = z.object({
  type: z.literal("auth_required"),
  reason: safeText(bodyText).optional(),
  state: z.enum(["required", "waiting_for_user"]).optional(),
  status: z.enum(["active", "superseded"]).optional(),
}).strict().refine((value) => value.reason !== undefined || value.state !== undefined || value.status !== undefined, {
  message: "At least one authorization change is required.",
});

const questionPatchSchema = z.object({
  type: z.literal("user_question"),
  prompt: safeText(bodyText).optional(),
  options: z.array(questionOptionSchema).min(1).max(12).optional(),
  status: z.enum(["active", "superseded"]).optional(),
}).strict().refine((value) => value.prompt !== undefined || value.options !== undefined || value.status !== undefined, {
  message: "At least one question change is required.",
});

export const webMcpAllowedArtifactPatchSchema = z.discriminatedUnion("type", [
  conversationPatchSchema,
  authPatchSchema,
  questionPatchSchema,
]);

export type WebMcpAllowedArtifactPatch = z.infer<typeof webMcpAllowedArtifactPatchSchema>;

export type CreateTaskArtifactInput = {
  schemaVersion: typeof TASK_ARTIFACT_SCHEMA_VERSION;
  taskId: string;
  expectedTaskRevision: number;
  idempotencyKey: string;
  artifact: CreateArtifactPayload;
};

export type UpdateTaskArtifactInput = {
  schemaVersion: typeof TASK_ARTIFACT_SCHEMA_VERSION;
  taskId: string;
  artifactId: string;
  expectedArtifactRevision: number;
  idempotencyKey: string;
  patch: WebMcpAllowedArtifactPatch;
};

export type ReadTaskArtifactsInput = {
  schemaVersion: typeof TASK_ARTIFACT_SCHEMA_VERSION;
  taskId: string;
  afterEventSequence?: number;
};

export type ReadTaskArtifactsOutput = {
  taskId: string;
  artifacts: TaskArtifact[];
  nextEventSequence: number | null;
};

export function parseCreateArtifactPayload(value: unknown): CreateArtifactPayload {
  return createArtifactPayloadSchema.parse(value);
}

export function parseWebMcpArtifactPatch(value: unknown): WebMcpAllowedArtifactPatch {
  return webMcpAllowedArtifactPatchSchema.parse(value);
}

export function parseArtifactPayload(value: unknown): ArtifactPayload {
  return artifactPayloadSchema.parse(value);
}

type JsonSchema = Readonly<Record<string, unknown>>;
const jsonIdentifier = { type: "string", minLength: 1, maxLength: 128, pattern: "^[A-Za-z0-9][A-Za-z0-9:_-]*$" } as const;
const jsonText = (maxLength: number) => ({ type: "string", minLength: 1, maxLength }) as const;
const jsonParticipant = {
  type: "object",
  additionalProperties: false,
  required: ["id", "displayName", "role"],
  properties: { id: jsonIdentifier, displayName: jsonText(500), role: { enum: ["user", "agent", "provider"] } },
} as const;
const jsonOption = {
  type: "object",
  additionalProperties: false,
  required: ["id", "label"],
  properties: { id: jsonIdentifier, label: jsonText(500) },
} as const;

const createArtifactJsonSchema = {
  oneOf: [
    {
      type: "object", additionalProperties: false, required: ["type", "channel", "title", "participants"],
      properties: { type: { const: "conversation" }, channel: { enum: ["sms", "email", "whatsapp", "web_chat", "call_facts"] }, title: jsonText(500), participants: { type: "array", minItems: 1, maxItems: 12, items: jsonParticipant } },
    },
    {
      type: "object", additionalProperties: false, required: ["type", "providerId", "providerName", "reason", "continuation"],
      properties: { type: { const: "auth_required" }, providerId: { enum: ARTIFACT_PROVIDER_IDS }, providerName: jsonText(500), reason: jsonText(4_000), continuation: { enum: ["open_secure_browser", "oauth_redirect", "return_to_task"] } },
    },
    {
      type: "object", additionalProperties: false, required: ["type", "prompt", "responseMode"],
      properties: { type: { const: "user_question" }, prompt: jsonText(4_000), responseMode: { enum: ["text", "single_choice", "multi_choice"] }, options: { type: "array", minItems: 1, maxItems: 12, items: jsonOption } },
    },
  ],
} as const;

const updatePatchJsonSchema = {
  oneOf: [
    {
      type: "object", additionalProperties: false, required: ["type"],
      properties: { type: { const: "conversation" }, title: jsonText(500), appendAgentDraft: { type: "object", additionalProperties: false, required: ["authorDisplayName", "text"], properties: { authorDisplayName: jsonText(500), text: jsonText(4_000) } }, status: { enum: ["active", "superseded"] } },
    },
    {
      type: "object", additionalProperties: false, required: ["type"],
      properties: { type: { const: "auth_required" }, reason: jsonText(4_000), state: { enum: ["required", "waiting_for_user"] }, status: { enum: ["active", "superseded"] } },
    },
    {
      type: "object", additionalProperties: false, required: ["type"],
      properties: { type: { const: "user_question" }, prompt: jsonText(4_000), options: { type: "array", minItems: 1, maxItems: 12, items: jsonOption }, status: { enum: ["active", "superseded"] } },
    },
  ],
} as const;

export const artifactToolInputSchemas = {
  create_task_artifact: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId", "expectedTaskRevision", "idempotencyKey", "artifact"],
    properties: {
      schemaVersion: { const: TASK_ARTIFACT_SCHEMA_VERSION },
      taskId: jsonIdentifier,
      expectedTaskRevision: { type: "integer", minimum: 1 },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
      artifact: createArtifactJsonSchema,
    },
  },
  update_task_artifact: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId", "artifactId", "expectedArtifactRevision", "idempotencyKey", "patch"],
    properties: {
      schemaVersion: { const: TASK_ARTIFACT_SCHEMA_VERSION },
      taskId: jsonIdentifier,
      artifactId: jsonIdentifier,
      expectedArtifactRevision: { type: "integer", minimum: 1 },
      idempotencyKey: { type: "string", minLength: 8, maxLength: 200 },
      patch: updatePatchJsonSchema,
    },
  },
  read_task_artifacts: {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "taskId"],
    properties: {
      schemaVersion: { const: TASK_ARTIFACT_SCHEMA_VERSION },
      taskId: jsonIdentifier,
      afterEventSequence: { type: "integer", minimum: 0 },
    },
  },
} as const satisfies Record<(typeof TASK_ARTIFACT_TOOL_NAMES)[number], JsonSchema>;
