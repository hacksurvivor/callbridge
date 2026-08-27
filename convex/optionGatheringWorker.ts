"use node";

import { internalActionGeneric as internalAction, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { assertCapabilityEnabled } from "../src/application/launchReadiness.js";
import { dispatchOptionGathering } from "../src/integrations/telephonyBridge.js";
import type { OptionGatheringRequest } from "../src/integrations/ports.js";

type Reservation = OptionGatheringRequest & {
  jobId: string;
  idempotencyKey: string;
  reservedRevision: number;
  jobState: "reserved" | "retryable" | "dispatched" | "completed" | "failed";
};

const reserveRef = makeFunctionReference<"mutation", { taskId: string; ownerId: string }, Reservation>("optionGathering:reserveConfirmedTask");
const markDispatchedRef = makeFunctionReference<"mutation", { jobId: string; externalSessionId: string; now: string }, null>("optionGatheringJobs:markDispatched");
const markFailureRef = makeFunctionReference<"mutation", { jobId: string; now: string }, "retryable" | "failed">("optionGatheringJobs:markRetryableFailure");
const recordBlockedRef = makeFunctionReference<"mutation", { taskId: string; ownerId: string; now: string }, null>("optionGatheringJobs:recordBlockedStart");

export const dispatch = internalAction({
  args: { taskId: v.string(), ownerId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    let reservation: Reservation | null = null;
    try {
      assertCapabilityEnabled("realtime", process.env);
      assertCapabilityEnabled("telephony", process.env);
      reservation = await ctx.runMutation(reserveRef, args);
      if (reservation.jobState === "dispatched" || reservation.jobState === "completed") return null;
      const result = await dispatchOptionGathering({
        endpoint: process.env.CALLBRIDGE_TELEPHONY_DISPATCH_URL ?? "",
        apiKey: process.env.CALLBRIDGE_TELEPHONY_API_KEY ?? "",
        idempotencyKey: reservation.idempotencyKey,
        jobId: reservation.jobId,
        expectedRevision: reservation.reservedRevision,
        request: reservation,
      });
      await ctx.runMutation(markDispatchedRef, {
        jobId: reservation.jobId,
        externalSessionId: result.externalSessionId,
        now,
      });
    } catch {
      if (reservation) await ctx.runMutation(markFailureRef, { jobId: reservation.jobId, now });
      else await ctx.runMutation(recordBlockedRef, { taskId: args.taskId, ownerId: args.ownerId, now });
    }
    return null;
  },
});
