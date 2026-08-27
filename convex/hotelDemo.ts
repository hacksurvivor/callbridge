import {
  internalMutationGeneric as internalMutation,
  internalQueryGeneric as internalQuery,
  makeFunctionReference,
  mutationGeneric as mutation,
  queryGeneric as query,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import {
  HOTEL_DEMO_FORBIDDEN_ACTIONS,
  HOTEL_DEMO_REQUIRED_DISCLOSURE_CLAIMS,
  HOTEL_DEMO_RETENTION_MS,
  HOTEL_DEMO_SCHEMA_VERSION,
  validateHotelDemoQuestionIds,
  type CallDraft,
  type HotelDemoTaskStatus,
  type TaskActivityEvent,
} from "../shared/hotelDemoContracts.js";
import {
  hotelDemoCallResultValidator,
  hotelDemoAttemptStatusValidator,
  hotelDemoCallDraftValidator,
  hotelDemoPublicActivityItemValidator,
  hotelDemoTaskStatusValidator,
} from "./hotelDemoValidators.js";

type AuthContext = {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
};

type DemoPolicyRuntime = {
  destinationDisplayName: string;
  destinationPhoneE164: string;
  destinationMaskedPhone: string;
  disclosureText: string;
  disclosureApprovedAt: string;
};

const expireConfirmationIntentRef = makeFunctionReference<
  "mutation",
  { taskId: string; intentId: string; expectedRevision: number },
  null
>("hotelDemo:expireConfirmationIntent");
const projectResultRef = makeFunctionReference<
  "mutation",
  { taskId: string; attemptId: string },
  unknown
>("hotelDemoResults:projectResult");

function requireText(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ConvexError({ code: "DEMO_POLICY_DENIED" });
  return value;
}

function loadApprovedPolicy(): DemoPolicyRuntime {
  if (
    process.env.CALLBRIDGE_DEMO_RECIPIENT_APPROVED !== "true"
    || process.env.CALLBRIDGE_DEMO_LEGAL_APPROVED !== "true"
  ) {
    throw new ConvexError({ code: "DEMO_POLICY_DENIED" });
  }
  const destinationPhoneE164 = requireText("CALLBRIDGE_DEMO_DESTINATION_PHONE_E164");
  if (!/^\+[1-9]\d{7,14}$/.test(destinationPhoneE164)) {
    throw new ConvexError({ code: "DEMO_POLICY_DENIED" });
  }
  return {
    destinationDisplayName: requireText("CALLBRIDGE_DEMO_DESTINATION_DISPLAY_NAME"),
    destinationPhoneE164,
    destinationMaskedPhone: requireText("CALLBRIDGE_DEMO_DESTINATION_MASKED_PHONE"),
    disclosureText: requireText("CALLBRIDGE_DEMO_DISCLOSURE_JA"),
    disclosureApprovedAt: requireText("CALLBRIDGE_DEMO_DISCLOSURE_APPROVED_AT"),
  };
}

async function requireOwnerId(ctx: AuthContext): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

function assertSchemaVersion(schemaVersion: number): void {
  if (schemaVersion !== HOTEL_DEMO_SCHEMA_VERSION) {
    throw new ConvexError({ code: "VALIDATION_FAILED" });
  }
}

function assertIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 128) {
    throw new ConvexError({ code: "VALIDATION_FAILED" });
  }
}

function projectDraft(task: {
  _id: unknown;
  status: HotelDemoTaskStatus;
  revision: number;
  destinationDisplayName: string;
  destinationMaskedPhone: string;
  questionIds: CallDraft["questionIds"];
  disclosureText: string;
  disclosureApprovedAt: string;
  pricingState: "not_ready" | "ready";
  pricingRevision?: number;
  pricingDestinationCountry?: string;
  pricingDestinationIsoCountry?: string;
  pricingRateDescription?: string;
  pricingCurrentPricePerMinute?: string;
  pricingCurrency?: string;
  pricingMaximumConnectedSeconds?: number;
  pricingEstimatedMaximumPstnCharge?: string;
  pricingQuotedAt?: string;
  pricingExpiresAt?: string;
  pricingSource?: "twilio_voice_number_pricing_api_v2" | "twilio_public_outbound_pricing_csv";
  pricingAccountSpecific?: boolean;
  confirmationState: CallDraft["confirmation"]["state"];
  confirmationIntentId?: unknown;
  confirmationExpiresAt?: string;
  createdAt: string;
  updatedAt: string;
}): CallDraft {
  const pricingReady = task.pricingState === "ready"
    && task.pricingRevision === task.revision
    && task.pricingDestinationCountry
    && task.pricingDestinationIsoCountry
    && task.pricingRateDescription
    && task.pricingCurrentPricePerMinute
    && task.pricingCurrency
    && task.pricingMaximumConnectedSeconds
    && task.pricingEstimatedMaximumPstnCharge
    && task.pricingQuotedAt
    && task.pricingExpiresAt
    && task.pricingSource
    && task.pricingAccountSpecific !== undefined;
  return {
    schemaVersion: 1,
    taskId: String(task._id),
    revision: task.revision,
    status: task.status,
    policyVersion: "hotel-ja-v1",
    owner: { isCurrentUser: true },
    destination: {
      id: "controlled-hotel",
      displayName: task.destinationDisplayName,
      maskedPhone: task.destinationMaskedPhone,
    },
    objectiveId: "late-check-in",
    questionIds: task.questionIds,
    sourceLanguage: "ja-JP",
    outputLanguage: "en",
    disclosure: {
      id: "ai-assistant-ja-v2",
      locale: "ja-JP",
      text: task.disclosureText,
      requiredClaims: [...HOTEL_DEMO_REQUIRED_DISCLOSURE_CLAIMS],
      approvedAt: task.disclosureApprovedAt,
    },
    authority: "gather_facts_only",
    forbiddenActions: [...HOTEL_DEMO_FORBIDDEN_ACTIONS],
    pricing: pricingReady ? {
      state: "ready",
      revision: task.pricingRevision!,
      destinationCountry: task.pricingDestinationCountry!,
      destinationIsoCountry: task.pricingDestinationIsoCountry!,
      rateDescription: task.pricingRateDescription!,
      currentPricePerMinute: task.pricingCurrentPricePerMinute!,
      currency: task.pricingCurrency!,
      maximumConnectedSeconds: task.pricingMaximumConnectedSeconds!,
      estimatedMaximumPstnCharge: task.pricingEstimatedMaximumPstnCharge!,
      quotedAt: task.pricingQuotedAt!,
      expiresAt: task.pricingExpiresAt!,
      source: task.pricingSource!,
      accountSpecific: task.pricingAccountSpecific!,
    } : { state: "not_ready" },
    confirmation: {
      state: task.confirmationState,
      intentId: task.confirmationIntentId ? String(task.confirmationIntentId) : null,
      expiresAt: task.confirmationExpiresAt ?? null,
    },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function appendTaskEvent(
  ctx: { db: any },
  taskId: any,
  type: TaskActivityEvent["type"],
  revision: number,
  occurredAt: string,
): Promise<void> {
  const task = await ctx.db.get("hotelDemoTasks", taskId);
  if (!task) throw new ConvexError({ code: "NOT_FOUND" });
  const sequence = task.nextActivitySequence;
  const event: TaskActivityEvent = {
    schemaVersion: 1,
    eventId: `${String(taskId)}:${sequence}:${type}`,
    taskId: String(taskId),
    type,
    occurredAt,
    source: "callbridge_server",
    publicPayload: { revision },
  };
  await ctx.db.insert("hotelDemoActivityEvents", {
    taskId,
    activitySequence: sequence,
    projectedAt: occurredAt,
    gapBefore: false,
    event,
  });
  await ctx.db.patch("hotelDemoTasks", taskId, { nextActivitySequence: sequence + 1 });
}

async function ownedTask(ctx: { db: any }, taskId: any, ownerId: string): Promise<any> {
  const task = await ctx.db.get("hotelDemoTasks", taskId);
  if (!task) throw new ConvexError({ code: "NOT_FOUND" });
  if (task.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
  return task;
}

async function assertRetentionHealthy(ctx: { db: any }): Promise<void> {
  const now = new Date().toISOString();
  const overdue = await ctx.db.query("hotelDemoTasks").withIndex("by_delete_at", (q: any) => q.lte("deleteAt", now)).first();
  const state = await ctx.db.query("hotelDemoRetentionState").withIndex("by_key", (q: any) => q.eq("key", "hotel-demo")).unique();
  if (overdue || (state && !state.healthy)) throw new ConvexError({ code: "DEMO_POLICY_DENIED" });
}

/*
  confirmed/queued -- acquire lease --> in_progress/dialing
  confirmed/queued -- user stop -----> stopped/cancelled
  in_progress/active -- user stop ---> stopped/ending
  terminal/* -- duplicate/late ------> unchanged
*/
function isTerminalTask(status: HotelDemoTaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

function isTerminalAttempt(status: string): boolean {
  return status === "ended" || status === "failed" || status === "cancelled" || status === "timed_out";
}

export const createCallDraft = mutation({
  args: {
    schemaVersion: v.number(),
    idempotencyKey: v.string(),
    questionIds: v.array(v.string()),
  },
  returns: v.object({
    taskId: v.string(),
    revision: v.number(),
    status: hotelDemoTaskStatusValidator,
    draft: hotelDemoCallDraftValidator,
  }),
  handler: async (ctx, args) => {
    assertSchemaVersion(args.schemaVersion);
    assertIdempotencyKey(args.idempotencyKey);
    const ownerId = await requireOwnerId(ctx);
    await assertRetentionHealthy(ctx);
    const ownerCreateKey = `${ownerId}:${args.idempotencyKey}`;
    const existing = await ctx.db
      .query("hotelDemoTasks")
      .withIndex("by_owner_create_key", (q) => q.eq("ownerCreateKey", ownerCreateKey))
      .unique();
    if (existing) {
      return {
        taskId: String(existing._id),
        revision: existing.revision,
        status: existing.status,
        draft: projectDraft(existing),
      };
    }
    const questions = validateHotelDemoQuestionIds(args.questionIds);
    if (!questions.ok) throw new ConvexError({ code: "VALIDATION_FAILED" });
    const policy = loadApprovedPolicy();
    const nowDate = new Date();
    const now = nowDate.toISOString();
    const taskId = await ctx.db.insert("hotelDemoTasks", {
      ownerId,
      ownerCreateKey,
      createIdempotencyKey: args.idempotencyKey,
      status: "draft",
      revision: 1,
      policyVersion: "hotel-ja-v1",
      destinationId: "controlled-hotel",
      destinationDisplayName: policy.destinationDisplayName,
      destinationPhoneE164: policy.destinationPhoneE164,
      destinationMaskedPhone: policy.destinationMaskedPhone,
      objectiveId: "late-check-in",
      questionIds: questions.value,
      disclosureText: policy.disclosureText,
      disclosureApprovedAt: policy.disclosureApprovedAt,
      pricingState: "not_ready",
      confirmationState: "not_ready",
      nextActivitySequence: 1,
      resultState: "not_ready",
      deleteAt: new Date(nowDate.getTime() + HOTEL_DEMO_RETENTION_MS).toISOString(),
      createdAt: now,
      updatedAt: now,
    });
    await appendTaskEvent(ctx, taskId, "draft_created", 1, now);
    const created = await ctx.db.get("hotelDemoTasks", taskId);
    if (!created) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return { taskId: String(taskId), revision: 1 as const, status: "draft" as const, draft: projectDraft(created) };
  },
});

export const updateCallDraft = mutation({
  args: {
    schemaVersion: v.number(),
    taskId: v.id("hotelDemoTasks"),
    expectedRevision: v.number(),
    patch: v.object({ questionIds: v.array(v.string()) }),
  },
  returns: v.object({
    taskId: v.string(),
    revision: v.number(),
    status: v.literal("draft"),
    confirmationReset: v.boolean(),
    draft: hotelDemoCallDraftValidator,
  }),
  handler: async (ctx, args) => {
    assertSchemaVersion(args.schemaVersion);
    const ownerId = await requireOwnerId(ctx);
    const task = await ownedTask(ctx, args.taskId, ownerId);
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (task.status !== "draft" && task.status !== "awaiting_confirmation") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    const attempt = await ctx.db.query("hotelDemoAttempts").withIndex("by_task", (q) => q.eq("taskId", args.taskId)).unique();
    if (attempt) throw new ConvexError({ code: "INVALID_TRANSITION" });
    const questions = validateHotelDemoQuestionIds(args.patch.questionIds);
    if (!questions.ok) throw new ConvexError({ code: "VALIDATION_FAILED" });
    const identical = questions.value.length === task.questionIds.length
      && questions.value.every((questionId, index) => questionId === task.questionIds[index]);
    if (identical) {
      return {
        taskId: String(task._id),
        revision: task.revision,
        status: "draft" as const,
        confirmationReset: false,
        draft: projectDraft(task),
      };
    }
    if (task.confirmationIntentId) {
      const intent = await ctx.db.get("hotelDemoConfirmationIntents", task.confirmationIntentId);
      if (intent?.state === "ready") await ctx.db.patch("hotelDemoConfirmationIntents", intent._id, { state: "revoked" });
    }
    const now = new Date().toISOString();
    const revision = task.revision + 1;
    await ctx.db.patch("hotelDemoTasks", task._id, {
      status: "draft",
      revision,
      questionIds: questions.value,
      pricingState: "not_ready",
      pricingRevision: undefined,
      pricingDestinationCountry: undefined,
      pricingDestinationIsoCountry: undefined,
      pricingRateDescription: undefined,
      pricingCurrentPricePerMinute: undefined,
      pricingCurrency: undefined,
      pricingMaximumConnectedSeconds: undefined,
      pricingEstimatedMaximumPstnCharge: undefined,
      pricingQuotedAt: undefined,
      pricingExpiresAt: undefined,
      pricingSource: undefined,
      pricingAccountSpecific: undefined,
      confirmationState: "not_ready",
      confirmationIntentId: undefined,
      confirmationExpiresAt: undefined,
      updatedAt: now,
    });
    await appendTaskEvent(ctx, task._id, "draft_updated", revision, now);
    const updated = await ctx.db.get("hotelDemoTasks", task._id);
    if (!updated) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return { taskId: String(task._id), revision, status: "draft" as const, confirmationReset: true, draft: projectDraft(updated) };
  },
});

export const readCallDraft = query({
  args: { schemaVersion: v.number(), taskId: v.id("hotelDemoTasks") },
  returns: v.object({
    taskId: v.string(),
    revision: v.number(),
    status: hotelDemoTaskStatusValidator,
    draft: hotelDemoCallDraftValidator,
  }),
  handler: async (ctx, args) => {
    assertSchemaVersion(args.schemaVersion);
    const ownerId = await requireOwnerId(ctx);
    const task = await ownedTask(ctx, args.taskId, ownerId);
    return { taskId: String(task._id), revision: task.revision, status: task.status, draft: projectDraft(task) };
  },
});

export const getCallStatus = query({
  args: {
    schemaVersion: v.number(),
    taskId: v.id("hotelDemoTasks"),
    afterActivitySequence: v.optional(v.number()),
  },
  returns: v.object({
    taskStatus: hotelDemoTaskStatusValidator,
    attemptStatus: v.optional(hotelDemoAttemptStatusValidator),
    events: v.array(hotelDemoPublicActivityItemValidator),
    nextActivitySequence: v.union(v.number(), v.null()),
  }),
  handler: async (ctx, args) => {
    assertSchemaVersion(args.schemaVersion);
    const ownerId = await requireOwnerId(ctx);
    const task = await ownedTask(ctx, args.taskId, ownerId);
    const after = args.afterActivitySequence ?? 0;
    const events = await ctx.db
      .query("hotelDemoActivityEvents")
      .withIndex("by_task_sequence", (q: any) => q.eq("taskId", args.taskId).gt("activitySequence", after))
      .take(25);
    const attempt = await ctx.db.query("hotelDemoAttempts").withIndex("by_task", (q) => q.eq("taskId", args.taskId)).unique();
    return {
      taskStatus: task.status,
      ...(attempt ? { attemptStatus: attempt.status } : {}),
      events: events.map(({ activitySequence, projectedAt, gapBefore, event }) => ({ activitySequence, projectedAt, gapBefore, event })),
      nextActivitySequence: events.length ? events[events.length - 1]!.activitySequence : null,
    };
  },
});

export const getCallResult = query({
  args: { schemaVersion: v.number(), taskId: v.id("hotelDemoTasks") },
  returns: v.union(
    v.object({ status: v.literal("not_ready") }),
    v.object({ status: v.literal("processing"), retryAfterMs: v.number() }),
    v.object({ status: v.literal("ready"), result: hotelDemoCallResultValidator }),
    v.object({
      status: v.literal("failed"),
      failure: v.object({ stage: v.literal("result_processing"), code: v.literal("RESULT_PROJECTION_FAILED"), retryable: v.literal(false) }),
    }),
  ),
  handler: async (ctx, args) => {
    assertSchemaVersion(args.schemaVersion);
    const ownerId = await requireOwnerId(ctx);
    const task = await ownedTask(ctx, args.taskId, ownerId);
    if (task.resultState === "ready") {
      const stored = await ctx.db.query("hotelDemoResults").withIndex("by_task", (q) => q.eq("taskId", task._id)).unique();
      if (stored) return { status: "ready" as const, result: stored.result };
      return { status: "processing" as const, retryAfterMs: 500 };
    }
    if (task.resultState === "processing") return { status: "processing" as const, retryAfterMs: 500 };
    if (task.resultState === "failed") {
      return { status: "failed" as const, failure: { stage: "result_processing" as const, code: "RESULT_PROJECTION_FAILED" as const, retryable: false as const } };
    }
    return { status: "not_ready" as const };
  },
});

export const createConfirmationIntent = mutation({
  args: {
    schemaVersion: v.number(),
    taskId: v.id("hotelDemoTasks"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.object({ intentId: v.string(), taskStatus: v.literal("awaiting_confirmation"), revision: v.number(), expiresAt: v.string() }),
  handler: async (ctx, args) => {
    assertSchemaVersion(args.schemaVersion);
    assertIdempotencyKey(args.idempotencyKey);
    loadApprovedPolicy();
    const ownerId = await requireOwnerId(ctx);
    const task = await ownedTask(ctx, args.taskId, ownerId);
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (
      task.pricingState !== "ready"
      || task.pricingRevision !== task.revision
      || !task.pricingExpiresAt
      || new Date(task.pricingExpiresAt) <= new Date()
    ) throw new ConvexError({ code: "PRICE_QUOTE_REQUIRED" });
    if (task.status !== "draft" && task.status !== "awaiting_confirmation") throw new ConvexError({ code: "INVALID_TRANSITION" });
    const ownerIdempotencyKey = `${ownerId}:${args.idempotencyKey}`;
    const existing = await ctx.db.query("hotelDemoConfirmationIntents").withIndex("by_owner_idempotency", (q) => q.eq("ownerIdempotencyKey", ownerIdempotencyKey)).unique();
    const nowDate = new Date();
    if (existing) {
      if (existing.taskId !== task._id || existing.expectedRevision !== task.revision) throw new ConvexError({ code: "VALIDATION_FAILED" });
      if (existing.state === "confirmed") throw new ConvexError({ code: "INTENT_ALREADY_CONFIRMED" });
      if (existing.state === "ready" && new Date(existing.expiresAt) > nowDate) {
        return { intentId: String(existing._id), taskStatus: "awaiting_confirmation" as const, revision: task.revision, expiresAt: existing.expiresAt };
      }
    }
    if (task.confirmationIntentId) {
      const prior = await ctx.db.get("hotelDemoConfirmationIntents", task.confirmationIntentId);
      if (prior?.state === "ready") await ctx.db.patch("hotelDemoConfirmationIntents", prior._id, { state: "revoked" });
    }
    const now = nowDate.toISOString();
    const expiresAt = new Date(Math.min(nowDate.getTime() + 5 * 60 * 1_000, new Date(task.pricingExpiresAt).getTime())).toISOString();
    const intentId = await ctx.db.insert("hotelDemoConfirmationIntents", {
      taskId: task._id,
      ownerId,
      ownerIdempotencyKey,
      expectedRevision: task.revision,
      state: "ready",
      expiresAt,
      createdAt: now,
    });
    await ctx.db.patch("hotelDemoTasks", task._id, {
      status: "awaiting_confirmation",
      confirmationState: "ready",
      confirmationIntentId: intentId,
      confirmationExpiresAt: expiresAt,
      updatedAt: now,
    });
    await appendTaskEvent(ctx, task._id, "confirmation_ready", task.revision, now);
    await ctx.scheduler.runAt(new Date(expiresAt).getTime(), expireConfirmationIntentRef, {
      taskId: String(task._id),
      intentId: String(intentId),
      expectedRevision: task.revision,
    });
    return { intentId: String(intentId), taskStatus: "awaiting_confirmation" as const, revision: task.revision, expiresAt };
  },
});

export const expireConfirmationIntent = internalMutation({
  args: {
    taskId: v.id("hotelDemoTasks"),
    intentId: v.id("hotelDemoConfirmationIntents"),
    expectedRevision: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const [task, intent] = await Promise.all([
      ctx.db.get("hotelDemoTasks", args.taskId),
      ctx.db.get("hotelDemoConfirmationIntents", args.intentId),
    ]);
    if (
      !task
      || !intent
      || intent.state !== "ready"
      || task.status !== "awaiting_confirmation"
      || task.revision !== args.expectedRevision
      || task.confirmationIntentId !== intent._id
    ) return null;
    const now = new Date().toISOString();
    await ctx.db.patch("hotelDemoConfirmationIntents", intent._id, { state: "expired" });
    await ctx.db.patch("hotelDemoTasks", task._id, {
      status: "draft",
      confirmationState: "expired",
      confirmationIntentId: undefined,
      confirmationExpiresAt: undefined,
      updatedAt: now,
    });
    await appendTaskEvent(ctx, task._id, "confirmation_expired", task.revision, now);
    return null;
  },
});

export const confirmAndQueue = mutation({
  args: {
    schemaVersion: v.number(),
    taskId: v.id("hotelDemoTasks"),
    expectedRevision: v.number(),
    confirmationIntentId: v.id("hotelDemoConfirmationIntents"),
    idempotencyKey: v.string(),
  },
  returns: v.object({ taskStatus: v.literal("confirmed"), attemptId: v.string(), attemptStatus: v.literal("queued"), revision: v.number() }),
  handler: async (ctx, args) => {
    assertSchemaVersion(args.schemaVersion);
    assertIdempotencyKey(args.idempotencyKey);
    loadApprovedPolicy();
    const ownerId = await requireOwnerId(ctx);
    const task = await ownedTask(ctx, args.taskId, ownerId);
    const ownerConfirmKey = `${ownerId}:${args.idempotencyKey}`;
    const repeated = await ctx.db.query("hotelDemoAttempts").withIndex("by_owner_confirm_key", (q) => q.eq("ownerConfirmKey", ownerConfirmKey)).unique();
    if (repeated) {
      if (repeated.taskId !== task._id) throw new ConvexError({ code: "VALIDATION_FAILED" });
      return { taskStatus: "confirmed" as const, attemptId: String(repeated._id), attemptStatus: "queued" as const, revision: task.revision };
    }
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (
      task.pricingState !== "ready"
      || task.pricingRevision !== task.revision
      || !task.pricingExpiresAt
      || new Date(task.pricingExpiresAt) <= new Date()
    ) throw new ConvexError({ code: "PRICE_QUOTE_REQUIRED" });
    if (task.status !== "awaiting_confirmation" || task.confirmationIntentId !== args.confirmationIntentId) throw new ConvexError({ code: "INVALID_TRANSITION" });
    const existingAttempt = await ctx.db.query("hotelDemoAttempts").withIndex("by_task", (q) => q.eq("taskId", task._id)).unique();
    if (existingAttempt) throw new ConvexError({ code: "INVALID_TRANSITION" });
    const intent = await ctx.db.get("hotelDemoConfirmationIntents", args.confirmationIntentId);
    if (!intent || intent.ownerId !== ownerId || intent.taskId !== task._id || intent.expectedRevision !== task.revision) throw new ConvexError({ code: "FORBIDDEN" });
    const nowDate = new Date();
    if (intent.state !== "ready" || new Date(intent.expiresAt) <= nowDate) {
      if (intent.state === "ready") await ctx.db.patch("hotelDemoConfirmationIntents", intent._id, { state: "expired" });
      throw new ConvexError({ code: "INTENT_EXPIRED" });
    }
    const now = nowDate.toISOString();
    const attemptId = await ctx.db.insert("hotelDemoAttempts", {
      taskId: task._id,
      ownerId,
      ownerConfirmKey,
      attemptNumber: 1,
      status: "queued",
      confirmedRevision: task.revision,
      confirmationIntentId: intent._id,
      nextWorkerSequence: 1,
      publicEventCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("hotelDemoConfirmationIntents", intent._id, { state: "confirmed", consumedAt: now });
    await ctx.db.patch("hotelDemoTasks", task._id, { status: "confirmed", confirmationState: "confirmed", updatedAt: now });
    await appendTaskEvent(ctx, task._id, "confirmed", task.revision, now);
    return { taskStatus: "confirmed" as const, attemptId: String(attemptId), attemptStatus: "queued" as const, revision: task.revision };
  },
});

export const requestStop = mutation({
  args: {
    schemaVersion: v.number(),
    taskId: v.id("hotelDemoTasks"),
    attemptId: v.id("hotelDemoAttempts"),
    expectedRevision: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.object({
    taskStatus: hotelDemoTaskStatusValidator,
    attemptStatus: hotelDemoAttemptStatusValidator,
  }),
  handler: async (ctx, args) => {
    assertSchemaVersion(args.schemaVersion);
    assertIdempotencyKey(args.idempotencyKey);
    const ownerId = await requireOwnerId(ctx);
    const task = await ownedTask(ctx, args.taskId, ownerId);
    const attempt = await ctx.db.get("hotelDemoAttempts", args.attemptId);
    if (!attempt || attempt.taskId !== task._id) throw new ConvexError({ code: "NOT_FOUND" });
    if (attempt.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    const ownerStopKey = `${ownerId}:${args.idempotencyKey}`;
    if (attempt.stopOwnerKey) {
      if (attempt.stopOwnerKey !== ownerStopKey) throw new ConvexError({ code: "INVALID_TRANSITION" });
      return { taskStatus: task.status, attemptStatus: attempt.status };
    }
    if (isTerminalTask(task.status) && isTerminalAttempt(attempt.status)) {
      return { taskStatus: task.status, attemptStatus: attempt.status };
    }
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    const now = new Date().toISOString();
    if (task.status === "confirmed" && attempt.status === "queued" && !attempt.dispatchLeaseAcquiredAt) {
      await ctx.db.patch("hotelDemoAttempts", attempt._id, {
        status: "cancelled",
        stopOwnerKey: ownerStopKey,
        terminalAt: now,
        terminalReason: "user_cancelled",
        updatedAt: now,
      });
      await ctx.db.patch("hotelDemoTasks", task._id, { status: "stopped", confirmationState: "confirmed", resultState: "processing", updatedAt: now });
      await appendTaskEvent(ctx, task._id, "queued_cancelled", task.revision, now);
      await ctx.scheduler.runAfter(0, projectResultRef, { taskId: String(task._id), attemptId: String(attempt._id) });
      return { taskStatus: "stopped" as const, attemptStatus: "cancelled" as const };
    }
    if (task.status === "in_progress" && (attempt.status === "dialing" || attempt.status === "connected")) {
      await ctx.db.patch("hotelDemoAttempts", attempt._id, {
        status: "ending",
        stopOwnerKey: ownerStopKey,
        hangupRequestedAt: now,
        updatedAt: now,
      });
      await ctx.db.patch("hotelDemoTasks", task._id, { status: "stopped", updatedAt: now });
      await appendTaskEvent(ctx, task._id, "end_requested", task.revision, now);
      return { taskStatus: "stopped" as const, attemptStatus: "ending" as const };
    }
    throw new ConvexError({ code: "INVALID_TRANSITION" });
  },
});

export const acquireDispatchLease = internalMutation({
  args: { taskId: v.id("hotelDemoTasks"), attemptId: v.id("hotelDemoAttempts") },
  returns: v.object({
    taskId: v.string(),
    attemptId: v.string(),
    ownerId: v.string(),
    confirmedRevision: v.number(),
    destinationPhoneE164: v.string(),
    destinationDisplayName: v.string(),
    questionIds: v.array(v.string()),
    disclosureText: v.string(),
  }),
  handler: async (ctx, args) => {
    const [task, attempt] = await Promise.all([
      ctx.db.get("hotelDemoTasks", args.taskId),
      ctx.db.get("hotelDemoAttempts", args.attemptId),
    ]);
    if (!task || !attempt || attempt.taskId !== task._id) throw new ConvexError({ code: "NOT_FOUND" });
    if (attempt.dispatchLeaseAcquiredAt && task.status === "in_progress" && (attempt.status === "dialing" || attempt.status === "connected")) {
      return {
        taskId: String(task._id),
        attemptId: String(attempt._id),
        ownerId: task.ownerId,
        confirmedRevision: attempt.confirmedRevision,
        destinationPhoneE164: task.destinationPhoneE164,
        destinationDisplayName: task.destinationDisplayName,
        questionIds: task.questionIds,
        disclosureText: task.disclosureText,
      };
    }
    if (task.status !== "confirmed" || attempt.status !== "queued" || attempt.dispatchLeaseAcquiredAt) {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    const now = new Date().toISOString();
    await ctx.db.patch("hotelDemoTasks", task._id, { status: "in_progress", updatedAt: now });
    await ctx.db.patch("hotelDemoAttempts", attempt._id, { status: "dialing", dispatchLeaseAcquiredAt: now, updatedAt: now });
    return {
      taskId: String(task._id),
      attemptId: String(attempt._id),
      ownerId: task.ownerId,
      confirmedRevision: attempt.confirmedRevision,
      destinationPhoneE164: task.destinationPhoneE164,
      destinationDisplayName: task.destinationDisplayName,
      questionIds: task.questionIds,
      disclosureText: task.disclosureText,
    };
  },
});

export const getPricingInput = internalQuery({
  args: {
    taskId: v.id("hotelDemoTasks"),
    ownerId: v.string(),
    expectedRevision: v.number(),
  },
  returns: v.object({
    taskId: v.string(),
    destinationPhoneE164: v.string(),
    revision: v.number(),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("hotelDemoTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== args.ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (task.status !== "draft" && task.status !== "awaiting_confirmation") throw new ConvexError({ code: "INVALID_TRANSITION" });
    return { taskId: String(task._id), destinationPhoneE164: task.destinationPhoneE164, revision: task.revision };
  },
});
