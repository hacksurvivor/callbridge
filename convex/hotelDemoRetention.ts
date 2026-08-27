import {
  internalActionGeneric as internalAction,
  internalMutationGeneric as internalMutation,
  internalQueryGeneric as internalQuery,
  makeFunctionReference,
} from "convex/server";
import { v } from "convex/values";

const purgeRef = makeFunctionReference<
  "mutation",
  { now: string; limit: number; injectFailure: boolean },
  { deleted: number; overdueCount: number; healthy: boolean }
>("hotelDemoRetention:purgeExpired");
const recordFailureRef = makeFunctionReference<
  "mutation",
  { now: string },
  { deleted: 0; overdueCount: number; healthy: false }
>("hotelDemoRetention:recordFailure");

async function upsertState(ctx: { db: any }, input: {
  now: string;
  healthy: boolean;
  overdueCount: number;
  success: boolean;
}) {
  const existing = await ctx.db.query("hotelDemoRetentionState").withIndex("by_key", (q: any) => q.eq("key", "hotel-demo")).unique();
  const value = {
    key: "hotel-demo" as const,
    healthy: input.healthy,
    overdueCount: input.overdueCount,
    lastCheckedAt: input.now,
    ...(input.success ? { lastSuccessfulRunAt: input.now } : { lastFailureAt: input.now }),
  };
  if (existing) await ctx.db.patch("hotelDemoRetentionState", existing._id, value);
  else await ctx.db.insert("hotelDemoRetentionState", value);
}

export const purgeExpired = internalMutation({
  args: { now: v.string(), limit: v.number(), injectFailure: v.boolean() },
  returns: v.object({ deleted: v.number(), overdueCount: v.number(), healthy: v.boolean() }),
  handler: async (ctx, args) => {
    const now = new Date(args.now);
    if (Number.isNaN(now.getTime())) throw new Error("Hotel demo retention time is invalid");
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    const due = await ctx.db.query("hotelDemoTasks").withIndex("by_delete_at", (q) => q.lte("deleteAt", now.toISOString())).take(limit);
    if (args.injectFailure && due.length) throw new Error("Injected hotel demo retention failure");
    for (const task of due) {
      const attempts = await ctx.db.query("hotelDemoAttempts").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect();
      const intents = await ctx.db.query("hotelDemoConfirmationIntents").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect();
      const activity = await ctx.db.query("hotelDemoActivityEvents").withIndex("by_task_sequence", (q) => q.eq("taskId", task._id)).collect();
      const results = await ctx.db.query("hotelDemoResults").withIndex("by_task", (q) => q.eq("taskId", task._id)).collect();
      for (const attempt of attempts) {
        const events = await ctx.db.query("hotelDemoAttemptEvents").withIndex("by_attempt", (q) => q.eq("attemptId", attempt._id)).collect();
        for (const stored of events) await ctx.db.delete("hotelDemoAttemptEvents", stored._id);
      }
      for (const stored of results) await ctx.db.delete("hotelDemoResults", stored._id);
      for (const stored of activity) await ctx.db.delete("hotelDemoActivityEvents", stored._id);
      for (const stored of attempts) await ctx.db.delete("hotelDemoAttempts", stored._id);
      for (const stored of intents) await ctx.db.delete("hotelDemoConfirmationIntents", stored._id);
      await ctx.db.delete("hotelDemoTasks", task._id);
    }
    const overdue = await ctx.db.query("hotelDemoTasks").withIndex("by_delete_at", (q) => q.lte("deleteAt", now.toISOString())).take(101);
    const healthy = overdue.length === 0;
    await upsertState(ctx, { now: now.toISOString(), healthy, overdueCount: overdue.length, success: healthy });
    return { deleted: due.length, overdueCount: overdue.length, healthy };
  },
});

export const recordFailure = internalMutation({
  args: { now: v.string() },
  returns: v.object({ deleted: v.literal(0), overdueCount: v.number(), healthy: v.literal(false) }),
  handler: async (ctx, args) => {
    const overdue = await ctx.db.query("hotelDemoTasks").withIndex("by_delete_at", (q) => q.lte("deleteAt", args.now)).take(101);
    await upsertState(ctx, { now: args.now, healthy: false, overdueCount: overdue.length, success: false });
    return { deleted: 0 as const, overdueCount: overdue.length, healthy: false as const };
  },
});

export const run = internalAction({
  args: { injectFailure: v.optional(v.boolean()) },
  returns: v.object({ deleted: v.number(), overdueCount: v.number(), healthy: v.boolean() }),
  handler: async (ctx, args) => {
    const now = new Date().toISOString();
    try {
      return await ctx.runMutation(purgeRef, { now, limit: 100, injectFailure: args.injectFailure ?? false });
    } catch {
      return await ctx.runMutation(recordFailureRef, { now });
    }
  },
});

export const getReadiness = internalQuery({
  args: {},
  returns: v.object({ healthy: v.boolean(), overdueCount: v.number(), lastCheckedAt: v.union(v.string(), v.null()) }),
  handler: async (ctx) => {
    const state = await ctx.db.query("hotelDemoRetentionState").withIndex("by_key", (q) => q.eq("key", "hotel-demo")).unique();
    if (!state) return { healthy: true, overdueCount: 0, lastCheckedAt: null };
    return { healthy: state.healthy, overdueCount: state.overdueCount, lastCheckedAt: state.lastCheckedAt };
  },
});
