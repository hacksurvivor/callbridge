import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import {
  computeInquiryExecutionRevision,
  parseInquiryCallContract,
  parseInquiryPlaybook,
  type InquiryCallContract,
} from "../shared/inquiryContracts.js";
import {
  assertInquiryQuoteMatches,
  parseInquiryPricingQuote,
  type InquiryPricingQuote,
} from "../shared/inquiryPricing.js";
import { inquiryCallResultValidator } from "./inquiryValidators.js";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";

const CONFIRMATION_TTL_MS = 5 * 60 * 1_000;
const ABUSE_WINDOW_MS = 24 * 60 * 60 * 1_000;
const MAX_CALLS_PER_USER_WINDOW = 10;
const MAX_CALLS_PER_DESTINATION_WINDOW = 3;
const ACTIVE_ATTEMPT_STATUSES = ["queued", "dialing", "connected", "ending"] as const;

const taskSnapshotValidator = v.object({
  taskId: v.string(),
  status: v.string(),
  revision: v.number(),
  executionRevision: v.string(),
  contract: v.any(),
  confirmation: v.object({
    state: v.string(),
    intentId: v.union(v.string(), v.null()),
    expiresAt: v.union(v.string(), v.null()),
    confirmedExecutionRevision: v.union(v.string(), v.null()),
  }),
  resultState: v.string(),
  pricing: v.any(),
  createdAt: v.string(),
  updatedAt: v.string(),
});

const inquiryProofReceiptValidator = v.object({
  schemaVersion: v.literal(1),
  taskId: v.string(),
  attemptId: v.string(),
  executionRevision: v.string(),
  outcome: v.union(
    v.literal("answered"),
    v.literal("partial"),
    v.literal("no_answer"),
    v.literal("failed"),
    v.literal("stopped"),
  ),
  callLanguage: v.string(),
  resultLanguage: v.string(),
  answeredQuestionIds: v.array(v.string()),
  unresolvedQuestionIds: v.array(v.string()),
  sourceEventIds: v.array(v.string()),
  durationSeconds: v.number(),
  terminalReason: v.union(
    v.literal("completed"),
    v.literal("remote_hangup"),
    v.literal("no_answer"),
    v.literal("provider_failure"),
    v.literal("user_cancelled"),
    v.literal("user_ended"),
    v.literal("connected_timeout"),
    v.literal("recipient_declined"),
  ),
  disclosureStatus: v.union(v.literal("delivered"), v.literal("not_observed"), v.literal("failed")),
  commitmentSafety: v.union(v.literal("none_observed"), v.literal("possible_violation")),
  terminalAt: v.string(),
  cost: v.object({
    currency: v.string(),
    status: v.union(v.literal("provider_reported"), v.literal("pending")),
    actualMinorUnits: v.union(v.number(), v.null()),
  }),
});

const expireConfirmationIntentRef = makeFunctionReference<
  "mutation",
  { intentId: Id<"inquiryConfirmationIntents"> },
  null
>("inquiries:expireConfirmationIntent");

const dispatchInquiryRef = makeFunctionReference<
  "action",
  {
    taskId: Id<"inquiryTasks">;
    attemptId: Id<"inquiryAttempts">;
    expectedExecutionRevision: string;
    claimIdempotencyKey: string;
  },
  null
>("inquiryDispatchWorker:dispatch");

async function requireOwnerId(ctx: Pick<QueryCtx, "auth"> | Pick<MutationCtx, "auth">): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

function requireIdempotencyKey(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new ConvexError({ code: "INVALID_INPUT", field: "idempotencyKey" });
  }
  return normalized;
}

function requireCurrency(value: string): string {
  const normalized = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ConvexError({ code: "INVALID_INPUT", field: "currency" });
  }
  return normalized;
}

function requireIsoInstant(value: string, field: string): string {
  const timestamp = Date.parse(value);
  if (!value.includes("T") || !Number.isFinite(timestamp)) {
    throw new ConvexError({ code: "INVALID_INPUT", field });
  }
  return value;
}

function taskSnapshot(task: {
  _id: Id<"inquiryTasks">;
  status: string;
  revision: number;
  executionRevision: string;
  contract: InquiryCallContract;
  confirmationState: string;
  confirmationIntentId?: Id<"inquiryConfirmationIntents">;
  confirmationExpiresAt?: string;
  confirmedExecutionRevision?: string;
  pricingQuote?: unknown;
  resultState: string;
  createdAt: string;
  updatedAt: string;
}) {
  return {
    taskId: String(task._id),
    status: task.status,
    revision: task.revision,
    executionRevision: task.executionRevision,
    contract: task.contract,
    confirmation: {
      state: task.confirmationState,
      intentId: task.confirmationIntentId ? String(task.confirmationIntentId) : null,
      expiresAt: task.confirmationExpiresAt ?? null,
      confirmedExecutionRevision: task.confirmedExecutionRevision ?? null,
    },
    resultState: task.resultState,
    pricing: task.pricingQuote
      ? { status: "ready" as const, quote: parseInquiryPricingQuote(task.pricingQuote) }
      : { status: "not_ready" as const },
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

async function requireOwnedTask(
  ctx: QueryCtx | MutationCtx,
  taskId: Id<"inquiryTasks">,
  ownerId: string,
) {
  const task = await ctx.db.get("inquiryTasks", taskId);
  if (!task) throw new ConvexError({ code: "NOT_FOUND" });
  if (task.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
  return task;
}

async function appendEvent(
  ctx: MutationCtx,
  input: {
    taskId: Id<"inquiryTasks">;
    attemptId?: Id<"inquiryAttempts">;
    type:
      | "draft_created"
      | "draft_updated"
      | "confirmation_ready"
      | "confirmation_revoked"
      | "confirmed"
      | "credit_reserved"
      | "attempt_queued"
      | "result_ready";
    occurredAt: string;
  },
): Promise<void> {
  const task = await ctx.db.get("inquiryTasks", input.taskId);
  if (!task) throw new ConvexError({ code: "NOT_FOUND" });
  const sequence = task.nextEventSequence;
  await ctx.db.insert("inquiryEvents", {
    taskId: input.taskId,
    ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    eventId: `server:${input.taskId}:${sequence}`,
    sequence,
    type: input.type,
    source: "callbridge_server",
    revision: task.revision,
    executionRevision: task.executionRevision,
    occurredAt: input.occurredAt,
  });
  await ctx.db.patch("inquiryTasks", input.taskId, { nextEventSequence: sequence + 1 });
}

async function revokeReadyIntents(
  ctx: MutationCtx,
  taskId: Id<"inquiryTasks">,
  occurredAt: string,
): Promise<boolean> {
  const intents = await ctx.db
    .query("inquiryConfirmationIntents")
    .withIndex("by_task", (q) => q.eq("taskId", taskId))
    .collect();
  let revoked = false;
  for (const intent of intents) {
    if (intent.state === "ready") {
      await ctx.db.patch("inquiryConfirmationIntents", intent._id, { state: "revoked" });
      revoked = true;
    }
  }
  if (revoked) await appendEvent(ctx, { taskId, type: "confirmation_revoked", occurredAt });
  return revoked;
}

function playbookKey(ownerId: string, source: "system" | "user_created", id: string): string {
  return source === "system" ? `system:${id}` : `${ownerId}:${id}`;
}

async function requireApprovedPlaybook(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  contract: InquiryCallContract,
): Promise<void> {
  if (!contract.playbook) return;
  const key = playbookKey(ownerId, contract.playbook.source, contract.playbook.id);
  const stored = await ctx.db
    .query("inquiryPlaybooks")
    .withIndex("by_playbook_key", (q) => q.eq("playbookKey", key))
    .unique();
  if (
    !stored ||
    stored.status !== "approved" ||
    stored.approvedRevision !== contract.playbook.revision ||
    stored.name !== contract.playbook.name ||
    JSON.stringify(stored.steps) !== JSON.stringify(contract.playbook.steps)
  ) {
    throw new ConvexError({ code: "PLAYBOOK_APPROVAL_REQUIRED" });
  }
}

async function requireAvailableCredits(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  contract: InquiryCallContract,
) {
  const currency = contract.costCeiling.currency;
  const ownerCurrencyKey = `${ownerId}:${currency}`;
  const account = await ctx.db
    .query("inquiryCreditAccounts")
    .withIndex("by_owner_currency", (q) => q.eq("ownerCurrencyKey", ownerCurrencyKey))
    .unique();
  const availableMinorUnits = account
    ? account.balanceMinorUnits - account.reservedMinorUnits
    : 0;
  if (!account || availableMinorUnits < contract.costCeiling.maxTotalMinorUnits) {
    throw new ConvexError({
      code: "INSUFFICIENT_CREDITS",
      currency,
      requiredMinorUnits: contract.costCeiling.maxTotalMinorUnits,
      availableMinorUnits,
    });
  }
  return account;
}

function requireCurrentPricingQuote(task: {
  revision: number;
  executionRevision: string;
  contract: InquiryCallContract;
  pricingQuote?: unknown;
}): InquiryPricingQuote {
  if (!task.pricingQuote) throw new ConvexError({ code: "PRICING_REQUIRED" });
  const quote = parseInquiryPricingQuote(task.pricingQuote);
  try {
    assertInquiryQuoteMatches({
      quote,
      revision: task.revision,
      executionRevision: task.executionRevision,
      destinationCountryCode: task.contract.destination.countryCode,
      maximumConnectedSeconds: task.contract.policy.maxConnectedSeconds,
      costCeiling: task.contract.costCeiling,
    });
  } catch (error) {
    throw new ConvexError({
      code: error instanceof Error ? error.message : "PRICING_INVALID",
    });
  }
  return quote;
}

async function requireDestinationSafety(
  ctx: QueryCtx | MutationCtx,
  ownerId: string,
  destinationE164: string,
): Promise<void> {
  const optOut = await ctx.db
    .query("inquiryRecipientOptOuts")
    .withIndex("by_destination", (q) => q.eq("destinationE164", destinationE164))
    .unique();
  if (optOut) throw new ConvexError({ code: "RECIPIENT_OPTED_OUT" });

  for (const status of ACTIVE_ATTEMPT_STATUSES) {
    const [ownerActive, destinationActive] = await Promise.all([
      ctx.db
        .query("inquiryAttempts")
        .withIndex("by_owner_status", (q) => q.eq("ownerId", ownerId).eq("status", status))
        .first(),
      ctx.db
        .query("inquiryAttempts")
        .withIndex("by_destination_status", (q) => q.eq("destinationE164", destinationE164).eq("status", status))
        .first(),
    ]);
    if (ownerActive) throw new ConvexError({ code: "ACTIVE_CALL_LIMIT" });
    if (destinationActive) throw new ConvexError({ code: "DESTINATION_BUSY" });
  }

  const cutoff = new Date(Date.now() - ABUSE_WINDOW_MS).toISOString();
  const countedDispatchStates = ["accepted", "creation_uncertain"] as const;
  const ownerWindows = await Promise.all(countedDispatchStates.map((dispatchState) => (
    ctx.db
      .query("inquiryAttempts")
      .withIndex("by_owner_dispatch_created_at", (q) => q
        .eq("ownerId", ownerId)
        .eq("dispatchState", dispatchState)
        .gte("createdAt", cutoff))
      .take(MAX_CALLS_PER_USER_WINDOW)
  )));
  const destinationWindows = await Promise.all(countedDispatchStates.map((dispatchState) => (
    ctx.db
      .query("inquiryAttempts")
      .withIndex("by_destination_dispatch_created_at", (q) => q
        .eq("destinationE164", destinationE164)
        .eq("dispatchState", dispatchState)
        .gte("createdAt", cutoff))
      .take(MAX_CALLS_PER_DESTINATION_WINDOW)
  )));
  if (ownerWindows.reduce((total, attempts) => total + attempts.length, 0) >= MAX_CALLS_PER_USER_WINDOW) {
    throw new ConvexError({ code: "USER_RATE_LIMITED", retryAfterSeconds: 60 * 60 });
  }
  if (destinationWindows.reduce((total, attempts) => total + attempts.length, 0) >= MAX_CALLS_PER_DESTINATION_WINDOW) {
    throw new ConvexError({ code: "DESTINATION_RATE_LIMITED", retryAfterSeconds: 60 * 60 });
  }
}

export const createDraft = mutation({
  args: {
    idempotencyKey: v.string(),
    contract: v.any(),
  },
  returns: taskSnapshotValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const ownerCreateKey = `${ownerId}:${idempotencyKey}`;
    const contract = parseInquiryCallContract(args.contract);
    const executionRevision = await computeInquiryExecutionRevision(contract);
    const existing = await ctx.db
      .query("inquiryTasks")
      .withIndex("by_owner_create_key", (q) => q.eq("ownerCreateKey", ownerCreateKey))
      .unique();
    if (existing) {
      if (existing.createExecutionRevision !== executionRevision) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return taskSnapshot(existing);
    }
    const now = new Date().toISOString();
    const taskId = await ctx.db.insert("inquiryTasks", {
      ownerId,
      ownerCreateKey,
      createIdempotencyKey: idempotencyKey,
      createExecutionRevision: executionRevision,
      status: "draft",
      revision: 1,
      executionRevision,
      contract,
      confirmationState: "not_ready",
      nextEventSequence: 1,
      resultState: "not_ready",
      createdAt: now,
      updatedAt: now,
    });
    await appendEvent(ctx, { taskId, type: "draft_created", occurredAt: now });
    const created = await ctx.db.get("inquiryTasks", taskId);
    if (!created) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return taskSnapshot(created);
  },
});

export const readDraft = query({
  args: { taskId: v.id("inquiryTasks") },
  returns: taskSnapshotValidator,
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const task = await requireOwnedTask(ctx, args.taskId, ownerId);
    return taskSnapshot(task);
  },
});

export const listMine = query({
  args: {},
  returns: v.array(taskSnapshotValidator),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const tasks = await ctx.db
      .query("inquiryTasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(50);
    return tasks.map(taskSnapshot);
  },
});

export const updateDraft = mutation({
  args: {
    taskId: v.id("inquiryTasks"),
    expectedRevision: v.number(),
    contract: v.any(),
  },
  returns: v.object({
    task: taskSnapshotValidator,
    confirmationReset: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const task = await requireOwnedTask(ctx, args.taskId, ownerId);
    if (task.status !== "draft" && task.status !== "awaiting_confirmation") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });

    const contract = parseInquiryCallContract(args.contract);
    const executionRevision = await computeInquiryExecutionRevision(contract);
    if (executionRevision === task.executionRevision) {
      return { task: taskSnapshot(task), confirmationReset: false };
    }

    const now = new Date().toISOString();
    const confirmationReset = await revokeReadyIntents(ctx, task._id, now);
    await ctx.db.patch("inquiryTasks", task._id, {
      status: "draft",
      revision: task.revision + 1,
      executionRevision,
      contract,
      pricingQuote: undefined,
      pricingRequestId: undefined,
      pricingRequestedAt: undefined,
      confirmationState: confirmationReset ? "revoked" : "not_ready",
      confirmationIntentId: undefined,
      confirmationExpiresAt: undefined,
      confirmedExecutionRevision: undefined,
      updatedAt: now,
    });
    await appendEvent(ctx, { taskId: task._id, type: "draft_updated", occurredAt: now });
    const updated = await ctx.db.get("inquiryTasks", task._id);
    if (!updated) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return { task: taskSnapshot(updated), confirmationReset };
  },
});

export const createConfirmationIntent = mutation({
  args: {
    taskId: v.id("inquiryTasks"),
    expectedRevision: v.number(),
    expectedExecutionRevision: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.object({ intentId: v.string(), expiresAt: v.string(), executionRevision: v.string(), pricingQuoteId: v.string() }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const ownerIntentKey = `${ownerId}:${idempotencyKey}`;
    const existing = await ctx.db
      .query("inquiryConfirmationIntents")
      .withIndex("by_owner_intent_key", (q) => q.eq("ownerIntentKey", ownerIntentKey))
      .unique();
    if (existing) {
      if (
        existing.taskId !== args.taskId ||
        existing.expectedRevision !== args.expectedRevision ||
        existing.executionRevision !== args.expectedExecutionRevision
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return {
        intentId: String(existing._id),
        expiresAt: existing.expiresAt,
        executionRevision: existing.executionRevision,
        pricingQuoteId: existing.pricingQuoteId,
      };
    }

    const task = await requireOwnedTask(ctx, args.taskId, ownerId);
    if (task.status !== "draft" && task.status !== "awaiting_confirmation") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (task.executionRevision !== args.expectedExecutionRevision) {
      throw new ConvexError({ code: "EXECUTION_REVISION_MISMATCH" });
    }
    await requireApprovedPlaybook(ctx, ownerId, task.contract);
    await requireAvailableCredits(ctx, ownerId, task.contract);
    const pricingQuote = requireCurrentPricingQuote(task);
    await requireDestinationSafety(ctx, ownerId, task.contract.destination.e164PhoneNumber);

    const nowDate = new Date();
    const now = nowDate.toISOString();
    const expiresAt = new Date(Math.min(
      nowDate.getTime() + CONFIRMATION_TTL_MS,
      Date.parse(pricingQuote.quote.expiresAt),
    )).toISOString();
    await revokeReadyIntents(ctx, task._id, now);
    const intentId = await ctx.db.insert("inquiryConfirmationIntents", {
      taskId: task._id,
      ownerId,
      ownerIntentKey,
      expectedRevision: task.revision,
      executionRevision: task.executionRevision,
      pricingQuoteId: pricingQuote.quoteId,
      state: "ready",
      expiresAt,
      createdAt: now,
    });
    await ctx.db.patch("inquiryTasks", task._id, {
      status: "awaiting_confirmation",
      confirmationState: "ready",
      confirmationIntentId: intentId,
      confirmationExpiresAt: expiresAt,
      updatedAt: now,
    });
    await appendEvent(ctx, { taskId: task._id, type: "confirmation_ready", occurredAt: now });
    await ctx.scheduler.runAt(new Date(expiresAt).getTime(), expireConfirmationIntentRef, { intentId });
    return {
      intentId: String(intentId),
      expiresAt,
      executionRevision: task.executionRevision,
      pricingQuoteId: pricingQuote.quoteId,
    };
  },
});

export const expireConfirmationIntent = internalMutation({
  args: { intentId: v.id("inquiryConfirmationIntents") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const intent = await ctx.db.get("inquiryConfirmationIntents", args.intentId);
    if (!intent || intent.state !== "ready") return null;
    if (Date.parse(intent.expiresAt) > Date.now()) {
      await ctx.scheduler.runAt(Date.parse(intent.expiresAt) + 1, expireConfirmationIntentRef, { intentId: intent._id });
      return null;
    }
    await ctx.db.patch("inquiryConfirmationIntents", intent._id, { state: "expired" });
    const task = await ctx.db.get("inquiryTasks", intent.taskId);
    if (task?.confirmationIntentId === intent._id && task.status === "awaiting_confirmation") {
      await ctx.db.patch("inquiryTasks", task._id, {
        status: "draft",
        confirmationState: "expired",
        confirmationIntentId: undefined,
        confirmationExpiresAt: undefined,
        updatedAt: new Date().toISOString(),
      });
    }
    return null;
  },
});

export const confirmAndQueue = mutation({
  args: {
    taskId: v.id("inquiryTasks"),
    expectedRevision: v.number(),
    expectedExecutionRevision: v.string(),
    confirmationIntentId: v.id("inquiryConfirmationIntents"),
    idempotencyKey: v.string(),
  },
  returns: v.object({
    taskId: v.string(),
    attemptId: v.string(),
    reservationId: v.string(),
    revision: v.number(),
    executionRevision: v.string(),
    taskStatus: v.literal("confirmed"),
    attemptStatus: v.literal("queued"),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    const ownerConfirmKey = `${ownerId}:${idempotencyKey}`;
    const existingAttempt = await ctx.db
      .query("inquiryAttempts")
      .withIndex("by_owner_confirm_key", (q) => q.eq("ownerConfirmKey", ownerConfirmKey))
      .unique();
    if (existingAttempt) {
      if (
        existingAttempt.taskId !== args.taskId ||
        existingAttempt.confirmationIntentId !== args.confirmationIntentId ||
        existingAttempt.confirmedExecutionRevision !== args.expectedExecutionRevision
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return {
        taskId: String(existingAttempt.taskId),
        attemptId: String(existingAttempt._id),
        reservationId: String(existingAttempt.creditReservationId),
        revision: existingAttempt.confirmedRevision,
        executionRevision: existingAttempt.confirmedExecutionRevision,
        taskStatus: "confirmed" as const,
        attemptStatus: "queued" as const,
      };
    }

    const task = await requireOwnedTask(ctx, args.taskId, ownerId);
    const intent = await ctx.db.get("inquiryConfirmationIntents", args.confirmationIntentId);
    if (!intent || intent.taskId !== task._id || intent.ownerId !== ownerId) {
      throw new ConvexError({ code: "NOT_FOUND" });
    }
    if (Date.parse(intent.expiresAt) <= Date.now() || intent.state === "expired") {
      throw new ConvexError({ code: "INTENT_EXPIRED" });
    }
    if (intent.state === "revoked") throw new ConvexError({ code: "INTENT_REVOKED" });
    if (intent.state !== "ready") throw new ConvexError({ code: "INTENT_ALREADY_CONFIRMED" });
    if (
      task.status !== "awaiting_confirmation" ||
      task.confirmationIntentId !== intent._id ||
      task.revision !== args.expectedRevision ||
      intent.expectedRevision !== args.expectedRevision
    ) {
      throw new ConvexError({ code: "STALE_REVISION" });
    }
    if (
      task.executionRevision !== args.expectedExecutionRevision ||
      intent.executionRevision !== args.expectedExecutionRevision
    ) {
      throw new ConvexError({ code: "EXECUTION_REVISION_MISMATCH" });
    }
    await requireApprovedPlaybook(ctx, ownerId, task.contract);
    const pricingQuote = requireCurrentPricingQuote(task);
    if (intent.pricingQuoteId !== pricingQuote.quoteId) {
      throw new ConvexError({ code: "PRICING_REVISION_MISMATCH" });
    }
    await requireDestinationSafety(ctx, ownerId, task.contract.destination.e164PhoneNumber);
    const account = await requireAvailableCredits(ctx, ownerId, task.contract);
    const existingTaskAttempt = await ctx.db
      .query("inquiryAttempts")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .unique();
    if (existingTaskAttempt) throw new ConvexError({ code: "ATTEMPT_ALREADY_EXISTS" });

    const now = new Date().toISOString();
    const reservedMinorUnits = task.contract.costCeiling.maxTotalMinorUnits;
    const ownerCurrencyKey = `${ownerId}:${task.contract.costCeiling.currency}`;
    const reservationId = await ctx.db.insert("inquiryCreditReservations", {
      taskId: task._id,
      ownerId,
      ownerCurrencyKey,
      executionRevision: task.executionRevision,
      currency: task.contract.costCeiling.currency,
      reservedMinorUnits,
      state: "reserved",
      createdAt: now,
    });
    await ctx.db.patch("inquiryCreditAccounts", account._id, {
      reservedMinorUnits: account.reservedMinorUnits + reservedMinorUnits,
      updatedAt: now,
    });
    await ctx.db.insert("inquiryCreditLedger", {
      ownerId,
      currency: task.contract.costCeiling.currency,
      entryKey: `reserve:${reservationId}`,
      kind: "reserve",
      amountMinorUnits: reservedMinorUnits,
      taskId: task._id,
      reservationId,
      occurredAt: now,
    });
    const attemptId = await ctx.db.insert("inquiryAttempts", {
      taskId: task._id,
      ownerId,
      destinationE164: task.contract.destination.e164PhoneNumber,
      ownerConfirmKey,
      attemptNumber: 1,
      status: "queued",
      confirmedRevision: task.revision,
      confirmedExecutionRevision: task.executionRevision,
      confirmationIntentId: intent._id,
      creditReservationId: reservationId,
      nextWorkerSequence: 1,
      dispatchState: "pending",
      dispatchIdempotencyKey: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("inquiryConfirmationIntents", intent._id, { state: "confirmed", consumedAt: now });
    await ctx.db.patch("inquiryTasks", task._id, {
      status: "confirmed",
      confirmationState: "confirmed",
      confirmedExecutionRevision: task.executionRevision,
      confirmedAt: now,
      creditReservationId: reservationId,
      updatedAt: now,
    });
    await appendEvent(ctx, { taskId: task._id, attemptId, type: "confirmed", occurredAt: now });
    await appendEvent(ctx, { taskId: task._id, attemptId, type: "credit_reserved", occurredAt: now });
    await appendEvent(ctx, { taskId: task._id, attemptId, type: "attempt_queued", occurredAt: now });
    if (process.env.CALLBRIDGE_AUTOMATIC_DISPATCH_ENABLED === "true") {
      await ctx.scheduler.runAfter(0, dispatchInquiryRef, {
        taskId: task._id,
        attemptId,
        expectedExecutionRevision: task.executionRevision,
        claimIdempotencyKey: `dispatch:${attemptId}`,
      });
    }
    return {
      taskId: String(task._id),
      attemptId: String(attemptId),
      reservationId: String(reservationId),
      revision: task.revision,
      executionRevision: task.executionRevision,
      taskStatus: "confirmed" as const,
      attemptStatus: "queued" as const,
    };
  },
});

export const grantCredits = internalMutation({
  args: {
    ownerId: v.string(),
    currency: v.string(),
    amountMinorUnits: v.number(),
    idempotencyKey: v.string(),
  },
  returns: v.object({ balanceMinorUnits: v.number(), reservedMinorUnits: v.number(), currency: v.string() }),
  handler: async (ctx, args) => {
    const currency = requireCurrency(args.currency);
    const idempotencyKey = requireIdempotencyKey(args.idempotencyKey);
    if (!Number.isSafeInteger(args.amountMinorUnits) || args.amountMinorUnits <= 0) {
      throw new ConvexError({ code: "INVALID_INPUT", field: "amountMinorUnits" });
    }
    const entryKey = `grant:${args.ownerId}:${idempotencyKey}`;
    const existingEntry = await ctx.db
      .query("inquiryCreditLedger")
      .withIndex("by_entry_key", (q) => q.eq("entryKey", entryKey))
      .unique();
    const ownerCurrencyKey = `${args.ownerId}:${currency}`;
    const existingAccount = await ctx.db
      .query("inquiryCreditAccounts")
      .withIndex("by_owner_currency", (q) => q.eq("ownerCurrencyKey", ownerCurrencyKey))
      .unique();
    if (existingEntry) {
      if (
        existingEntry.ownerId !== args.ownerId ||
        existingEntry.currency !== currency ||
        existingEntry.amountMinorUnits !== args.amountMinorUnits
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      if (!existingAccount) throw new ConvexError({ code: "INTERNAL_ERROR" });
      return {
        balanceMinorUnits: existingAccount.balanceMinorUnits,
        reservedMinorUnits: existingAccount.reservedMinorUnits,
        currency,
      };
    }
    const now = new Date().toISOString();
    if (existingAccount) {
      await ctx.db.patch("inquiryCreditAccounts", existingAccount._id, {
        balanceMinorUnits: existingAccount.balanceMinorUnits + args.amountMinorUnits,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("inquiryCreditAccounts", {
        ownerId: args.ownerId,
        currency,
        ownerCurrencyKey,
        balanceMinorUnits: args.amountMinorUnits,
        reservedMinorUnits: 0,
        updatedAt: now,
      });
    }
    await ctx.db.insert("inquiryCreditLedger", {
      ownerId: args.ownerId,
      currency,
      entryKey,
      kind: "grant",
      amountMinorUnits: args.amountMinorUnits,
      occurredAt: now,
    });
    const account = await ctx.db
      .query("inquiryCreditAccounts")
      .withIndex("by_owner_currency", (q) => q.eq("ownerCurrencyKey", ownerCurrencyKey))
      .unique();
    if (!account) throw new ConvexError({ code: "INTERNAL_ERROR" });
    return {
      balanceMinorUnits: account.balanceMinorUnits,
      reservedMinorUnits: account.reservedMinorUnits,
      currency,
    };
  },
});

export const getCreditBalance = query({
  args: { currency: v.string() },
  returns: v.object({ currency: v.string(), balanceMinorUnits: v.number(), reservedMinorUnits: v.number(), availableMinorUnits: v.number() }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const currency = requireCurrency(args.currency);
    const account = await ctx.db
      .query("inquiryCreditAccounts")
      .withIndex("by_owner_currency", (q) => q.eq("ownerCurrencyKey", `${ownerId}:${currency}`))
      .unique();
    const balanceMinorUnits = account?.balanceMinorUnits ?? 0;
    const reservedMinorUnits = account?.reservedMinorUnits ?? 0;
    return { currency, balanceMinorUnits, reservedMinorUnits, availableMinorUnits: balanceMinorUnits - reservedMinorUnits };
  },
});

export const savePlaybookDraft = mutation({
  args: {
    id: v.string(),
    expectedRevision: v.optional(v.number()),
    name: v.string(),
    steps: v.array(v.object({ id: v.string(), instruction: v.string() })),
  },
  returns: v.object({
    id: v.string(),
    revision: v.number(),
    status: v.union(v.literal("draft"), v.literal("approved")),
  }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const candidate = parseInquiryPlaybook({
      id: args.id,
      revision: args.expectedRevision ?? 1,
      name: args.name,
      source: "user_created",
      steps: args.steps,
    });
    const key = playbookKey(ownerId, "user_created", candidate.id);
    const existing = await ctx.db
      .query("inquiryPlaybooks")
      .withIndex("by_playbook_key", (q) => q.eq("playbookKey", key))
      .unique();
    const now = new Date().toISOString();
    if (!existing) {
      if (args.expectedRevision !== undefined) throw new ConvexError({ code: "NOT_FOUND" });
      await ctx.db.insert("inquiryPlaybooks", {
        ownerId,
        playbookKey: key,
        id: candidate.id,
        source: "user_created",
        status: "draft",
        revision: 1,
        name: candidate.name,
        steps: candidate.steps,
        createdAt: now,
        updatedAt: now,
      });
      return { id: candidate.id, revision: 1, status: "draft" as const };
    }
    if (existing.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    if (args.expectedRevision !== existing.revision) throw new ConvexError({ code: "STALE_REVISION" });
    if (existing.name === candidate.name && JSON.stringify(existing.steps) === JSON.stringify(candidate.steps)) {
      return { id: existing.id, revision: existing.revision, status: existing.status };
    }
    const revision = existing.revision + 1;
    await ctx.db.patch("inquiryPlaybooks", existing._id, {
      status: "draft",
      revision,
      approvedRevision: undefined,
      name: candidate.name,
      steps: candidate.steps,
      updatedAt: now,
    });
    return { id: existing.id, revision, status: "draft" as const };
  },
});

export const approvePlaybook = mutation({
  args: { id: v.string(), expectedRevision: v.number() },
  returns: v.object({ id: v.string(), revision: v.number(), status: v.literal("approved") }),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const key = playbookKey(ownerId, "user_created", args.id);
    const playbook = await ctx.db
      .query("inquiryPlaybooks")
      .withIndex("by_playbook_key", (q) => q.eq("playbookKey", key))
      .unique();
    if (!playbook) throw new ConvexError({ code: "NOT_FOUND" });
    if (playbook.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    if (playbook.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    if (playbook.status !== "approved" || playbook.approvedRevision !== playbook.revision) {
      await ctx.db.patch("inquiryPlaybooks", playbook._id, {
        status: "approved",
        approvedRevision: playbook.revision,
        updatedAt: new Date().toISOString(),
      });
    }
    return { id: playbook.id, revision: playbook.revision, status: "approved" as const };
  },
});

export const upsertSystemPlaybook = internalMutation({
  args: {
    id: v.string(),
    revision: v.number(),
    name: v.string(),
    steps: v.array(v.object({ id: v.string(), instruction: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const candidate = parseInquiryPlaybook({
      id: args.id,
      revision: args.revision,
      name: args.name,
      source: "system",
      steps: args.steps,
    });
    const key = playbookKey("system", "system", candidate.id);
    const existing = await ctx.db
      .query("inquiryPlaybooks")
      .withIndex("by_playbook_key", (q) => q.eq("playbookKey", key))
      .unique();
    const now = new Date().toISOString();
    if (existing) {
      if (candidate.revision < existing.revision) throw new ConvexError({ code: "STALE_REVISION" });
      const sameContent = existing.name === candidate.name && JSON.stringify(existing.steps) === JSON.stringify(candidate.steps);
      if (candidate.revision === existing.revision && !sameContent) {
        throw new ConvexError({ code: "PLAYBOOK_REVISION_CONFLICT" });
      }
      if (candidate.revision > existing.revision || existing.status !== "approved") {
        await ctx.db.patch("inquiryPlaybooks", existing._id, {
          status: "approved",
          revision: candidate.revision,
          approvedRevision: candidate.revision,
          name: candidate.name,
          steps: candidate.steps,
          updatedAt: now,
        });
      }
    } else {
      await ctx.db.insert("inquiryPlaybooks", {
        playbookKey: key,
        id: candidate.id,
        source: "system",
        status: "approved",
        revision: candidate.revision,
        approvedRevision: candidate.revision,
        name: candidate.name,
        steps: candidate.steps,
        createdAt: now,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const listPlaybooks = query({
  args: {},
  returns: v.array(v.object({
    id: v.string(),
    source: v.union(v.literal("system"), v.literal("user_created")),
    status: v.union(v.literal("draft"), v.literal("approved")),
    revision: v.number(),
    approvedRevision: v.union(v.number(), v.null()),
    name: v.string(),
    steps: v.array(v.object({ id: v.string(), instruction: v.string() })),
  })),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const [mine, system] = await Promise.all([
      ctx.db.query("inquiryPlaybooks").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).collect(),
      ctx.db.query("inquiryPlaybooks").withIndex("by_owner", (q) => q.eq("ownerId", undefined)).collect(),
    ]);
    return [...system, ...mine].map((playbook) => ({
      id: playbook.id,
      source: playbook.source,
      status: playbook.status,
      revision: playbook.revision,
      approvedRevision: playbook.approvedRevision ?? null,
      name: playbook.name,
      steps: playbook.steps,
    }));
  },
});

export const recordWorkerEvent = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    eventId: v.string(),
    workerSequence: v.number(),
    type: v.union(
      v.literal("connected"),
      v.literal("disclosure_delivered"),
      v.literal("question_started"),
      v.literal("answer_observed"),
      v.literal("clarification_required"),
      v.literal("recipient_declined"),
      v.literal("call_ended"),
    ),
    questionId: v.optional(v.string()),
    evidenceExcerpt: v.optional(v.string()),
    occurredAt: v.string(),
    executionRevision: v.string(),
  },
  returns: v.object({ sequence: v.number(), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    if (!Number.isSafeInteger(args.workerSequence) || args.workerSequence < 1) {
      throw new ConvexError({ code: "INVALID_INPUT", field: "workerSequence" });
    }
    const eventId = requireIdempotencyKey(args.eventId);
    const attemptSequenceKey = `${args.attemptId}:${args.workerSequence}`;
    const [existingById, existingBySequence] = await Promise.all([
      ctx.db.query("inquiryEvents").withIndex("by_event_id", (q) => q.eq("eventId", eventId)).unique(),
      ctx.db.query("inquiryEvents").withIndex("by_attempt_sequence_key", (q) => q.eq("attemptSequenceKey", attemptSequenceKey)).unique(),
    ]);
    const existing = existingById ?? existingBySequence;
    if (existing) {
      if (
        existing.eventId !== eventId ||
        existing.attemptId !== args.attemptId ||
        existing.workerSequence !== args.workerSequence ||
        existing.type !== args.type ||
        existing.questionId !== args.questionId ||
        existing.evidenceExcerpt !== args.evidenceExcerpt?.trim() ||
        existing.occurredAt !== args.occurredAt ||
        existing.executionRevision !== args.executionRevision
      ) {
        throw new ConvexError({ code: "EVENT_CONFLICT" });
      }
      return { sequence: existing.sequence, duplicate: true };
    }

    const [task, attempt] = await Promise.all([
      ctx.db.get("inquiryTasks", args.taskId),
      ctx.db.get("inquiryAttempts", args.attemptId),
    ]);
    if (!task || !attempt || attempt.taskId !== task._id) throw new ConvexError({ code: "NOT_FOUND" });
    if (
      task.confirmedExecutionRevision !== args.executionRevision ||
      attempt.confirmedExecutionRevision !== args.executionRevision
    ) {
      throw new ConvexError({ code: "EXECUTION_REVISION_MISMATCH" });
    }
    if (attempt.nextWorkerSequence !== args.workerSequence) {
      throw new ConvexError({
        code: "WORKER_SEQUENCE_GAP",
        expectedWorkerSequence: attempt.nextWorkerSequence,
      });
    }
    const questionIds = new Set(task.contract.questions.map(({ id }: { id: string }) => id));
    const questionEvent = args.type === "question_started" || args.type === "answer_observed" || args.type === "clarification_required";
    if (questionEvent && (!args.questionId || !questionIds.has(args.questionId))) {
      throw new ConvexError({ code: "INVALID_EVENT", reason: "question_id" });
    }
    if (args.type === "answer_observed" && !args.evidenceExcerpt?.trim()) {
      throw new ConvexError({ code: "INVALID_EVENT", reason: "evidence_excerpt" });
    }
    if (args.evidenceExcerpt && args.evidenceExcerpt.length > 1_000) {
      throw new ConvexError({ code: "INVALID_EVENT", reason: "evidence_excerpt_too_long" });
    }

    requireIsoInstant(args.occurredAt, "occurredAt");
    const now = new Date().toISOString();
    if (args.type === "connected") {
      if (task.status !== "in_progress" || attempt.status !== "dialing") {
        throw new ConvexError({ code: "INVALID_TRANSITION" });
      }
      await ctx.db.patch("inquiryAttempts", attempt._id, {
        status: "connected",
        connectedAt: args.occurredAt,
        updatedAt: now,
      });
    } else if (args.type === "call_ended") {
      if (task.status !== "in_progress" || !["dialing", "connected", "ending"].includes(attempt.status)) {
        throw new ConvexError({ code: "INVALID_TRANSITION" });
      }
      await ctx.db.patch("inquiryTasks", task._id, { resultState: "processing", updatedAt: now });
      await ctx.db.patch("inquiryAttempts", attempt._id, {
        status: "ended",
        terminalAt: args.occurredAt,
        updatedAt: now,
      });
    } else {
      const postCallEvidence =
        task.status === "in_progress" &&
        task.resultState === "processing" &&
        attempt.status === "ended" &&
        (args.type === "answer_observed" || args.type === "clarification_required" || args.type === "recipient_declined");
      if ((task.status !== "in_progress" || attempt.status !== "connected") && !postCallEvidence) {
        throw new ConvexError({ code: "INVALID_TRANSITION" });
      }
    }

    if (args.type === "recipient_declined") {
      const destinationE164 = task.contract.destination.e164PhoneNumber;
      const existingOptOut = await ctx.db
        .query("inquiryRecipientOptOuts")
        .withIndex("by_destination", (q) => q.eq("destinationE164", destinationE164))
        .unique();
      if (!existingOptOut) {
        await ctx.db.insert("inquiryRecipientOptOuts", {
          destinationE164,
          taskId: task._id,
          attemptId: attempt._id,
          source: "recipient_declined",
          reason: "Recipient declined future CallBridge contact during the call.",
          optedOutAt: args.occurredAt,
        });
      }
    }

    const sequence = task.nextEventSequence;
    await ctx.db.insert("inquiryEvents", {
      taskId: task._id,
      attemptId: attempt._id,
      eventId,
      sequence,
      type: args.type,
      source: "telephony_worker",
      workerSequence: args.workerSequence,
      attemptSequenceKey,
      ...(args.questionId ? { questionId: args.questionId } : {}),
      ...(args.evidenceExcerpt ? { evidenceExcerpt: args.evidenceExcerpt.trim() } : {}),
      revision: task.revision,
      executionRevision: args.executionRevision,
      occurredAt: args.occurredAt,
    });
    await ctx.db.patch("inquiryTasks", task._id, { nextEventSequence: sequence + 1 });
    await ctx.db.patch("inquiryAttempts", attempt._id, { nextWorkerSequence: args.workerSequence + 1 });
    return { sequence, duplicate: false };
  },
});

export const publishResult = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    resultKey: v.string(),
    actualCostMinorUnits: v.number(),
    costStatus: v.union(v.literal("provider_reported"), v.literal("pending")),
    result: inquiryCallResultValidator,
  },
  returns: v.id("inquiryResults"),
  handler: async (ctx, args) => {
    const resultKey = requireIdempotencyKey(args.resultKey);
    const existing = await ctx.db
      .query("inquiryResults")
      .withIndex("by_result_key", (q) => q.eq("resultKey", resultKey))
      .unique();
    if (existing) {
      if (existing.taskId !== args.taskId || existing.attemptId !== args.attemptId) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      if (
        existing.actualCostMinorUnits !== args.actualCostMinorUnits ||
        existing.costStatus !== args.costStatus ||
        JSON.stringify(existing.result) !== JSON.stringify(args.result)
      ) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return existing._id;
    }
    const [task, attempt] = await Promise.all([
      ctx.db.get("inquiryTasks", args.taskId),
      ctx.db.get("inquiryAttempts", args.attemptId),
    ]);
    if (!task || !attempt || attempt.taskId !== task._id) throw new ConvexError({ code: "NOT_FOUND" });
    if (args.result.executionRevision !== attempt.confirmedExecutionRevision) {
      throw new ConvexError({ code: "EXECUTION_REVISION_MISMATCH" });
    }
    if (!Number.isSafeInteger(args.actualCostMinorUnits) || args.actualCostMinorUnits < 0) {
      throw new ConvexError({ code: "INVALID_INPUT", field: "actualCostMinorUnits" });
    }
    if (args.costStatus === "pending" && args.actualCostMinorUnits !== 0) {
      throw new ConvexError({ code: "INVALID_INPUT", field: "actualCostMinorUnits" });
    }
    const reservation = await ctx.db.get("inquiryCreditReservations", attempt.creditReservationId);
    if (!reservation || reservation.state !== "reserved") {
      throw new ConvexError({ code: "INVALID_CREDIT_RESERVATION" });
    }
    if (args.actualCostMinorUnits > reservation.reservedMinorUnits) {
      throw new ConvexError({ code: "COST_CEILING_EXCEEDED" });
    }
    if (!["ended", "failed", "cancelled", "timed_out"].includes(attempt.status)) {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    if ((args.result.outcome === "answered" || args.result.outcome === "partial") && attempt.status !== "ended") {
      throw new ConvexError({ code: "INVALID_RESULT", reason: "nonterminal_conversation" });
    }
    validateDecisionReadyResult(task.contract, args.result);
    await validateResultEvidence(ctx, task._id, attempt._id, args.result.answers);
    const existingTaskResult = await ctx.db
      .query("inquiryResults")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .unique();
    if (existingTaskResult) throw new ConvexError({ code: "RESULT_ALREADY_EXISTS" });
    const now = new Date().toISOString();
    const resultId = await ctx.db.insert("inquiryResults", {
      taskId: task._id,
      attemptId: attempt._id,
      resultKey,
      result: args.result,
      actualCostMinorUnits: args.actualCostMinorUnits,
      costStatus: args.costStatus,
      createdAt: now,
    });
    if (args.costStatus === "provider_reported") {
      const account = await ctx.db
        .query("inquiryCreditAccounts")
        .withIndex("by_owner_currency", (q) => q.eq("ownerCurrencyKey", reservation.ownerCurrencyKey))
        .unique();
      if (!account || account.reservedMinorUnits < reservation.reservedMinorUnits) {
        throw new ConvexError({ code: "INVALID_CREDIT_RESERVATION" });
      }
      await ctx.db.patch("inquiryCreditReservations", reservation._id, {
        state: "settled",
        actualMinorUnits: args.actualCostMinorUnits,
        settledAt: now,
      });
      await ctx.db.patch("inquiryCreditAccounts", account._id, {
        balanceMinorUnits: account.balanceMinorUnits - args.actualCostMinorUnits,
        reservedMinorUnits: account.reservedMinorUnits - reservation.reservedMinorUnits,
        updatedAt: now,
      });
      await ctx.db.insert("inquiryCreditLedger", {
        ownerId: task.ownerId,
        currency: reservation.currency,
        entryKey: `settle:${reservation._id}`,
        kind: "settle",
        amountMinorUnits: args.actualCostMinorUnits,
        taskId: task._id,
        reservationId: reservation._id,
        occurredAt: now,
      });
      const releasedMinorUnits = reservation.reservedMinorUnits - args.actualCostMinorUnits;
      if (releasedMinorUnits > 0) {
        await ctx.db.insert("inquiryCreditLedger", {
          ownerId: task.ownerId,
          currency: reservation.currency,
          entryKey: `release:${reservation._id}`,
          kind: "release",
          amountMinorUnits: releasedMinorUnits,
          taskId: task._id,
          reservationId: reservation._id,
          occurredAt: now,
        });
      }
    }
    const taskStatus = args.result.outcome === "answered"
      ? "completed"
      : args.result.outcome === "partial"
        ? "partial"
        : args.result.outcome === "stopped"
          ? "stopped"
          : "failed";
    const attemptStatus = args.result.outcome === "failed" || args.result.outcome === "no_answer"
      ? "failed"
      : args.result.outcome === "stopped"
        ? "cancelled"
        : "ended";
    await ctx.db.patch("inquiryAttempts", attempt._id, {
      status: attemptStatus,
      terminalAt: args.result.terminalAt,
      terminalReason: args.result.terminalReason,
      updatedAt: now,
    });
    await ctx.db.patch("inquiryTasks", task._id, {
      status: taskStatus,
      resultState: "ready",
      updatedAt: now,
    });
    await appendEvent(ctx, { taskId: task._id, attemptId: attempt._id, type: "result_ready", occurredAt: now });
    return resultId;
  },
});

export const settleResultCost = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    resultKey: v.string(),
    settlementKey: v.string(),
    actualCostMinorUnits: v.number(),
  },
  returns: v.object({ duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const resultKey = requireIdempotencyKey(args.resultKey);
    const settlementKey = requireIdempotencyKey(args.settlementKey);
    if (!Number.isSafeInteger(args.actualCostMinorUnits) || args.actualCostMinorUnits < 0) {
      throw new ConvexError({ code: "INVALID_INPUT", field: "actualCostMinorUnits" });
    }
    const result = await ctx.db
      .query("inquiryResults")
      .withIndex("by_result_key", (q) => q.eq("resultKey", resultKey))
      .unique();
    if (!result || result.taskId !== args.taskId || result.attemptId !== args.attemptId) {
      throw new ConvexError({ code: "NOT_FOUND" });
    }
    if (result.costStatus === "provider_reported") {
      if (result.costSettlementKey === settlementKey && result.actualCostMinorUnits === args.actualCostMinorUnits) {
        return { duplicate: true };
      }
      throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
    }
    const [task, attempt] = await Promise.all([
      ctx.db.get("inquiryTasks", args.taskId),
      ctx.db.get("inquiryAttempts", args.attemptId),
    ]);
    if (!task || !attempt || attempt.taskId !== task._id) throw new ConvexError({ code: "NOT_FOUND" });
    const reservation = await ctx.db.get("inquiryCreditReservations", attempt.creditReservationId);
    if (!reservation || reservation.state !== "reserved" || args.actualCostMinorUnits > reservation.reservedMinorUnits) {
      throw new ConvexError({ code: "INVALID_CREDIT_RESERVATION" });
    }
    const account = await ctx.db
      .query("inquiryCreditAccounts")
      .withIndex("by_owner_currency", (q) => q.eq("ownerCurrencyKey", reservation.ownerCurrencyKey))
      .unique();
    if (!account || account.reservedMinorUnits < reservation.reservedMinorUnits) {
      throw new ConvexError({ code: "INVALID_CREDIT_RESERVATION" });
    }
    const now = new Date().toISOString();
    await ctx.db.patch("inquiryResults", result._id, {
      actualCostMinorUnits: args.actualCostMinorUnits,
      costStatus: "provider_reported",
      costSettlementKey: settlementKey,
    });
    await ctx.db.patch("inquiryCreditReservations", reservation._id, {
      state: "settled",
      actualMinorUnits: args.actualCostMinorUnits,
      settledAt: now,
    });
    await ctx.db.patch("inquiryCreditAccounts", account._id, {
      balanceMinorUnits: account.balanceMinorUnits - args.actualCostMinorUnits,
      reservedMinorUnits: account.reservedMinorUnits - reservation.reservedMinorUnits,
      updatedAt: now,
    });
    await ctx.db.insert("inquiryCreditLedger", {
      ownerId: task.ownerId,
      currency: reservation.currency,
      entryKey: `settle:${reservation._id}`,
      kind: "settle",
      amountMinorUnits: args.actualCostMinorUnits,
      taskId: task._id,
      reservationId: reservation._id,
      occurredAt: now,
    });
    const releasedMinorUnits = reservation.reservedMinorUnits - args.actualCostMinorUnits;
    if (releasedMinorUnits > 0) {
      await ctx.db.insert("inquiryCreditLedger", {
        ownerId: task.ownerId,
        currency: reservation.currency,
        entryKey: `release:${reservation._id}`,
        kind: "release",
        amountMinorUnits: releasedMinorUnits,
        taskId: task._id,
        reservationId: reservation._id,
        occurredAt: now,
      });
    }
    return { duplicate: false };
  },
});

function validateDecisionReadyResult(
  contract: InquiryCallContract,
  result: {
    outcome: "answered" | "partial" | "no_answer" | "failed" | "stopped";
    summary: string | null;
    answers: Array<{
      questionId: string;
      status: "reported" | "not_answered" | "ambiguous";
      value: string | null;
      evidence: { sourceEventId: string; sourceExcerpt: string } | null;
    }>;
    unresolvedQuestionIds: string[];
    durationSeconds: number;
    terminalAt: string;
  },
): void {
  requireIsoInstant(result.terminalAt, "result.terminalAt");
  if (result.summary && result.summary.length > 4_000) {
    throw new ConvexError({ code: "INVALID_RESULT", reason: "summary_too_long" });
  }
  const expectedQuestionIds = contract.questions.map(({ id }) => id);
  const answerIds = result.answers.map(({ questionId }) => questionId);
  if (
    new Set(answerIds).size !== answerIds.length ||
    answerIds.length !== expectedQuestionIds.length ||
    expectedQuestionIds.some((id) => !answerIds.includes(id))
  ) {
    throw new ConvexError({ code: "INVALID_RESULT", reason: "question_coverage" });
  }
  const unresolved = result.answers
    .filter(({ status }) => status !== "reported")
    .map(({ questionId }) => questionId);
  if (
    new Set(result.unresolvedQuestionIds).size !== result.unresolvedQuestionIds.length ||
    unresolved.length !== result.unresolvedQuestionIds.length ||
    unresolved.some((id) => !result.unresolvedQuestionIds.includes(id))
  ) {
    throw new ConvexError({ code: "INVALID_RESULT", reason: "unresolved_questions" });
  }
  for (const answer of result.answers) {
    if (answer.value && answer.value.length > 2_000) {
      throw new ConvexError({ code: "INVALID_RESULT", reason: "answer_too_long" });
    }
    if (answer.evidence && answer.evidence.sourceExcerpt.length > 1_000) {
      throw new ConvexError({ code: "INVALID_RESULT", reason: "evidence_too_long" });
    }
    if (answer.status === "reported" && (!answer.value?.trim() || !answer.evidence)) {
      throw new ConvexError({ code: "INVALID_RESULT", reason: "reported_answer_evidence" });
    }
    if (answer.status === "ambiguous" && !answer.evidence) {
      throw new ConvexError({ code: "INVALID_RESULT", reason: "ambiguous_answer_evidence" });
    }
    if (answer.status === "not_answered" && (answer.value !== null || answer.evidence !== null)) {
      throw new ConvexError({ code: "INVALID_RESULT", reason: "not_answered_payload" });
    }
  }
  if ((result.outcome === "answered" || result.outcome === "partial") && !result.summary?.trim()) {
    throw new ConvexError({ code: "INVALID_RESULT", reason: "summary_required" });
  }
  if (result.outcome === "answered" && unresolved.length > 0) {
    throw new ConvexError({ code: "INVALID_RESULT", reason: "answered_with_gaps" });
  }
  if (result.outcome === "partial" && unresolved.length === 0) {
    throw new ConvexError({ code: "INVALID_RESULT", reason: "partial_without_gaps" });
  }
  if (
    !Number.isSafeInteger(result.durationSeconds) ||
    result.durationSeconds < 0 ||
    result.durationSeconds > contract.policy.maxConnectedSeconds
  ) {
    throw new ConvexError({ code: "INVALID_RESULT", reason: "duration" });
  }
}

async function validateResultEvidence(
  ctx: MutationCtx,
  taskId: Id<"inquiryTasks">,
  attemptId: Id<"inquiryAttempts">,
  answers: Array<{
    status: "reported" | "not_answered" | "ambiguous";
    questionId: string;
    evidence: { sourceEventId: string; sourceExcerpt: string } | null;
  }>,
): Promise<void> {
  for (const answer of answers) {
    if (!answer.evidence) continue;
    const event = await ctx.db
      .query("inquiryEvents")
      .withIndex("by_event_id", (q) => q.eq("eventId", answer.evidence!.sourceEventId))
      .unique();
    if (
      !event ||
      event.taskId !== taskId ||
      event.attemptId !== attemptId ||
      event.source !== "telephony_worker" ||
      event.type !== "answer_observed" ||
      event.questionId !== answer.questionId ||
      event.evidenceExcerpt !== answer.evidence.sourceExcerpt
    ) {
      throw new ConvexError({ code: "INVALID_RESULT", reason: "unverified_evidence" });
    }
  }
}

export const getResult = query({
  args: { taskId: v.id("inquiryTasks") },
  returns: v.union(
    v.object({ status: v.literal("not_ready") }),
    v.object({ status: v.literal("processing"), retryAfterMs: v.number() }),
    v.object({
      status: v.literal("failed"),
      failure: v.object({
        stage: v.literal("result_processing"),
        code: v.literal("RESULT_PROJECTION_FAILED"),
        retryable: v.literal(false),
      }),
    }),
    v.object({
      status: v.literal("ready"),
      result: inquiryCallResultValidator,
      receipt: inquiryProofReceiptValidator,
    }),
  ),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    const task = await requireOwnedTask(ctx, args.taskId, ownerId);
    const stored = await ctx.db
      .query("inquiryResults")
      .withIndex("by_task", (q) => q.eq("taskId", task._id))
      .unique();
    if (stored) {
      const answeredQuestionIds = stored.result.answers
        .filter(({ status }) => status === "reported")
        .map(({ questionId }) => questionId);
      const sourceEventIds = [...new Set(stored.result.answers.flatMap(({ evidence }) => (
        evidence ? [evidence.sourceEventId] : []
      )))].sort();
      return {
        status: "ready" as const,
        result: stored.result,
        receipt: {
          schemaVersion: 1 as const,
          taskId: String(stored.taskId),
          attemptId: String(stored.attemptId),
          executionRevision: stored.result.executionRevision,
          outcome: stored.result.outcome,
          callLanguage: task.contract.languages.call,
          resultLanguage: task.contract.languages.result,
          answeredQuestionIds,
          unresolvedQuestionIds: stored.result.unresolvedQuestionIds,
          sourceEventIds,
          durationSeconds: stored.result.durationSeconds,
          terminalReason: stored.result.terminalReason,
          disclosureStatus: stored.result.disclosureStatus,
          commitmentSafety: stored.result.commitmentSafety,
          terminalAt: stored.result.terminalAt,
          cost: {
            currency: task.contract.costCeiling.currency,
            status: stored.costStatus,
            actualMinorUnits: stored.costStatus === "pending" ? null : stored.actualCostMinorUnits,
          },
        },
      };
    }
    if (task.resultState === "processing") return { status: "processing" as const, retryAfterMs: 500 };
    if (task.resultState === "failed") {
      return {
        status: "failed" as const,
        failure: {
          stage: "result_processing" as const,
          code: "RESULT_PROJECTION_FAILED" as const,
          retryable: false as const,
        },
      };
    }
    return { status: "not_ready" as const };
  },
});

export const listEvents = query({
  args: { taskId: v.id("inquiryTasks"), afterSequence: v.optional(v.number()) },
  returns: v.array(v.object({
    eventId: v.string(),
    sequence: v.number(),
    type: v.string(),
    source: v.string(),
    revision: v.number(),
    executionRevision: v.string(),
    occurredAt: v.string(),
    questionId: v.optional(v.string()),
  })),
  handler: async (ctx, args) => {
    const ownerId = await requireOwnerId(ctx);
    await requireOwnedTask(ctx, args.taskId, ownerId);
    const events = await ctx.db
      .query("inquiryEvents")
      .withIndex("by_task_sequence", (q) => q
        .eq("taskId", args.taskId)
        .gt("sequence", args.afterSequence ?? 0))
      .collect();
    return events.map(({ eventId, sequence, type, source, revision, executionRevision, occurredAt, questionId }) => ({
        eventId,
        sequence,
        type,
        source,
        revision,
        executionRevision,
        occurredAt,
        ...(questionId ? { questionId } : {}),
      }));
  },
});
