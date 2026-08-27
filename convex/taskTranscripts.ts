import { queryGeneric as query } from "convex/server";
import { ConvexError, v } from "convex/values";

import { canPerformSharedTaskAction } from "../src/domain/sharing.js";

export const getForTask = query({
  args: { taskId: v.id("callTasks") },
  returns: v.union(v.null(), v.object({
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    translatedText: v.string(),
    createdAt: v.string(),
  })),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    const task = await ctx.db.get("callTasks", args.taskId);
    if (!task) return null;
    if (task.ownerId !== identity.subject) {
      const access = await ctx.db.query("taskAccess")
        .withIndex("by_task_user", (q) => q.eq("taskUserKey", `${args.taskId}:${identity.subject}`)).unique();
      if (!access || !access.transcriptAccess || !canPerformSharedTaskAction(access.permissionLevel, "view")) {
        throw new ConvexError({ code: "FORBIDDEN" });
      }
    }
    const transcript = await ctx.db.query("taskTranscripts")
      .withIndex("by_task", (q) => q.eq("taskId", args.taskId)).order("desc").first();
    if (!transcript) return null;
    return {
      sourceLanguage: transcript.sourceLanguage,
      targetLanguage: transcript.targetLanguage,
      translatedText: transcript.translatedText,
      createdAt: transcript.createdAt,
    };
  },
});
