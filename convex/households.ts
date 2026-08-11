import { mutationGeneric as mutation } from "convex/server";
import { ConvexError, v } from "convex/values";

import {
  friendlyPermissionLevelValidator,
  historyVisibilityValidator,
  notificationPreferenceValidator,
} from "./validators.js";

type VerifiedIdentity = {
  subject: string;
  email?: string;
};

async function requireIdentity(ctx: {
  auth: { getUserIdentity(): Promise<VerifiedIdentity | null> };
}): Promise<VerifiedIdentity> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity;
}

function normalizeEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
    throw new ConvexError({ code: "INVALID_EMAIL" });
  }
  return normalized;
}

export const create = mutation({
  args: { name: v.string() },
  returns: v.id("households"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const current = await ctx.db
      .query("households")
      .withIndex("by_owner", (q) => q.eq("ownerId", identity.subject))
      .unique();
    if (current) return current._id;
    const name = args.name.trim();
    if (!name) throw new ConvexError({ code: "NAME_REQUIRED" });
    const now = new Date().toISOString();
    return await ctx.db.insert("households", {
      ownerId: identity.subject,
      name,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const inviteByEmail = mutation({
  args: {
    householdId: v.id("households"),
    email: v.string(),
    permissionLevel: friendlyPermissionLevelValidator,
    historyVisibility: historyVisibilityValidator,
    transcriptAccess: v.boolean(),
    receivesApprovalRequests: v.boolean(),
  },
  returns: v.id("householdInvites"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const household = await ctx.db.get("households", args.householdId);
    if (!household) throw new ConvexError({ code: "NOT_FOUND" });
    if (household.ownerId !== identity.subject) {
      const manager = await ctx.db
        .query("householdMembers")
        .withIndex("by_household_user", (q) =>
          q.eq("householdUserKey", `${args.householdId}:${identity.subject}`),
        )
        .unique();
      if (manager?.permissionLevel !== "manage_everything") {
        throw new ConvexError({ code: "FORBIDDEN" });
      }
    }

    const email = normalizeEmail(args.email);
    const householdEmailKey = `${args.householdId}:${email}`;
    const existing = await ctx.db
      .query("householdInvites")
      .withIndex("by_household_email", (q) =>
        q.eq("householdEmailKey", householdEmailKey),
      )
      .unique();
    if (existing?.status === "accepted") {
      throw new ConvexError({ code: "ALREADY_ACCEPTED" });
    }
    const now = new Date().toISOString();
    const invitation = {
      householdId: args.householdId,
      email,
      householdEmailKey,
      invitedByUserId: identity.subject,
      permissionLevel: args.permissionLevel,
      historyVisibility: args.historyVisibility,
      transcriptAccess: args.transcriptAccess,
      receivesApprovalRequests: args.receivesApprovalRequests,
      status: "pending" as const,
      updatedAt: now,
    };
    if (existing) {
      await ctx.db.patch("householdInvites", existing._id, invitation);
      return existing._id;
    }
    return await ctx.db.insert("householdInvites", {
      ...invitation,
      createdAt: now,
    });
  },
});

export const acceptInvite = mutation({
  args: { inviteId: v.id("householdInvites") },
  returns: v.id("households"),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    if (!identity.email) throw new ConvexError({ code: "VERIFIED_EMAIL_REQUIRED" });
    const invite = await ctx.db.get("householdInvites", args.inviteId);
    if (!invite) throw new ConvexError({ code: "NOT_FOUND" });
    if (invite.email !== normalizeEmail(identity.email)) {
      throw new ConvexError({ code: "FORBIDDEN" });
    }
    if (
      invite.status === "accepted" &&
      invite.acceptedByUserId === identity.subject
    ) {
      return invite.householdId;
    }
    if (invite.status !== "pending") {
      throw new ConvexError({ code: "INVITE_NOT_PENDING" });
    }

    const now = new Date().toISOString();
    const member = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdUserKey", `${invite.householdId}:${identity.subject}`),
      )
      .unique();
    if (member) {
      await ctx.db.patch("householdMembers", member._id, {
        permissionLevel: invite.permissionLevel,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("householdMembers", {
        householdId: invite.householdId,
        userId: identity.subject,
        householdUserKey: `${invite.householdId}:${identity.subject}`,
        permissionLevel: invite.permissionLevel,
        notificationPreference: "push",
        joinedAt: now,
        updatedAt: now,
      });
    }
    await ctx.db.patch("householdInvites", invite._id, {
      status: "accepted",
      acceptedByUserId: identity.subject,
      updatedAt: now,
    });
    return invite.householdId;
  },
});

export const updateMyNotificationPreference = mutation({
  args: {
    householdId: v.id("households"),
    notificationPreference: notificationPreferenceValidator,
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const identity = await requireIdentity(ctx);
    const member = await ctx.db
      .query("householdMembers")
      .withIndex("by_household_user", (q) =>
        q.eq("householdUserKey", `${args.householdId}:${identity.subject}`),
      )
      .unique();
    if (!member) throw new ConvexError({ code: "NOT_FOUND" });
    await ctx.db.patch("householdMembers", member._id, {
      notificationPreference: args.notificationPreference,
      updatedAt: new Date().toISOString(),
    });
    return null;
  },
});
