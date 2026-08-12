import { mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { ConvexError, v } from "convex/values";

import { validateTravelerGroup } from "../src/domain/travelerGroups.js";
import { travelerGroupValidator } from "./validators.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

const groupDocumentValidator = v.object({
  _id: v.id("travelerGroups"),
  _creationTime: v.number(),
  ownerId: v.string(),
  group: travelerGroupValidator,
  createdAt: v.string(),
  updatedAt: v.string(),
});

function checked(group: Parameters<typeof validateTravelerGroup>[0]) {
  try {
    return validateTravelerGroup(group);
  } catch (error) {
    throw new ConvexError({
      code: "VALIDATION_FAILED",
      message: error instanceof Error ? error.message : "Traveler group is invalid",
    });
  }
}

export const listMine = query({
  args: {},
  returns: v.array(groupDocumentValidator),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    return await ctx.db.query("travelerGroups").withIndex("by_owner", (q) => q.eq("ownerId", ownerId)).collect();
  },
});

export const create = mutation({
  args: { group: travelerGroupValidator },
  returns: v.id("travelerGroups"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const now = new Date().toISOString();
    return await ctx.db.insert("travelerGroups", { ownerId, group: checked(args.group), createdAt: now, updatedAt: now });
  },
});

export const update = mutation({
  args: { groupId: v.id("travelerGroups"), group: travelerGroupValidator },
  returns: v.id("travelerGroups"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const record = await ctx.db.get("travelerGroups", args.groupId);
    if (!record) throw new ConvexError({ code: "NOT_FOUND" });
    if (record.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    await ctx.db.patch("travelerGroups", record._id, { group: checked(args.group), updatedAt: new Date().toISOString() });
    return record._id;
  },
});

export const remove = mutation({
  args: { groupId: v.id("travelerGroups") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const record = await ctx.db.get("travelerGroups", args.groupId);
    if (!record) throw new ConvexError({ code: "NOT_FOUND" });
    if (record.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    await ctx.db.delete("travelerGroups", record._id);
    return null;
  },
});
