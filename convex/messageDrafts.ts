import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";

import { action, internalMutation, query } from "./_generated/server.js";
import { assertConnectorActionAllowed } from "../src/application/connectorPolicy.js";
import { assertCapabilityEnabled } from "../src/application/launchReadiness.js";
import { prepareMessagingDraftWithOpenAI } from "../src/integrations/openAiMessagingDraft.js";

const storeDraftRef = makeFunctionReference<
  "mutation",
  { ownerId: string; recipientLabel: string; text: string; now: string },
  string
>("messageDrafts:store");

async function owner(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

export const prepare = action({
  args: { recipientLabel: v.string(), context: v.string() },
  handler: async (ctx, args): Promise<{ draftId: string; text: string }> => {
    const ownerId = await owner(ctx);
    assertConnectorActionAllowed("messaging", "prepare_draft");
    assertCapabilityEnabled("messaging_drafts", process.env);
    const text = await prepareMessagingDraftWithOpenAI({
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.CALLBRIDGE_DRAFT_MODEL ?? "",
      recipientLabel: args.recipientLabel,
      context: args.context,
    });
    const draftId = await ctx.runMutation(storeDraftRef, {
      ownerId,
      recipientLabel: args.recipientLabel.trim(),
      text,
      now: new Date().toISOString(),
    });
    return { draftId, text };
  },
});

export const list = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await owner(ctx);
    const drafts = await ctx.db
      .query("messageDrafts")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .take(50);
    return drafts.map(({ _id, recipientLabel, text, createdAt }) => ({
      draftId: _id,
      recipientLabel,
      text,
      createdAt,
    }));
  },
});

export const store = internalMutation({
  args: { ownerId: v.string(), recipientLabel: v.string(), text: v.string(), now: v.string() },
  handler: async (ctx, args): Promise<string> => String(await ctx.db.insert("messageDrafts", {
    ownerId: args.ownerId,
    recipientLabel: args.recipientLabel,
    text: args.text,
    createdAt: args.now,
    deleteAt: new Date(new Date(args.now).getTime() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })),
});

export const purgeExpired = internalMutation({
  args: { now: v.string(), limit: v.number() },
  handler: async (ctx, args): Promise<number> => {
    const limit = Math.max(1, Math.min(100, Math.floor(args.limit)));
    const expired = await ctx.db
      .query("messageDrafts")
      .withIndex("by_delete_at", (q) => q.lte("deleteAt", args.now))
      .take(limit);
    for (const draft of expired) await ctx.db.delete(draft._id);
    return expired.length;
  },
});
