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
  morningBriefDeliveryPayloadValidator,
  taskActivityEventValidator,
  relationshipMemoryValidator,
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
    proactiveControl: v.optional(
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

  taskActivityEvents: defineTable({
    taskId: v.id("callTasks"),
    sequence: v.number(),
    event: taskActivityEventValidator,
  }).index("by_task_sequence", ["taskId", "sequence"]),

  morningBriefDeliveries: defineTable({
    ownerId: v.string(),
    localDate: v.string(),
    deliveryKey: v.string(),
    timeZone: v.string(),
    scheduledLocalTime: v.string(),
    status: v.union(v.literal("prepared"), v.literal("completed_noop")),
    payload: morningBriefDeliveryPayloadValidator,
    preparedAt: v.string(),
    receipt: v.optional(
      v.object({
        adapter: v.literal("noop"),
        completedAt: v.string(),
        externalMessageId: v.null(),
      }),
    ),
  })
    .index("by_delivery_key", ["deliveryKey"])
    .index("by_owner_date", ["ownerId", "localDate"]),

  sensitiveDisclosureConsents: defineTable({
    taskId: v.id("callTasks"),
    taskDisclosureKey: v.string(),
    ownerId: v.string(),
    kind: v.union(v.literal("entry_instructions"), v.literal("intercom")),
    recipientLabel: v.string(),
    approvedRevision: v.number(),
    state: v.union(v.literal("approved"), v.literal("consumed"), v.literal("revoked")),
    approvedAt: v.string(),
    consumedAt: v.optional(v.string()),
  }).index("by_task_disclosure", ["taskDisclosureKey"]),

  relationshipMemories: defineTable({
    ownerId: v.string(),
    memory: relationshipMemoryValidator,
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_owner", ["ownerId"]),

  relationshipMemoryAccess: defineTable({
    memoryId: v.id("relationshipMemories"),
    userId: v.string(),
    memoryUserKey: v.string(),
    sharedAt: v.string(),
  })
    .index("by_memory_user", ["memoryUserKey"])
    .index("by_user", ["userId"]),
});
