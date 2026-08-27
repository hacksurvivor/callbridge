"use node";

import { internalActionGeneric as internalAction, makeFunctionReference } from "convex/server";
import { v } from "convex/values";

import { verifyTelephonyCallback } from "../src/integrations/telephonyBridge.js";

const completeRef = makeFunctionReference<
  "mutation",
  {
    jobId: string;
    taskId: string;
    expectedRevision: number;
    externalSessionId: string;
    outcome: "success_update" | "decision_required";
    summary: string;
    completedAt: string;
    transcript?: { sourceLanguage: string; targetLanguage: string; translatedText: string };
  },
  string
>("taskLifecycle:completeOptionGathering");

export const processCallback = internalAction({
  args: { rawBody: v.string(), signature: v.union(v.string(), v.null()) },
  returns: v.string(),
  handler: async (ctx, args) => {
    const callback = verifyTelephonyCallback({
      rawBody: new TextEncoder().encode(args.rawBody),
      signature: args.signature,
      secret: process.env.CALLBRIDGE_TELEPHONY_WEBHOOK_SECRET ?? "",
    });
    const { transcript, ...completion } = callback;
    return await ctx.runMutation(
      completeRef,
      transcript === undefined ? completion : { ...completion, transcript },
    );
  },
});
