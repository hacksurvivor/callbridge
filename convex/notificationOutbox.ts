import {
  internalMutationGeneric as internalMutation,
  internalQueryGeneric as internalQuery,
  queryGeneric as query,
} from "convex/server";
import { ConvexError, v } from "convex/values";

import { morningBriefDeliveryPayloadValidator } from "./validators.js";

const notificationKindValidator = v.union(
  v.literal("morning_brief"),
  v.literal("post_stay_review"),
  v.literal("task_result"),
  v.literal("proactive_finding"),
);
const notificationStateValidator = v.union(
  v.literal("pending"),
  v.literal("blocked"),
  v.literal("delivered"),
  v.literal("failed"),
);
const outboxItemValidator = v.object({
  _id: v.id("notificationOutbox"),
  ownerId: v.string(),
  taskId: v.optional(v.id("callTasks")),
  kind: notificationKindValidator,
  idempotencyKey: v.string(),
  title: v.string(),
  body: v.string(),
  data: v.record(v.string(), v.string()),
  state: notificationStateValidator,
  createdAt: v.string(),
  lastAttemptAt: v.optional(v.string()),
  deliveredAt: v.optional(v.string()),
  externalMessageId: v.optional(v.string()),
  failureReason: v.optional(v.string()),
});

async function requireOwnerId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

async function enqueueOnce(
  ctx: any,
  input: {
    ownerId: string;
    taskId?: any;
    kind: "morning_brief" | "post_stay_review" | "task_result" | "proactive_finding";
    idempotencyKey: string;
    title: string;
    body: string;
    data: Record<string, string>;
    now: string;
  },
): Promise<any> {
  const existing = await ctx.db
    .query("notificationOutbox")
    .withIndex("by_idempotency_key", (q: any) => q.eq("idempotencyKey", input.idempotencyKey))
    .unique();
  if (existing) return existing._id;
  return await ctx.db.insert("notificationOutbox", {
    ownerId: input.ownerId,
    ...(input.taskId ? { taskId: input.taskId } : {}),
    kind: input.kind,
    idempotencyKey: input.idempotencyKey,
    title: input.title,
    body: input.body,
    data: input.data,
    state: "pending",
    createdAt: input.now,
  });
}

export const enqueueMorningBrief = internalMutation({
  args: {
    ownerId: v.string(),
    deliveryId: v.id("morningBriefDeliveries"),
    deliveryKey: v.string(),
    payload: morningBriefDeliveryPayloadValidator,
    now: v.string(),
  },
  returns: v.id("notificationOutbox"),
  handler: async (ctx, args) => {
    const delivery = await ctx.db.get("morningBriefDeliveries", args.deliveryId);
    if (!delivery) throw new ConvexError({ code: "NOT_FOUND" });
    if (delivery.ownerId !== args.ownerId || delivery.deliveryKey !== args.deliveryKey) {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    const count = args.payload.items.length;
    return await enqueueOnce(ctx, {
      ownerId: args.ownerId,
      kind: "morning_brief",
      idempotencyKey: `morning-brief:${args.deliveryKey}`,
      title: "Morning brief",
      body: `${count} ${count === 1 ? "update" : "updates"} need your attention`,
      data: { type: "morning_brief", localDate: args.payload.localDate, deliveryId: String(args.deliveryId) },
      now: args.now,
    });
  },
});

export const enqueueTaskNotification = internalMutation({
  args: {
    ownerId: v.string(),
    taskId: v.id("callTasks"),
    kind: v.union(v.literal("post_stay_review"), v.literal("task_result")),
    idempotencyKey: v.string(),
    title: v.string(),
    body: v.string(),
    now: v.string(),
  },
  returns: v.id("notificationOutbox"),
  handler: async (ctx, args) => {
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== args.ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    return await enqueueOnce(ctx, {
      ownerId: args.ownerId,
      taskId: args.taskId,
      kind: args.kind,
      idempotencyKey: args.idempotencyKey,
      title: args.title,
      body: args.body,
      data: { type: args.kind, taskId: String(args.taskId) },
      now: args.now,
    });
  },
});

export const listPending = internalQuery({
  args: { limit: v.number() },
  returns: v.array(outboxItemValidator),
  handler: async (ctx, args) => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    return await ctx.db
      .query("notificationOutbox")
      .withIndex("by_state", (q) => q.eq("state", "pending"))
      .take(limit);
  },
});

export const markDeliveryResult = internalMutation({
  args: {
    notificationId: v.id("notificationOutbox"),
    state: v.union(v.literal("blocked"), v.literal("delivered"), v.literal("failed")),
    now: v.string(),
    externalMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const item = await ctx.db.get("notificationOutbox", args.notificationId);
    if (!item || item.state === "delivered") return null;
    await ctx.db.patch("notificationOutbox", args.notificationId, {
      state: args.state,
      lastAttemptAt: args.now,
      ...(args.state === "delivered" ? { deliveredAt: args.now } : {}),
      ...(args.externalMessageId ? { externalMessageId: args.externalMessageId } : {}),
      ...(args.failureReason ? { failureReason: args.failureReason } : {}),
    });
    return null;
  },
});

export const listMine = query({
  args: {},
  returns: v.array(outboxItemValidator),
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    return await ctx.db
      .query("notificationOutbox")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(100);
  },
});
