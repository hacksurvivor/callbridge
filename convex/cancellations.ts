import { mutationGeneric as mutation } from "convex/server";
import { ConvexError, v } from "convex/values";

import { canPerformSharedTaskAction } from "../src/domain/sharing.js";
import { cancellationTermsValidator } from "./validators.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

export const prepare = mutation({
  args: {
    taskId: v.id("callTasks"),
    expectedRevision: v.number(),
    terms: cancellationTermsValidator,
  },
  returns: v.id("callTasks"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== userId) {
      const access = await ctx.db
        .query("taskAccess")
        .withIndex("by_task_user", (q) =>
          q.eq("taskUserKey", `${args.taskId}:${userId}`),
        )
        .unique();
      if (!access || !canPerformSharedTaskAction(access.permissionLevel, "confirm")) {
        throw new ConvexError({ code: "FORBIDDEN" });
      }
    }
    if (task.revision !== args.expectedRevision) {
      throw new ConvexError({ code: "STALE_REVISION" });
    }
    if (task.status === "draft" || task.status === "cancelled") {
      throw new ConvexError({ code: "INVALID_TRANSITION" });
    }
    if (args.terms.knowledge !== "unknown") {
      if (
        !args.terms.source.trim() ||
        Number.isNaN(new Date(args.terms.checkedAt).getTime())
      ) {
        throw new ConvexError({ code: "INVALID_CANCELLATION_TERMS" });
      }
      if (
        args.terms.knowledge === "known_fee" &&
        (!Number.isSafeInteger(args.terms.fee.minorUnits) ||
          args.terms.fee.minorUnits <= 0 ||
          !/^[A-Z]{3}$/.test(args.terms.fee.currency))
      ) {
        throw new ConvexError({ code: "INVALID_CANCELLATION_FEE" });
      }
    }

    const now = new Date().toISOString();
    await ctx.db.patch("callTasks", args.taskId, {
      revision: task.revision + 1,
      cancellation: {
        state:
          args.terms.knowledge === "unknown"
            ? "terms_required"
            : "confirmation_required",
        requestedAt: now,
        requestedByUserId: userId,
        terms: args.terms,
        ...(args.terms.knowledge === "unknown" ? {} : { termsDisclosedAt: now }),
      },
      updatedAt: now,
    });
    return args.taskId;
  },
});

export const confirm = mutation({
  args: {
    taskId: v.id("callTasks"),
    expectedRevision: v.number(),
  },
  returns: v.id("callTasks"),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) throw new ConvexError({ code: "NOT_FOUND" });
    if (task.ownerId !== userId) {
      const access = await ctx.db
        .query("taskAccess")
        .withIndex("by_task_user", (q) =>
          q.eq("taskUserKey", `${args.taskId}:${userId}`),
        )
        .unique();
      if (!access || !canPerformSharedTaskAction(access.permissionLevel, "confirm")) {
        throw new ConvexError({ code: "FORBIDDEN" });
      }
    }
    if (task.revision !== args.expectedRevision) {
      throw new ConvexError({ code: "STALE_REVISION" });
    }
    const request = task.cancellation;
    if (
      !request ||
      request.state !== "confirmation_required" ||
      request.terms.knowledge === "unknown" ||
      !request.termsDisclosedAt
    ) {
      throw new ConvexError({ code: "CANCELLATION_TERMS_NOT_DISCLOSED" });
    }

    const now = new Date().toISOString();
    const confirmedRevision = task.revision + 1;
    await ctx.db.patch("callTasks", args.taskId, {
      revision: confirmedRevision,
      cancellation: {
        ...request,
        state: "confirmed",
        confirmation: {
          confirmedAt: now,
          confirmedByUserId: userId,
          confirmedRevision,
          disclosedTerms: request.terms,
        },
      },
      updatedAt: now,
    });
    return args.taskId;
  },
});
