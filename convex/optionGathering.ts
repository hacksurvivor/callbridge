import { internalMutationGeneric as internalMutation } from "convex/server";
import { ConvexError, v } from "convex/values";

import { assertOutboundCallPolicy } from "../src/domain/outboundCallPolicy.js";

import { canPerformSharedTaskAction } from "../src/domain/sharing.js";
import {
  isWithinLocalCallWindow,
  nextAllowedCallAt,
} from "../src/domain/taskPolicy.js";
import { DEFAULT_REALTIME_RUNTIME } from "../src/integrations/ports.js";
import {
  callTaskDraftValidator,
  confirmationValidator,
} from "./validators.js";

/**
 * Server-only handoff used immediately before a future telephony adapter.
 * It atomically reserves a confirmed revision and returns inquiry-only data.
 */
export const reserveConfirmedTask = internalMutation({
  args: { taskId: v.id("callTasks"), ownerId: v.string() },
  returns: v.object({
    jobId: v.id("optionGatheringJobs"),
    idempotencyKey: v.string(),
    reservedRevision: v.number(),
    jobState: v.union(v.literal("reserved"), v.literal("retryable"), v.literal("dispatched"), v.literal("completed"), v.literal("failed")),
    taskId: v.id("callTasks"),
    ownerId: v.string(),
    draft: callTaskDraftValidator,
    confirmation: confirmationValidator,
    runtime: v.object({
      provider: v.string(),
      model: v.string(),
    }),
    capability: v.literal("gather_options_only"),
    forbiddenActions: v.array(
      v.union(
        v.literal("book"),
        v.literal("pay"),
        v.literal("accept_terms"),
        v.literal("irreversible_commitment"),
        v.literal("cancel"),
      ),
    ),
  }),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== args.ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    const existingKey = task.confirmation
      ? `${args.taskId}:${task.confirmation.confirmedRevision}`
      : null;
    const existingJob = existingKey
      ? await ctx.db.query("optionGatheringJobs").withIndex("by_idempotency_key", (q) => q.eq("idempotencyKey", existingKey)).unique()
      : null;
    if (existingJob && task.status === "gathering_options" && task.confirmation) {
      return {
        jobId: existingJob._id,
        idempotencyKey: existingJob.idempotencyKey,
        reservedRevision: existingJob.reservedRevision,
        jobState: existingJob.state,
        taskId: args.taskId,
        ownerId: task.ownerId,
        draft: task.draft,
        confirmation: task.confirmation,
        runtime: existingJob.runtime,
        capability: "gather_options_only" as const,
        forbiddenActions: existingJob.forbiddenActions,
      };
    }
    if (task.status !== "confirmed" || !task.confirmation) {
      throw new ConvexError({ code: "CONFIRMATION_REQUIRED" });
    }
    if (
      task.confirmation.confirmedRevision !== task.revision ||
      task.confirmation.permissionScope !== "gather_options_only"
    ) {
      throw new ConvexError({ code: "CONFIRMATION_MISMATCH" });
    }
    if (task.confirmation.confirmedByUserId !== task.ownerId) {
      const confirmerUserId = task.confirmation.confirmedByUserId;
      const confirmerAccess = await ctx.db
        .query("taskAccess")
        .withIndex("by_task_user", (q) =>
          q.eq("taskUserKey", `${args.taskId}:${confirmerUserId}`),
        )
        .unique();
      if (
        !confirmerAccess ||
        !canPerformSharedTaskAction(confirmerAccess.permissionLevel, "confirm")
      ) {
        throw new ConvexError({ code: "CONFIRMER_NO_LONGER_AUTHORIZED" });
      }
    }
    if (
      task.draft.memory.mode === "no_save" &&
      !task.confirmation.noSaveModeAcknowledged
    ) {
      throw new ConvexError({ code: "NO_SAVE_ACKNOWLEDGEMENT_REQUIRED" });
    }

    try {
      assertOutboundCallPolicy({ countryCode: task.draft.target.countryCode, env: process.env });
    } catch (error) {
      throw new ConvexError({
        code: "CALL_POLICY_BLOCKED",
        message: error instanceof Error ? error.message : "Live calling policy is not approved",
      });
    }

    const entitlement = await ctx.db
      .query("entitlements")
      .withIndex("by_user", (q) => q.eq("userId", task.ownerId))
      .unique();
    if (!entitlement?.active) {
      throw new ConvexError({ code: "ENTITLEMENT_REQUIRED" });
    }

    const nowDate = new Date();
    if (!isWithinLocalCallWindow(nowDate, task.draft.callWindow)) {
      throw new ConvexError({
        code: "CALL_WINDOW_CLOSED",
        nextAllowedCallAt: nextAllowedCallAt(nowDate, task.draft.callWindow),
      });
    }
    const now = nowDate.toISOString();
    const reservedRevision = task.revision + 1;
    const idempotencyKey = `${args.taskId}:${task.confirmation.confirmedRevision}`;
    const forbiddenActions: Array<
      "book" | "pay" | "accept_terms" | "irreversible_commitment" | "cancel"
    > = ["book", "pay", "accept_terms", "irreversible_commitment", "cancel"];
    const jobId = await ctx.db.insert("optionGatheringJobs", {
      taskId: args.taskId,
      ownerId: task.ownerId,
      idempotencyKey,
      confirmationRevision: task.confirmation.confirmedRevision,
      reservedRevision,
      runtime: DEFAULT_REALTIME_RUNTIME,
      capability: "gather_options_only",
      forbiddenActions,
      state: "reserved",
      attemptCount: 0,
      createdAt: now,
      updatedAt: now,
    });
    await ctx.db.patch("callTasks", args.taskId, {
      status: "gathering_options",
      revision: reservedRevision,
      updatedAt: now,
    });
    return {
      jobId,
      idempotencyKey,
      reservedRevision,
      jobState: "reserved" as const,
      taskId: args.taskId,
      ownerId: task.ownerId,
      draft: task.draft,
      confirmation: task.confirmation,
      runtime: DEFAULT_REALTIME_RUNTIME,
      capability: "gather_options_only" as const,
      forbiddenActions,
    };
  },
});
