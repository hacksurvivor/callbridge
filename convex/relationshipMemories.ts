import { mutationGeneric as mutation, queryGeneric as query } from "convex/server";
import { ConvexError, v } from "convex/values";

import { DomainError } from "../src/domain/errors.js";
import { validateRelationshipMemory } from "../src/domain/relationshipMemory.js";
import { relationshipMemoryValidator } from "./validators.js";

async function requireUserId(ctx: {
  auth: { getUserIdentity(): Promise<{ subject: string } | null> };
}): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

function toConvexError(error: unknown): never {
  if (error instanceof DomainError) {
    throw new ConvexError({ code: error.code, message: error.message, details: [...error.details] });
  }
  throw error;
}

export const listMine = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("relationshipMemories"),
      memory: relationshipMemoryValidator,
      createdAt: v.string(),
      updatedAt: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const ownerId = await requireUserId(ctx);
    return await ctx.db
      .query("relationshipMemories")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .collect();
  },
});

export const listSharedWithMe = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("relationshipMemories"),
      memory: relationshipMemoryValidator,
      createdAt: v.string(),
      updatedAt: v.string(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const access = await ctx.db
      .query("relationshipMemoryAccess")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const records = await Promise.all(access.map((entry) => ctx.db.get("relationshipMemories", entry.memoryId)));
    return records
      .filter((record): record is NonNullable<typeof record> => record !== null)
      .map(({ _id, memory, createdAt, updatedAt }) => ({ _id, memory, createdAt, updatedAt }));
  },
});

export const create = mutation({
  args: { memory: relationshipMemoryValidator },
  returns: v.id("relationshipMemories"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    let memory;
    try {
      memory = validateRelationshipMemory(args.memory);
    } catch (error) {
      toConvexError(error);
    }
    const now = new Date().toISOString();
    return await ctx.db.insert("relationshipMemories", {
      ownerId,
      memory,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const update = mutation({
  args: { memoryId: v.id("relationshipMemories"), memory: relationshipMemoryValidator },
  returns: v.id("relationshipMemories"),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const existing = await ctx.db.get("relationshipMemories", args.memoryId);
    if (!existing) throw new ConvexError({ code: "NOT_FOUND" });
    if (existing.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    let memory;
    try {
      memory = validateRelationshipMemory(args.memory);
    } catch (error) {
      toConvexError(error);
    }
    await ctx.db.patch("relationshipMemories", args.memoryId, {
      memory,
      updatedAt: new Date().toISOString(),
    });
    return args.memoryId;
  },
});

export const remove = mutation({
  args: { memoryId: v.id("relationshipMemories") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const existing = await ctx.db.get("relationshipMemories", args.memoryId);
    if (!existing) throw new ConvexError({ code: "NOT_FOUND" });
    if (existing.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    await ctx.db.delete("relationshipMemories", args.memoryId);
    return null;
  },
});

export const shareViewOnly = mutation({
  args: { memoryId: v.id("relationshipMemories"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const memory = await ctx.db.get("relationshipMemories", args.memoryId);
    if (!memory) throw new ConvexError({ code: "NOT_FOUND" });
    if (memory.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    const memoryUserKey = `${args.memoryId}:${args.userId}`;
    const existing = await ctx.db
      .query("relationshipMemoryAccess")
      .withIndex("by_memory_user", (q) => q.eq("memoryUserKey", memoryUserKey))
      .unique();
    if (!existing) {
      await ctx.db.insert("relationshipMemoryAccess", {
        memoryId: args.memoryId,
        userId: args.userId,
        memoryUserKey,
        sharedAt: new Date().toISOString(),
      });
    }
    return null;
  },
});

export const revokeViewOnly = mutation({
  args: { memoryId: v.id("relationshipMemories"), userId: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const ownerId = await requireUserId(ctx);
    const memory = await ctx.db.get("relationshipMemories", args.memoryId);
    if (!memory) throw new ConvexError({ code: "NOT_FOUND" });
    if (memory.ownerId !== ownerId) throw new ConvexError({ code: "FORBIDDEN" });
    const access = await ctx.db
      .query("relationshipMemoryAccess")
      .withIndex("by_memory_user", (q) => q.eq("memoryUserKey", `${args.memoryId}:${args.userId}`))
      .unique();
    if (access) await ctx.db.delete("relationshipMemoryAccess", access._id);
    return null;
  },
});
