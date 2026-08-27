import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import { internalMutation, type MutationCtx } from "./_generated/server.js";
import type { Id } from "./_generated/dataModel.js";

const DISPATCH_LEASE_MS = 90_000;

const expireDispatchLeaseRef = makeFunctionReference<
  "mutation",
  { attemptId: Id<"inquiryAttempts">; leaseToken: string },
  null
>("inquiryDispatch:expireDispatchLease");

function requireKey(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 8 || normalized.length > 200) {
    throw new ConvexError({ code: "INVALID_INPUT", field });
  }
  return normalized;
}

function requireCode(value: string): string {
  const normalized = value.trim();
  if (!/^[A-Z0-9][A-Z0-9_.:-]{2,99}$/.test(normalized)) {
    throw new ConvexError({ code: "INVALID_INPUT", field: "failureCode" });
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

async function loadAttempt(
  ctx: MutationCtx,
  taskId: Id<"inquiryTasks">,
  attemptId: Id<"inquiryAttempts">,
) {
  const [task, attempt] = await Promise.all([
    ctx.db.get("inquiryTasks", taskId),
    ctx.db.get("inquiryAttempts", attemptId),
  ]);
  if (!task || !attempt || attempt.taskId !== task._id) {
    throw new ConvexError({ code: "NOT_FOUND" });
  }
  return { task, attempt };
}

async function appendDispatchEvent(
  ctx: MutationCtx,
  input: {
    taskId: Id<"inquiryTasks">;
    attemptId: Id<"inquiryAttempts">;
    type: "dispatch_uncertain" | "dispatch_failed" | "dispatch_reconciled" | "dialing";
    occurredAt: string;
  },
): Promise<void> {
  const task = await ctx.db.get("inquiryTasks", input.taskId);
  if (!task) throw new ConvexError({ code: "NOT_FOUND" });
  const sequence = task.nextEventSequence;
  await ctx.db.insert("inquiryEvents", {
    taskId: task._id,
    attemptId: input.attemptId,
    eventId: `server:${task._id}:${sequence}`,
    sequence,
    type: input.type,
    source: "callbridge_server",
    revision: task.revision,
    executionRevision: task.executionRevision,
    occurredAt: input.occurredAt,
  });
  await ctx.db.patch("inquiryTasks", task._id, { nextEventSequence: sequence + 1 });
}

async function releaseReservation(
  ctx: MutationCtx,
  taskId: Id<"inquiryTasks">,
  reservationId: Id<"inquiryCreditReservations">,
  occurredAt: string,
): Promise<void> {
  const reservation = await ctx.db.get("inquiryCreditReservations", reservationId);
  if (!reservation) throw new ConvexError({ code: "INVALID_CREDIT_RESERVATION" });
  if (reservation.taskId !== taskId) {
    throw new ConvexError({ code: "INVALID_CREDIT_RESERVATION" });
  }
  if (reservation.state === "released") return;
  if (reservation.state !== "reserved") {
    throw new ConvexError({ code: "INVALID_CREDIT_RESERVATION" });
  }
  const account = await ctx.db
    .query("inquiryCreditAccounts")
    .withIndex("by_owner_currency", (q) => q.eq("ownerCurrencyKey", reservation.ownerCurrencyKey))
    .unique();
  if (!account || account.reservedMinorUnits < reservation.reservedMinorUnits) {
    throw new ConvexError({ code: "INVALID_CREDIT_RESERVATION" });
  }
  await ctx.db.patch("inquiryCreditReservations", reservation._id, {
    state: "released",
    actualMinorUnits: 0,
    releasedAt: occurredAt,
  });
  await ctx.db.patch("inquiryCreditAccounts", account._id, {
    reservedMinorUnits: account.reservedMinorUnits - reservation.reservedMinorUnits,
    updatedAt: occurredAt,
  });
  await ctx.db.insert("inquiryCreditLedger", {
    ownerId: reservation.ownerId,
    currency: reservation.currency,
    entryKey: `release:${reservation._id}`,
    kind: "release",
    amountMinorUnits: reservation.reservedMinorUnits,
    taskId,
    reservationId: reservation._id,
    occurredAt,
  });
}

async function assertExternalCallIdAvailable(
  ctx: MutationCtx,
  attemptId: Id<"inquiryAttempts">,
  externalCallId: string,
): Promise<void> {
  const existing = await ctx.db
    .query("inquiryAttempts")
    .withIndex("by_external_call_id", (q) => q.eq("externalCallId", externalCallId))
    .unique();
  if (existing && existing._id !== attemptId) {
    throw new ConvexError({ code: "EXTERNAL_CALL_ID_CONFLICT" });
  }
}

async function markCreationUncertain(
  ctx: MutationCtx,
  input: {
    taskId: Id<"inquiryTasks">;
    attemptId: Id<"inquiryAttempts">;
    leaseToken: string;
    failureCode: string;
    occurredAt: string;
  },
): Promise<{ duplicate: boolean }> {
  const { task, attempt } = await loadAttempt(ctx, input.taskId, input.attemptId);
  if (attempt.dispatchLeaseToken !== input.leaseToken) {
    throw new ConvexError({ code: "DISPATCH_LEASE_MISMATCH" });
  }
  if (attempt.dispatchState === "creation_uncertain") {
    if (attempt.dispatchFailureCode !== input.failureCode) {
      throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
    }
    return { duplicate: true };
  }
  if (attempt.dispatchState !== "leased") {
    throw new ConvexError({ code: "INVALID_TRANSITION" });
  }
  await ctx.db.patch("inquiryAttempts", attempt._id, {
    dispatchState: "creation_uncertain",
    dispatchFailureCode: input.failureCode,
    dispatchFinalizedAt: input.occurredAt,
    status: "failed",
    terminalAt: input.occurredAt,
    terminalReason: "provider_creation_uncertain",
    updatedAt: input.occurredAt,
  });
  await ctx.db.patch("inquiryTasks", task._id, {
    status: "failed",
    resultState: "failed",
    updatedAt: input.occurredAt,
  });
  await appendDispatchEvent(ctx, {
    taskId: task._id,
    attemptId: attempt._id,
    type: "dispatch_uncertain",
    occurredAt: input.occurredAt,
  });
  return { duplicate: false };
}

export const claimDispatch = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    expectedExecutionRevision: v.string(),
    claimIdempotencyKey: v.string(),
  },
  returns: v.union(
    v.object({ allowed: v.literal(false) }),
    v.object({
      allowed: v.literal(true),
      taskId: v.string(),
      attemptId: v.string(),
      ownerId: v.string(),
      confirmedRevision: v.number(),
      confirmedExecutionRevision: v.string(),
      dispatchIdempotencyKey: v.string(),
      leaseToken: v.string(),
      leaseExpiresAt: v.string(),
      contract: v.any(),
    }),
  ),
  handler: async (ctx, args) => {
    const claimKey = requireKey(args.claimIdempotencyKey, "claimIdempotencyKey");
    const { task, attempt } = await loadAttempt(ctx, args.taskId, args.attemptId);
    if (
      task.confirmedExecutionRevision !== args.expectedExecutionRevision ||
      attempt.confirmedExecutionRevision !== args.expectedExecutionRevision
    ) {
      throw new ConvexError({ code: "EXECUTION_REVISION_MISMATCH" });
    }
    if (attempt.dispatchState === "leased" && attempt.dispatchClaimKey === claimKey) {
      if (!attempt.dispatchLeaseToken || !attempt.dispatchLeaseExpiresAt) {
        throw new ConvexError({ code: "INVALID_DISPATCH_STATE" });
      }
      return {
        allowed: true as const,
        taskId: String(task._id),
        attemptId: String(attempt._id),
        ownerId: task.ownerId,
        confirmedRevision: attempt.confirmedRevision,
        confirmedExecutionRevision: attempt.confirmedExecutionRevision,
        dispatchIdempotencyKey: attempt.dispatchIdempotencyKey,
        leaseToken: attempt.dispatchLeaseToken,
        leaseExpiresAt: attempt.dispatchLeaseExpiresAt,
        contract: task.contract,
      };
    }
    if (attempt.dispatchState !== "pending" || task.status !== "confirmed" || attempt.status !== "queued") {
      throw new ConvexError({ code: "DISPATCH_ALREADY_CLAIMED", dispatchState: attempt.dispatchState });
    }
    const optOut = await ctx.db
      .query("inquiryRecipientOptOuts")
      .withIndex("by_destination", (q) => q.eq("destinationE164", attempt.destinationE164))
      .unique();
    if (optOut) {
      const occurredAt = new Date().toISOString();
      await ctx.db.patch("inquiryAttempts", attempt._id, {
        dispatchState: "definitely_not_created",
        dispatchFailureCode: "RECIPIENT_OPTED_OUT",
        dispatchFinalizedAt: occurredAt,
        status: "failed",
        terminalAt: occurredAt,
        terminalReason: "recipient_opted_out",
        updatedAt: occurredAt,
      });
      await ctx.db.patch("inquiryTasks", task._id, {
        status: "failed",
        resultState: "failed",
        updatedAt: occurredAt,
      });
      await releaseReservation(ctx, task._id, attempt.creditReservationId, occurredAt);
      await appendDispatchEvent(ctx, {
        taskId: task._id,
        attemptId: attempt._id,
        type: "dispatch_failed",
        occurredAt,
      });
      return { allowed: false as const };
    }
    const acquiredAt = new Date().toISOString();
    const expiresAt = new Date(Date.parse(acquiredAt) + DISPATCH_LEASE_MS).toISOString();
    const leaseToken = crypto.randomUUID();
    await ctx.db.patch("inquiryAttempts", attempt._id, {
      dispatchState: "leased",
      dispatchClaimKey: claimKey,
      dispatchLeaseToken: leaseToken,
      dispatchLeaseAcquiredAt: acquiredAt,
      dispatchLeaseExpiresAt: expiresAt,
      updatedAt: acquiredAt,
    });
    await ctx.scheduler.runAt(Date.parse(expiresAt), expireDispatchLeaseRef, {
      attemptId: attempt._id,
      leaseToken,
    });
    return {
      allowed: true as const,
      taskId: String(task._id),
      attemptId: String(attempt._id),
      ownerId: task.ownerId,
      confirmedRevision: attempt.confirmedRevision,
      confirmedExecutionRevision: attempt.confirmedExecutionRevision,
      dispatchIdempotencyKey: attempt.dispatchIdempotencyKey,
      leaseToken,
      leaseExpiresAt: expiresAt,
      contract: task.contract,
    };
  },
});

export const recordDispatchAccepted = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    leaseToken: v.string(),
    externalCallId: v.string(),
    occurredAt: v.string(),
  },
  returns: v.object({ state: v.literal("accepted"), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const occurredAt = requireIsoInstant(args.occurredAt, "occurredAt");
    const externalCallId = requireKey(args.externalCallId, "externalCallId");
    const { task, attempt } = await loadAttempt(ctx, args.taskId, args.attemptId);
    if (attempt.dispatchLeaseToken !== args.leaseToken) {
      throw new ConvexError({ code: "DISPATCH_LEASE_MISMATCH" });
    }
    if (attempt.dispatchState === "accepted") {
      if (attempt.externalCallId !== externalCallId) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return { state: "accepted" as const, duplicate: true };
    }
    if (attempt.dispatchState !== "leased" || task.status !== "confirmed" || attempt.status !== "queued") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    // A late provider response is still authoritative. Lease expiry blocks a
    // second dispatcher; it does not make a real provider call disappear.
    await assertExternalCallIdAvailable(ctx, attempt._id, externalCallId);
    await ctx.db.patch("inquiryAttempts", attempt._id, {
      dispatchState: "accepted",
      externalCallId,
      dispatchFinalizedAt: occurredAt,
      status: "dialing",
      updatedAt: occurredAt,
    });
    await ctx.db.patch("inquiryTasks", task._id, {
      status: "in_progress",
      resultState: "not_ready",
      updatedAt: occurredAt,
    });
    await appendDispatchEvent(ctx, {
      taskId: task._id,
      attemptId: attempt._id,
      type: "dialing",
      occurredAt,
    });
    return { state: "accepted" as const, duplicate: false };
  },
});

export const recordDispatchDefinitelyNotCreated = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    leaseToken: v.string(),
    failureCode: v.string(),
    occurredAt: v.string(),
  },
  returns: v.object({ state: v.literal("definitely_not_created"), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const occurredAt = requireIsoInstant(args.occurredAt, "occurredAt");
    const failureCode = requireCode(args.failureCode);
    const { task, attempt } = await loadAttempt(ctx, args.taskId, args.attemptId);
    if (attempt.dispatchLeaseToken !== args.leaseToken) {
      throw new ConvexError({ code: "DISPATCH_LEASE_MISMATCH" });
    }
    if (attempt.dispatchState === "definitely_not_created") {
      if (attempt.dispatchFailureCode !== failureCode) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return { state: "definitely_not_created" as const, duplicate: true };
    }
    if (attempt.dispatchState !== "leased") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    await releaseReservation(ctx, task._id, attempt.creditReservationId, occurredAt);
    await ctx.db.patch("inquiryAttempts", attempt._id, {
      dispatchState: "definitely_not_created",
      dispatchFailureCode: failureCode,
      dispatchFinalizedAt: occurredAt,
      status: "failed",
      terminalAt: occurredAt,
      terminalReason: "provider_rejected_before_creation",
      updatedAt: occurredAt,
    });
    await ctx.db.patch("inquiryTasks", task._id, {
      status: "failed",
      resultState: "failed",
      updatedAt: occurredAt,
    });
    await appendDispatchEvent(ctx, {
      taskId: task._id,
      attemptId: attempt._id,
      type: "dispatch_failed",
      occurredAt,
    });
    return { state: "definitely_not_created" as const, duplicate: false };
  },
});

export const recordDispatchCreationUncertain = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    leaseToken: v.string(),
    failureCode: v.string(),
    occurredAt: v.string(),
  },
  returns: v.object({ state: v.literal("creation_uncertain"), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    const occurredAt = requireIsoInstant(args.occurredAt, "occurredAt");
    const failureCode = requireCode(args.failureCode);
    const result = await markCreationUncertain(ctx, {
      taskId: args.taskId,
      attemptId: args.attemptId,
      leaseToken: args.leaseToken,
      failureCode,
      occurredAt,
    });
    return { state: "creation_uncertain" as const, duplicate: result.duplicate };
  },
});

export const expireDispatchLease = internalMutation({
  args: { attemptId: v.id("inquiryAttempts"), leaseToken: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const attempt = await ctx.db.get("inquiryAttempts", args.attemptId);
    if (!attempt || attempt.dispatchState !== "leased" || attempt.dispatchLeaseToken !== args.leaseToken) {
      return null;
    }
    const expiresAt = attempt.dispatchLeaseExpiresAt ? Date.parse(attempt.dispatchLeaseExpiresAt) : Number.NaN;
    if (!Number.isFinite(expiresAt)) throw new ConvexError({ code: "INVALID_DISPATCH_STATE" });
    if (expiresAt > Date.now()) {
      await ctx.scheduler.runAt(expiresAt + 1, expireDispatchLeaseRef, args);
      return null;
    }
    await markCreationUncertain(ctx, {
      taskId: attempt.taskId,
      attemptId: attempt._id,
      leaseToken: args.leaseToken,
      failureCode: "LEASE_EXPIRED_WITHOUT_REPORTED_OUTCOME",
      occurredAt: new Date().toISOString(),
    });
    return null;
  },
});

export const reconcileDispatchOutcome = internalMutation({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    resolutionKey: v.string(),
    outcome: v.union(v.literal("found"), v.literal("definitely_absent")),
    externalCallId: v.optional(v.string()),
    occurredAt: v.string(),
  },
  returns: v.object({
    state: v.union(v.literal("accepted"), v.literal("definitely_not_created")),
    duplicate: v.boolean(),
  }),
  handler: async (ctx, args) => {
    const resolutionKey = requireKey(args.resolutionKey, "resolutionKey");
    const occurredAt = requireIsoInstant(args.occurredAt, "occurredAt");
    const { task, attempt } = await loadAttempt(ctx, args.taskId, args.attemptId);
    if (attempt.dispatchResolutionKey && attempt.dispatchResolutionKey !== resolutionKey) {
      throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
    }
    if (attempt.dispatchState === "accepted") {
      if (args.outcome !== "found" || !args.externalCallId || attempt.externalCallId !== args.externalCallId.trim()) {
        throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      }
      return { state: "accepted" as const, duplicate: true };
    }
    if (attempt.dispatchState === "definitely_not_created") {
      if (args.outcome !== "definitely_absent") throw new ConvexError({ code: "IDEMPOTENCY_CONFLICT" });
      return { state: "definitely_not_created" as const, duplicate: true };
    }
    if (attempt.dispatchState !== "creation_uncertain") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }

    if (args.outcome === "found") {
      if (!args.externalCallId) throw new ConvexError({ code: "INVALID_INPUT", field: "externalCallId" });
      const externalCallId = requireKey(args.externalCallId, "externalCallId");
      await assertExternalCallIdAvailable(ctx, attempt._id, externalCallId);
      await ctx.db.patch("inquiryAttempts", attempt._id, {
        dispatchState: "accepted",
        dispatchResolutionKey: resolutionKey,
        dispatchFailureCode: undefined,
        dispatchFinalizedAt: occurredAt,
        externalCallId,
        status: "dialing",
        terminalAt: undefined,
        terminalReason: undefined,
        updatedAt: occurredAt,
      });
      await ctx.db.patch("inquiryTasks", task._id, {
        status: "in_progress",
        resultState: "not_ready",
        updatedAt: occurredAt,
      });
      await appendDispatchEvent(ctx, {
        taskId: task._id,
        attemptId: attempt._id,
        type: "dispatch_reconciled",
        occurredAt,
      });
      await appendDispatchEvent(ctx, {
        taskId: task._id,
        attemptId: attempt._id,
        type: "dialing",
        occurredAt,
      });
      return { state: "accepted" as const, duplicate: false };
    }

    await releaseReservation(ctx, task._id, attempt.creditReservationId, occurredAt);
    await ctx.db.patch("inquiryAttempts", attempt._id, {
      dispatchState: "definitely_not_created",
      dispatchResolutionKey: resolutionKey,
      dispatchFailureCode: "RECONCILED_PROVIDER_ABSENT",
      dispatchFinalizedAt: occurredAt,
      status: "failed",
      terminalAt: occurredAt,
      terminalReason: "provider_rejected_before_creation",
      updatedAt: occurredAt,
    });
    await appendDispatchEvent(ctx, {
      taskId: task._id,
      attemptId: attempt._id,
      type: "dispatch_reconciled",
      occurredAt,
    });
    await appendDispatchEvent(ctx, {
      taskId: task._id,
      attemptId: attempt._id,
      type: "dispatch_failed",
      occurredAt,
    });
    return { state: "definitely_not_created" as const, duplicate: false };
  },
});
