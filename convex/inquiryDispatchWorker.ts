"use node";

import { internalActionGeneric as internalAction, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import type { InquiryDispatchRequest } from "../shared/inquiryDispatchContracts.js";
import { dispatchInquiryCall } from "../src/integrations/inquiryTelephonyBridge.js";

type DispatchClaim = InquiryDispatchRequest & {
  leaseToken: string;
  leaseExpiresAt: string;
};

type DispatchClaimResult = { allowed: false } | ({ allowed: true } & DispatchClaim);

const claimDispatchRef = makeFunctionReference<
  "mutation",
  {
    taskId: string;
    attemptId: string;
    expectedExecutionRevision: string;
    claimIdempotencyKey: string;
  },
  DispatchClaimResult
>("inquiryDispatch:claimDispatch");

const acceptedRef = makeFunctionReference<
  "mutation",
  { taskId: string; attemptId: string; leaseToken: string; externalCallId: string; occurredAt: string },
  unknown
>("inquiryDispatch:recordDispatchAccepted");

const definitelyNotCreatedRef = makeFunctionReference<
  "mutation",
  { taskId: string; attemptId: string; leaseToken: string; failureCode: string; occurredAt: string },
  unknown
>("inquiryDispatch:recordDispatchDefinitelyNotCreated");

const creationUncertainRef = makeFunctionReference<
  "mutation",
  { taskId: string; attemptId: string; leaseToken: string; failureCode: string; occurredAt: string },
  unknown
>("inquiryDispatch:recordDispatchCreationUncertain");

/**
 * Dormant one-attempt provider boundary. Confirmation does not schedule this
 * action yet; the destination/pricing/abuse gate must authorize it first.
 */
export const dispatch = internalAction({
  args: {
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    expectedExecutionRevision: v.string(),
    claimIdempotencyKey: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const claim = await ctx.runMutation(claimDispatchRef, {
      taskId: String(args.taskId),
      attemptId: String(args.attemptId),
      expectedExecutionRevision: args.expectedExecutionRevision,
      claimIdempotencyKey: args.claimIdempotencyKey,
    });
    if (!claim.allowed) return null;
    let outcome;
    try {
      outcome = await dispatchInquiryCall({
        endpoint: process.env.CALLBRIDGE_TELEPHONY_DISPATCH_URL ?? "",
        apiKey: process.env.CALLBRIDGE_TELEPHONY_API_KEY ?? "",
        request: claim,
      });
    } catch {
      outcome = {
        creationState: "creation_uncertain" as const,
        failureCode: "UNEXPECTED_DISPATCH_ADAPTER_FAILURE",
      };
    }
    const occurredAt = new Date().toISOString();

    const identity = {
      taskId: claim.taskId,
      attemptId: claim.attemptId,
      leaseToken: claim.leaseToken,
      occurredAt,
    };
    if (outcome.creationState === "accepted") {
      await ctx.runMutation(acceptedRef, { ...identity, externalCallId: outcome.externalCallId });
    } else if (outcome.creationState === "definitely_not_created") {
      await ctx.runMutation(definitelyNotCreatedRef, { ...identity, failureCode: outcome.failureCode });
    } else {
      await ctx.runMutation(creationUncertainRef, { ...identity, failureCode: outcome.failureCode });
    }
    return null;
  },
});
