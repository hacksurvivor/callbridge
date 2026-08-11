import { mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { ConvexError, v } from "convex/values";

import { canPerformSharedTaskAction, redactDraftForShare } from "../src/domain/sharing.js";
import {
  callTaskDocumentValidator,
  friendlyPermissionLevelValidator,
  historyVisibilityValidator,
  notificationPreferenceValidator,
} from "./validators.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

export const shareWithHouseholdMember = mutation({
  args: {
    taskId: v.id("callTasks"),
    memberUserId: v.string(),
    permissionLevel: friendlyPermissionLevelValidator,
    historyVisibility: historyVisibilityValidator,
    transcriptAccess: v.boolean(),
    receivesApprovalRequests: v.boolean(),
  },
  returns: v.id("taskAccess"),
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
        !canPerformSharedTaskAction(access.permissionLevel, "share")
      ) {
        throw new ConvexError({ code: "FORBIDDEN" });
      }
    }

    const household = await ctx.db
      .query("households")
      .withIndex("by_owner", (q) => q.eq("ownerId", task.ownerId))
      .unique();
    if (!household) throw new ConvexError({ code: "HOUSEHOLD_REQUIRED" });
    const member = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdUserKey", `${household._id}:${args.memberUserId}`),
      )
      .unique();
    if (!member) throw new ConvexError({ code: "MEMBER_REQUIRED" });

    const existing = await ctx.db
      .query("taskAccess")
      .withIndex("by_task_user", (q) =>
        q.eq("taskUserKey", `${args.taskId}:${args.memberUserId}`),
      )
      .unique();
    const now = new Date().toISOString();
    const settings = {
      taskId: args.taskId,
      householdId: household._id,
      userId: args.memberUserId,
      taskUserKey: `${args.taskId}:${args.memberUserId}`,
      permissionLevel: args.permissionLevel,
      historyVisibility: args.historyVisibility,
      transcriptAccess: args.transcriptAccess,
      receivesApprovalRequests: args.receivesApprovalRequests,
      notificationPreference: member.notificationPreference,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch("taskAccess", existing._id, settings);
      return existing._id;
    }
    return await ctx.db.insert("taskAccess", {
      ...settings,
      sharedAt: now,
    });
  },
});

export const listSharedWithMe = query({
  args: {},
  returns: v.array(callTaskDocumentValidator),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const grants = await ctx.db
      .query("taskAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const tasks = await Promise.all(
      grants.map(async (grant) => {
        const task = await ctx.db.get("callTasks", grant.taskId);
        if (!task) return null;
        return {
          ...task,
          draft: redactDraftForShare(task.draft, grant.transcriptAccess),
        };
      }),
    );
    return tasks.filter((task) => task !== null);
  },
});

export const updateMyTaskNotificationPreference = mutation({
  args: {
    taskId: v.id("callTasks"),
    notificationPreference: notificationPreferenceValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    const access = await ctx.db
      .query("taskAccess")
      .withIndex("by_task_user", (q) =>
        q.eq("taskUserKey", `${args.taskId}:${userId}`),
      )
      .unique();
    if (!access) throw new ConvexError({ code: "NOT_FOUND" });
    await ctx.db.patch("taskAccess", access._id, {
      notificationPreference: args.notificationPreference,
      updatedAt: new Date().toISOString(),
    });
    return null;
  },
});
