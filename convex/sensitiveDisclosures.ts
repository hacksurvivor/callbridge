import {
  internalMutationGeneric as internalMutation,
  mutationGeneric as mutation,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import {
  canConsumeDeliveryDisclosure,
  validateDeliveryDisclosure,
} from "../src/domain/sensitiveDisclosure.js";
import { deliveryDisclosureKindValidator } from "./validators.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

function instructionFor(task: {
  draft: { category: string; deliveryInstructions?: { entryInstructions?: string; intercom?: string } };
}, kind: "entry_instructions" | "intercom"): string {
  return validateDeliveryDisclosure({
    category: task.draft.category,
    kind,
    recipientLabel: "validated internally",
    value:
      kind === "entry_instructions"
        ? task.draft.deliveryInstructions?.entryInstructions
        : task.draft.deliveryInstructions?.intercom,
  });
}

/** Owner-only and revision-bound. Sharing a task never grants disclosure authority. */
export const approveForCourier = mutation({
  args: {
    taskId: v.id("callTasks"),
    expectedRevision: v.number(),
    kind: deliveryDisclosureKindValidator,
    recipientLabel: v.string(),
  },
  returns: v.id("sensitiveDisclosureConsents"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== userId) throw new ConvexError({ code: "FORBIDDEN" });
    if (task.revision !== args.expectedRevision) throw new ConvexError({ code: "STALE_REVISION" });
    try {
      validateDeliveryDisclosure({
        category: task.draft.category,
        kind: args.kind,
        recipientLabel: args.recipientLabel,
        value:
          args.kind === "entry_instructions"
            ? task.draft.deliveryInstructions?.entryInstructions
            : task.draft.deliveryInstructions?.intercom,
      });
    } catch (error) {
      if (error instanceof Error) throw new ConvexError({ code: "VALIDATION_FAILED", message: error.message });
      throw error;
    }
    const key = `${args.taskId}:${args.kind}`;
    const existing = await ctx.db
      .query("sensitiveDisclosureConsents")
      .withIndex("by_task_disclosure", (q) => q.eq("taskDisclosureKey", key))
      .unique();
    const now = new Date().toISOString();
    const consent = {
      taskId: args.taskId,
      taskDisclosureKey: key,
      ownerId: userId,
      kind: args.kind,
      recipientLabel: args.recipientLabel.trim(),
      approvedRevision: task.revision,
      state: "approved" as const,
      approvedAt: now,
    };
    if (existing) {
      await ctx.db.patch("sensitiveDisclosureConsents", existing._id, consent);
      return existing._id;
    }
    return await ctx.db.insert("sensitiveDisclosureConsents", consent);
  },
});

/** Future server-only delivery gateway calls this once immediately before disclosure. */
export const consumeForCourier = internalMutation({
  args: {
    taskId: v.id("callTasks"),
    kind: deliveryDisclosureKindValidator,
    recipientLabel: v.string(),
  },
  returns: v.union(v.object({ value: v.string() }), v.null()),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    const key = `${args.taskId}:${args.kind}`;
    const consent = await ctx.db
      .query("sensitiveDisclosureConsents")
      .withIndex("by_task_disclosure", (q) => q.eq("taskDisclosureKey", key))
      .unique();
    if (!consent || !canConsumeDeliveryDisclosure({
      state: consent.state,
      approvedRevision: consent.approvedRevision,
      currentRevision: task.revision,
      approvedRecipientLabel: consent.recipientLabel,
      recipientLabel: args.recipientLabel.trim(),
    })) return null;
    const value = instructionFor(task, args.kind);
    await ctx.db.patch("sensitiveDisclosureConsents", consent._id, {
      state: "consumed",
      consumedAt: new Date().toISOString(),
    });
    return { value };
  },
});
