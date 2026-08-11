import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  callTaskDraftValidator,
  callTaskStatusValidator,
  cancellationRequestValidator,
  communicationPreferencesValidator,
  confirmationValidator,
  friendlyPermissionLevelValidator,
  historyVisibilityValidator,
  notificationPreferenceValidator,
} from "./validators.js";

export default defineSchema({
  callTasks: defineTable({
    ownerId: v.string(),
    status: callTaskStatusValidator,
    revision: v.number(),
    draft: callTaskDraftValidator,
    confirmation: v.optional(confirmationValidator),
    cancellation: v.optional(cancellationRequestValidator),
    retryControl: v.optional(
      v.object({
        stoppedAt: v.string(),
        stoppedByUserId: v.string(),
      }),
    ),
    execution: v.optional(
      v.object({
        externalSessionId: v.string(),
        startedAt: v.string(),
      }),
    ),
    failureReason: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_status", ["ownerId", "status"]),

  households: defineTable({
    ownerId: v.string(),
    name: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_owner", ["ownerId"]),

  householdInvites: defineTable({
    householdId: v.id("households"),
    email: v.string(),
    householdEmailKey: v.string(),
    invitedByUserId: v.string(),
    permissionLevel: friendlyPermissionLevelValidator,
    historyVisibility: historyVisibilityValidator,
    transcriptAccess: v.boolean(),
    receivesApprovalRequests: v.boolean(),
    status: v.union(
      v.literal("pending"),
      v.literal("accepted"),
      v.literal("revoked"),
    ),
    acceptedByUserId: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_household_email", ["householdEmailKey"])
    .index("by_email_status", ["email", "status"]),

  householdMembers: defineTable({
    householdId: v.id("households"),
    userId: v.string(),
    householdUserKey: v.string(),
    permissionLevel: friendlyPermissionLevelValidator,
    notificationPreference: notificationPreferenceValidator,
    joinedAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_household_user", ["householdUserKey"])
    .index("by_user", ["userId"])
    .index("by_household", ["householdId"]),

  taskAccess: defineTable({
    taskId: v.id("callTasks"),
    householdId: v.id("households"),
    userId: v.string(),
    taskUserKey: v.string(),
    permissionLevel: friendlyPermissionLevelValidator,
    historyVisibility: historyVisibilityValidator,
    transcriptAccess: v.boolean(),
    receivesApprovalRequests: v.boolean(),
    notificationPreference: notificationPreferenceValidator,
    sharedAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_task_user", ["taskUserKey"])
    .index("by_user", ["userId"])
    .index("by_task", ["taskId"]),

  entitlements: defineTable({
    userId: v.string(),
    provider: v.literal("lemon_squeezy"),
    active: v.boolean(),
    plan: v.union(v.string(), v.null()),
    validUntil: v.union(v.string(), v.null()),
    externalCustomerId: v.string(),
    externalSubscriptionId: v.string(),
    providerStatus: v.string(),
    updatedAt: v.string(),
  }).index("by_user", ["userId"]),

  entitlementWebhookEvents: defineTable({
    eventId: v.string(),
    eventName: v.string(),
    appliedAt: v.string(),
  }).index("by_event_id", ["eventId"]),

  communicationPreferences: defineTable({
    userId: v.string(),
    preferences: communicationPreferencesValidator,
    updatedAt: v.string(),
  }).index("by_user", ["userId"]),
});
