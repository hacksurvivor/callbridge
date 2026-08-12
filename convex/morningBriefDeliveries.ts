import { internalMutationGeneric as internalMutation } from "convex/server";
import { ConvexError, v } from "convex/values";

import { DomainError } from "../src/domain/errors.js";
import {
  prepareMorningBriefDelivery,
} from "../src/domain/morningBriefDelivery.js";
import type { BriefActivity, BriefCommitment } from "../src/domain/morningBrief.js";
import { morningBriefDeliveryPayloadValidator } from "./validators.js";

const skipReasonValidator = v.union(
  v.literal("missing_preferences"),
  v.literal("disabled"),
  v.literal("invalid_preferences"),
  v.literal("not_delivery_time"),
  v.literal("quiet_hours"),
  v.literal("empty_brief"),
);

const preparationResultValidator = v.union(
  v.object({ kind: v.literal("skipped"), reason: skipReasonValidator }),
  v.object({ kind: v.literal("duplicate"), deliveryId: v.id("morningBriefDeliveries") }),
  v.object({
    kind: v.literal("prepared"),
    deliveryId: v.id("morningBriefDeliveries"),
    deliveryKey: v.string(),
    ownerId: v.string(),
    payload: morningBriefDeliveryPayloadValidator,
  }),
);

function validInstant(value: string, label: string): Date {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw new ConvexError({ code: "VALIDATION_FAILED", message: `${label} is invalid` });
  }
  return instant;
}

/**
 * Scheduler-only preparation. The transaction claims the tenant/local-date
 * key before any adapter can run, so retries cannot prepare a second brief.
 */
export const prepareForUser = internalMutation({
  args: {
    ownerId: v.string(),
    now: v.string(),
    since: v.string(),
    commitments: v.array(
      v.object({
        taskId: v.id("callTasks"),
        important: v.boolean(),
        occursAt: v.string(),
        summary: v.string(),
      }),
    ),
  },
  returns: preparationResultValidator,
  handler: async (ctx, args) => {
    const now = validInstant(args.now, "Morning brief time");
    const since = validInstant(args.since, "Morning brief activity boundary");
    const preferenceRecord = await ctx.db
      .query("communicationPreferences")
      .withIndex("by_user", (q) => q.eq("userId", args.ownerId))
      .unique();

    const tasks = await ctx.db
      .query("callTasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    const taskById = new Map(tasks.map((task) => [String(task._id), task]));
    const activity: BriefActivity[] = [];
    for (const task of tasks) {
      const events = await ctx.db
        .query("taskActivityEvents")
        .withIndex("by_task_sequence", (q) => q.eq("taskId", task._id))
        .collect();
      for (const { event } of events) {
        activity.push({
          ...event,
          taskId: task._id,
          taskTitle: task.draft.title,
        });
      }
    }

    const commitments: BriefCommitment[] = [];
    for (const commitment of args.commitments) {
      const task = taskById.get(String(commitment.taskId));
      if (!task) {
        const existingTask = await ctx.db.get("callTasks", commitment.taskId);
        if (existingTask && existingTask.ownerId !== args.ownerId) {
          throw new ConvexError({ code: "FORBIDDEN" });
        }
        throw new ConvexError({ code: "NOT_FOUND" });
      }
      commitments.push({
        ...commitment,
        taskId: commitment.taskId,
        taskTitle: task.draft.title,
      });
    }

    let decision;
    try {
      decision = prepareMorningBriefDelivery({
        ownerId: args.ownerId,
        now,
        since,
        preferences: preferenceRecord?.preferences ?? null,
        activity,
        commitments,
      });
    } catch (error) {
      if (error instanceof DomainError) {
        throw new ConvexError({
          code: error.code,
          message: error.message,
          details: [...error.details],
        });
      }
      throw error;
    }
    if (decision.kind === "skipped") return decision;

    const existing = await ctx.db
      .query("morningBriefDeliveries")
      .withIndex("by_delivery_key", (q) => q.eq("deliveryKey", decision.deliveryKey))
      .unique();
    if (existing) return { kind: "duplicate" as const, deliveryId: existing._id };

    const deliveryId = await ctx.db.insert("morningBriefDeliveries", {
      ownerId: args.ownerId,
      localDate: decision.localDate,
      deliveryKey: decision.deliveryKey,
      timeZone: decision.timeZone,
      scheduledLocalTime: decision.scheduledLocalTime,
      status: "prepared",
      payload: decision.payload,
      preparedAt: now.toISOString(),
    });
    return {
      kind: "prepared" as const,
      deliveryId,
      deliveryKey: decision.deliveryKey,
      ownerId: args.ownerId,
      payload: decision.payload,
    };
  },
});

/** Records only the repository's no-op adapter receipt; no provider is called. */
export const recordNoopReceipt = internalMutation({
  args: {
    deliveryId: v.id("morningBriefDeliveries"),
    deliveryKey: v.string(),
    ownerId: v.string(),
    completedAt: v.string(),
  },
  returns: v.union(v.literal("recorded"), v.literal("duplicate")),
  handler: async (ctx, args) => {
    const completedAt = validInstant(args.completedAt, "Morning brief receipt time");
    const delivery = await ctx.db.get("morningBriefDeliveries", args.deliveryId);
    if (!delivery) throw new ConvexError({ code: "NOT_FOUND" });
    if (delivery.ownerId !== args.ownerId || delivery.deliveryKey !== args.deliveryKey) {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    if (delivery.status === "completed_noop") return "duplicate" as const;
    await ctx.db.patch("morningBriefDeliveries", args.deliveryId, {
      status: "completed_noop",
      receipt: {
        adapter: "noop",
        completedAt: completedAt.toISOString(),
        externalMessageId: null,
      },
    });
    return "recorded" as const;
  },
});
