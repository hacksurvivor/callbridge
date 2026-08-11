import { mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { ConvexError, v } from "convex/values";

import { DomainError } from "../src/domain/errors.js";
import { canPerformSharedTaskAction, redactDraftForShare } from "../src/domain/sharing.js";
import { validateDraft, validateForConfirmation } from "../src/domain/validation.js";
import { callTaskDocumentValidator, callTaskDraftValidator } from "./validators.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

function mapDomainError(error: unknown): never {
  if (error instanceof DomainError) {
    throw new ConvexError({
      code: error.code,
      message: error.message,
      details: [...error.details],
    });
  }
  throw error;
}

export const create = mutation({
  args: { draft: callTaskDraftValidator },
  returns: v.id("callTasks"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    let draft;
    try {
      draft = validateDraft(args.draft);
    } catch (error) {
      mapDomainError(error);
    }
    const now = new Date().toISOString();
    return await ctx.db.insert("callTasks", {
      ownerId,
      status: "draft",
      revision: 1,
      draft,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const get = query({
  args: { taskId: v.id("callTasks") },
  returns: v.union(callTaskDocumentValidator, v.null()),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) return null;
    if (task.ownerId === userId) return task;
    const access = await ctx.db
      .query("taskAccess")
      .withIndex("by_task_user", (q) =>
        q.eq("taskUserKey", `${args.taskId}:${userId}`),
      )
      .unique();
    if (!access) throw new ConvexError({ code: "FORBIDDEN" });
    return {
      ...task,
      draft: redactDraftForShare(task.draft, access.transcriptAccess),
    };
  },
});

export const listMine = query({
  args: {},
  returns: v.array(callTaskDocumentValidator),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    return await ctx.db
      .query("callTasks")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
  },
});

export const updateDraft = mutation({
  args: {
    taskId: v.id("callTasks"),
    expectedRevision: v.number(),
    draft: callTaskDraftValidator,
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
      if (
        !access ||
        !access.transcriptAccess ||
        !canPerformSharedTaskAction(access.permissionLevel, "edit")
      ) {
        throw new ConvexError({ code: "FORBIDDEN" });
      }
    }
    if (task.status !== "draft") throw new ConvexError({ code: "INVALID_TRANSITION" });
    if (task.revision !== args.expectedRevision) {
      throw new ConvexError({ code: "STALE_REVISION" });
    }

    let draft;
    try {
      draft = validateDraft(args.draft);
    } catch (error) {
      mapDomainError(error);
    }
    await ctx.db.patch("callTasks", args.taskId, {
      draft,
      revision: task.revision + 1,
      updatedAt: new Date().toISOString(),
    });
    return args.taskId;
  },
});

export const confirm = mutation({
  args: {
    taskId: v.id("callTasks"),
    expectedRevision: v.number(),
    noSaveModeAcknowledged: v.boolean(),
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
    if (task.status !== "draft") throw new ConvexError({ code: "INVALID_TRANSITION" });
    if (task.revision !== args.expectedRevision) {
      throw new ConvexError({ code: "STALE_REVISION" });
    }

    try {
      validateForConfirmation(task.draft);
    } catch (error) {
      mapDomainError(error);
    }
    if (task.draft.memory.mode === "no_save" && !args.noSaveModeAcknowledged) {
      throw new ConvexError({
        code: "NO_SAVE_ACKNOWLEDGEMENT_REQUIRED",
        message: "Confirm that this task will not be saved after completion",
      });
    }
    const now = new Date().toISOString();
    const confirmedRevision = task.revision + 1;
    await ctx.db.patch("callTasks", args.taskId, {
      status: "confirmed",
      revision: confirmedRevision,
      confirmation: {
        confirmedAt: now,
        confirmedByUserId: userId,
        confirmedRevision,
        permissionScope: "gather_options_only",
        noSaveModeAcknowledged:
          task.draft.memory.mode === "no_save" && args.noSaveModeAcknowledged,
      },
      updatedAt: now,
    });
    return args.taskId;
  },
});
