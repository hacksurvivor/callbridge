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
  remoteCommandEventKindValidator,
  remoteCommandKindValidator,
  remoteCommandStatusValidator,
  morningBriefDeliveryPayloadValidator,
  taskActivityEventValidator,
  relationshipMemoryValidator,
} from "./validators.js";
import {
  hotelDemoAttemptStatusValidator,
  hotelDemoAttemptEventValidator,
  hotelDemoCallResultValidator,
  hotelDemoConfirmationStateValidator,
  hotelDemoQuestionIdValidator,
  hotelDemoTaskActivityEventValidator,
  hotelDemoTaskStatusValidator,
} from "./hotelDemoValidators.js";
import {
  inquiryAttemptStatusValidator,
  inquiryCallResultValidator,
  inquiryDispatchStateValidator,
  inquiryEventTypeValidator,
  inquiryTaskStatusValidator,
} from "./inquiryValidators.js";

export default defineSchema({
  inquiryTasks: defineTable({
    ownerId: v.string(),
    ownerCreateKey: v.string(),
    createIdempotencyKey: v.string(),
    createExecutionRevision: v.string(),
    status: inquiryTaskStatusValidator,
    revision: v.number(),
    executionRevision: v.string(),
    // The shared Zod contract is the single structural source of truth. Every
    // public write parses it before storage; v.any avoids a second drifting schema.
    contract: v.any(),
    confirmationState: v.union(
      v.literal("not_ready"),
      v.literal("ready"),
      v.literal("confirmed"),
      v.literal("revoked"),
      v.literal("expired"),
    ),
    confirmationIntentId: v.optional(v.id("inquiryConfirmationIntents")),
    confirmationExpiresAt: v.optional(v.string()),
    confirmedExecutionRevision: v.optional(v.string()),
    confirmedAt: v.optional(v.string()),
    // Trusted quote written only by inquiryPricing after the worker resolves
    // the exact E.164 destination. Public draft mutations never write it.
    pricingQuote: v.optional(v.any()),
    pricingRequestId: v.optional(v.string()),
    pricingRequestedAt: v.optional(v.string()),
    creditReservationId: v.optional(v.id("inquiryCreditReservations")),
    nextEventSequence: v.number(),
    resultState: v.union(v.literal("not_ready"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_owner_create_key", ["ownerCreateKey"])
    .index("by_owner", ["ownerId"]),

  inquiryConfirmationIntents: defineTable({
    taskId: v.id("inquiryTasks"),
    ownerId: v.string(),
    ownerIntentKey: v.string(),
    expectedRevision: v.number(),
    executionRevision: v.string(),
    pricingQuoteId: v.string(),
    state: v.union(v.literal("ready"), v.literal("confirmed"), v.literal("expired"), v.literal("revoked")),
    expiresAt: v.string(),
    createdAt: v.string(),
    consumedAt: v.optional(v.string()),
  })
    .index("by_owner_intent_key", ["ownerIntentKey"])
    .index("by_task", ["taskId"]),

  inquiryAttempts: defineTable({
    taskId: v.id("inquiryTasks"),
    ownerId: v.string(),
    destinationE164: v.string(),
    ownerConfirmKey: v.string(),
    attemptNumber: v.literal(1),
    status: inquiryAttemptStatusValidator,
    confirmedRevision: v.number(),
    confirmedExecutionRevision: v.string(),
    confirmationIntentId: v.id("inquiryConfirmationIntents"),
    creditReservationId: v.id("inquiryCreditReservations"),
    nextWorkerSequence: v.number(),
    dispatchState: inquiryDispatchStateValidator,
    dispatchIdempotencyKey: v.string(),
    dispatchClaimKey: v.optional(v.string()),
    dispatchLeaseToken: v.optional(v.string()),
    externalCallId: v.optional(v.string()),
    dispatchLeaseAcquiredAt: v.optional(v.string()),
    dispatchLeaseExpiresAt: v.optional(v.string()),
    dispatchFinalizedAt: v.optional(v.string()),
    dispatchFailureCode: v.optional(v.string()),
    dispatchResolutionKey: v.optional(v.string()),
    connectedAt: v.optional(v.string()),
    terminalAt: v.optional(v.string()),
    terminalReason: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_task", ["taskId"])
    .index("by_owner_confirm_key", ["ownerConfirmKey"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_owner_created_at", ["ownerId", "createdAt"])
    .index("by_destination_status", ["destinationE164", "status"])
    .index("by_destination_created_at", ["destinationE164", "createdAt"])
    .index("by_external_call_id", ["externalCallId"]),

  inquiryRecipientOptOuts: defineTable({
    destinationE164: v.string(),
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    source: v.union(v.literal("recipient_declined"), v.literal("operator"), v.literal("provider")),
    reason: v.string(),
    optedOutAt: v.string(),
  }).index("by_destination", ["destinationE164"]),

  inquiryPricingRequests: defineTable({
    ownerId: v.string(),
    taskId: v.id("inquiryTasks"),
    requestId: v.string(),
    createdAt: v.string(),
  }).index("by_owner_created_at", ["ownerId", "createdAt"]),

  inquiryEvents: defineTable({
    taskId: v.id("inquiryTasks"),
    attemptId: v.optional(v.id("inquiryAttempts")),
    eventId: v.string(),
    sequence: v.number(),
    type: inquiryEventTypeValidator,
    source: v.union(v.literal("callbridge_server"), v.literal("telephony_worker")),
    workerSequence: v.optional(v.number()),
    attemptSequenceKey: v.optional(v.string()),
    questionId: v.optional(v.string()),
    evidenceExcerpt: v.optional(v.string()),
    revision: v.number(),
    executionRevision: v.string(),
    occurredAt: v.string(),
  })
    .index("by_event_id", ["eventId"])
    .index("by_attempt_sequence_key", ["attemptSequenceKey"])
    .index("by_task_sequence", ["taskId", "sequence"]),

  inquiryResults: defineTable({
    taskId: v.id("inquiryTasks"),
    attemptId: v.id("inquiryAttempts"),
    resultKey: v.string(),
    result: inquiryCallResultValidator,
    actualCostMinorUnits: v.number(),
    costStatus: v.union(v.literal("provider_reported"), v.literal("pending")),
    costSettlementKey: v.optional(v.string()),
    createdAt: v.string(),
  })
    .index("by_task", ["taskId"])
    .index("by_result_key", ["resultKey"]),

  inquiryCreditAccounts: defineTable({
    ownerId: v.string(),
    currency: v.string(),
    ownerCurrencyKey: v.string(),
    balanceMinorUnits: v.number(),
    reservedMinorUnits: v.number(),
    updatedAt: v.string(),
  })
    .index("by_owner_currency", ["ownerCurrencyKey"])
    .index("by_owner", ["ownerId"]),

  inquiryCreditReservations: defineTable({
    taskId: v.id("inquiryTasks"),
    ownerId: v.string(),
    ownerCurrencyKey: v.string(),
    executionRevision: v.string(),
    currency: v.string(),
    reservedMinorUnits: v.number(),
    actualMinorUnits: v.optional(v.number()),
    state: v.union(v.literal("reserved"), v.literal("settled"), v.literal("released")),
    createdAt: v.string(),
    settledAt: v.optional(v.string()),
    releasedAt: v.optional(v.string()),
  })
    .index("by_task", ["taskId"])
    .index("by_owner", ["ownerId"]),

  inquiryCreditLedger: defineTable({
    ownerId: v.string(),
    currency: v.string(),
    entryKey: v.string(),
    kind: v.union(v.literal("grant"), v.literal("reserve"), v.literal("settle"), v.literal("release")),
    amountMinorUnits: v.number(),
    taskId: v.optional(v.id("inquiryTasks")),
    reservationId: v.optional(v.id("inquiryCreditReservations")),
    occurredAt: v.string(),
  })
    .index("by_entry_key", ["entryKey"])
    .index("by_owner", ["ownerId"]),

  inquiryPlaybooks: defineTable({
    ownerId: v.optional(v.string()),
    playbookKey: v.string(),
    id: v.string(),
    source: v.union(v.literal("system"), v.literal("user_created")),
    status: v.union(v.literal("draft"), v.literal("approved")),
    revision: v.number(),
    approvedRevision: v.optional(v.number()),
    name: v.string(),
    steps: v.array(v.object({ id: v.string(), instruction: v.string() })),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_playbook_key", ["playbookKey"])
    .index("by_owner", ["ownerId"]),

  hotelDemoTasks: defineTable({
    ownerId: v.string(),
    ownerCreateKey: v.string(),
    createIdempotencyKey: v.string(),
    status: hotelDemoTaskStatusValidator,
    revision: v.number(),
    policyVersion: v.literal("hotel-ja-v1"),
    destinationId: v.literal("controlled-hotel"),
    destinationDisplayName: v.string(),
    destinationPhoneE164: v.string(),
    destinationMaskedPhone: v.string(),
    objectiveId: v.literal("late-check-in"),
    questionIds: v.array(hotelDemoQuestionIdValidator),
    disclosureText: v.string(),
    disclosureApprovedAt: v.string(),
    pricingState: v.union(v.literal("not_ready"), v.literal("ready")),
    pricingRevision: v.optional(v.number()),
    pricingDestinationCountry: v.optional(v.string()),
    pricingDestinationIsoCountry: v.optional(v.string()),
    pricingRateDescription: v.optional(v.string()),
    pricingCurrentPricePerMinute: v.optional(v.string()),
    pricingCurrency: v.optional(v.string()),
    pricingMaximumConnectedSeconds: v.optional(v.number()),
    pricingEstimatedMaximumPstnCharge: v.optional(v.string()),
    pricingQuotedAt: v.optional(v.string()),
    pricingExpiresAt: v.optional(v.string()),
    pricingSource: v.optional(v.union(v.literal("twilio_voice_number_pricing_api_v2"), v.literal("twilio_public_outbound_pricing_csv"))),
    pricingAccountSpecific: v.optional(v.boolean()),
    confirmationState: hotelDemoConfirmationStateValidator,
    confirmationIntentId: v.optional(v.id("hotelDemoConfirmationIntents")),
    confirmationExpiresAt: v.optional(v.string()),
    nextActivitySequence: v.number(),
    resultState: v.union(v.literal("not_ready"), v.literal("processing"), v.literal("ready"), v.literal("failed")),
    deleteAt: v.string(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_owner_create_key", ["ownerCreateKey"])
    .index("by_owner", ["ownerId"])
    .index("by_delete_at", ["deleteAt"]),

  hotelDemoConfirmationIntents: defineTable({
    taskId: v.id("hotelDemoTasks"),
    ownerId: v.string(),
    ownerIdempotencyKey: v.string(),
    expectedRevision: v.number(),
    state: v.union(v.literal("ready"), v.literal("confirmed"), v.literal("expired"), v.literal("revoked")),
    expiresAt: v.string(),
    createdAt: v.string(),
    consumedAt: v.optional(v.string()),
  })
    .index("by_owner_idempotency", ["ownerIdempotencyKey"])
    .index("by_task", ["taskId"]),

  hotelDemoAttempts: defineTable({
    taskId: v.id("hotelDemoTasks"),
    ownerId: v.string(),
    ownerConfirmKey: v.string(),
    attemptNumber: v.literal(1),
    status: hotelDemoAttemptStatusValidator,
    confirmedRevision: v.number(),
    confirmationIntentId: v.id("hotelDemoConfirmationIntents"),
    externalCallId: v.optional(v.string()),
    dispatchLeaseAcquiredAt: v.optional(v.string()),
    hangupRequestedAt: v.optional(v.string()),
    stopOwnerKey: v.optional(v.string()),
    nextWorkerSequence: v.number(),
    publicEventCount: v.number(),
    connectedAt: v.optional(v.string()),
    terminalAt: v.optional(v.string()),
    terminalReason: v.optional(v.union(
      v.literal("completed"), v.literal("remote_hangup"), v.literal("no_answer"), v.literal("provider_failure"),
      v.literal("user_cancelled"), v.literal("user_ended"), v.literal("connected_timeout"),
    )),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_task", ["taskId"])
    .index("by_owner_confirm_key", ["ownerConfirmKey"]),

  hotelDemoActivityEvents: defineTable({
    taskId: v.id("hotelDemoTasks"),
    activitySequence: v.number(),
    projectedAt: v.string(),
    gapBefore: v.boolean(),
    event: v.union(hotelDemoTaskActivityEventValidator, hotelDemoAttemptEventValidator),
  }).index("by_task_sequence", ["taskId", "activitySequence"]),

  hotelDemoAttemptEvents: defineTable({
    taskId: v.id("hotelDemoTasks"),
    attemptId: v.id("hotelDemoAttempts"),
    eventId: v.string(),
    attemptSequenceKey: v.string(),
    workerSequence: v.number(),
    receivedAt: v.string(),
    projected: v.boolean(),
    rejectionReason: v.optional(v.union(v.literal("event_cap"), v.literal("late_after_result"))),
    event: hotelDemoAttemptEventValidator,
  })
    .index("by_event_id", ["eventId"])
    .index("by_attempt_sequence_key", ["attemptSequenceKey"])
    .index("by_attempt_sequence", ["attemptId", "workerSequence"])
    .index("by_attempt", ["attemptId"]),

  hotelDemoResults: defineTable({
    taskId: v.id("hotelDemoTasks"),
    attemptId: v.id("hotelDemoAttempts"),
    result: hotelDemoCallResultValidator,
    createdAt: v.string(),
  }).index("by_task", ["taskId"]),

  hotelDemoRetentionState: defineTable({
    key: v.literal("hotel-demo"),
    healthy: v.boolean(),
    overdueCount: v.number(),
    lastCheckedAt: v.string(),
    lastSuccessfulRunAt: v.optional(v.string()),
    lastFailureAt: v.optional(v.string()),
  }).index("by_key", ["key"]),

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
    completedAt: v.optional(v.string()),
    retentionDeleteAt: v.optional(v.string()),
    postStayReviewPromptAt: v.optional(v.string()),
    postStayReviewPromptQueuedAt: v.optional(v.string()),
    purgedAt: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_status", ["ownerId", "status"])
    .index("by_retention_delete_at", ["retentionDeleteAt"])
    .index("by_post_stay_review_prompt_at", ["postStayReviewPromptAt"]),

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

  optionGatheringJobs: defineTable({
    taskId: v.id("callTasks"),
    ownerId: v.string(),
    idempotencyKey: v.string(),
    confirmationRevision: v.number(),
    reservedRevision: v.number(),
    runtime: v.object({ provider: v.string(), model: v.string() }),
    capability: v.literal("gather_options_only"),
    forbiddenActions: v.array(v.union(
      v.literal("book"),
      v.literal("pay"),
      v.literal("accept_terms"),
      v.literal("irreversible_commitment"),
      v.literal("cancel"),
    )),
    state: v.union(
      v.literal("reserved"),
      v.literal("retryable"),
      v.literal("dispatched"),
      v.literal("completed"),
      v.literal("failed"),
    ),
    attemptCount: v.number(),
    nextAttemptAt: v.optional(v.string()),
    externalSessionId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_task", ["taskId"])
    .index("by_state_next_attempt", ["state", "nextAttemptAt"]),

  taskTranscripts: defineTable({
    taskId: v.id("callTasks"),
    ownerId: v.string(),
    sourceLanguage: v.string(),
    targetLanguage: v.string(),
    translatedText: v.string(),
    createdAt: v.string(),
    deleteAt: v.string(),
  })
    .index("by_task", ["taskId"])
    .index("by_delete_at", ["deleteAt"]),

  morningBriefDeliveries: defineTable({
    ownerId: v.string(),
    localDate: v.string(),
    deliveryKey: v.string(),
    timeZone: v.string(),
    scheduledLocalTime: v.string(),
    status: v.union(v.literal("prepared"), v.literal("queued"), v.literal("completed_noop")),
    payload: morningBriefDeliveryPayloadValidator,
    preparedAt: v.string(),
    queuedNotificationId: v.optional(v.id("notificationOutbox")),
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
  })
    .index("by_task_disclosure", ["taskDisclosureKey"])
    .index("by_task", ["taskId"]),

  pushSubscriptions: defineTable({
    ownerId: v.string(),
    token: v.string(),
    ownerTokenKey: v.string(),
    platform: v.union(v.literal("ios"), v.literal("android"), v.literal("web")),
    enabled: v.boolean(),
    createdAt: v.string(),
    updatedAt: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_token", ["ownerTokenKey"]),

  gmailOAuthAttempts: defineTable({
    ownerId: v.string(),
    stateHash: v.string(),
    codeVerifier: v.string(),
    expiresAt: v.string(),
    createdAt: v.string(),
    consumedAt: v.optional(v.string()),
  })
    .index("by_state_hash", ["stateHash"])
    .index("by_owner", ["ownerId"]),

  gmailConnections: defineTable({
    ownerId: v.string(),
    emailAddress: v.string(),
    encryptedRefreshToken: v.string(),
    refreshTokenIv: v.string(),
    scope: v.string(),
    connectedAt: v.string(),
    updatedAt: v.string(),
  }).index("by_owner", ["ownerId"]),

  messageDrafts: defineTable({
    ownerId: v.string(),
    recipientLabel: v.string(),
    text: v.string(),
    createdAt: v.string(),
    deleteAt: v.string(),
  }).index("by_owner", ["ownerId"]).index("by_delete_at", ["deleteAt"]),

  notificationOutbox: defineTable({
    ownerId: v.string(),
    taskId: v.optional(v.id("callTasks")),
    kind: v.union(
      v.literal("morning_brief"),
      v.literal("post_stay_review"),
      v.literal("task_result"),
      v.literal("proactive_finding"),
    ),
    idempotencyKey: v.string(),
    title: v.string(),
    body: v.string(),
    data: v.record(v.string(), v.string()),
    state: v.union(
      v.literal("pending"),
      v.literal("blocked"),
      v.literal("delivered"),
      v.literal("failed"),
    ),
    createdAt: v.string(),
    lastAttemptAt: v.optional(v.string()),
    deliveredAt: v.optional(v.string()),
    externalMessageId: v.optional(v.string()),
    failureReason: v.optional(v.string()),
  })
    .index("by_idempotency_key", ["idempotencyKey"])
    .index("by_state", ["state"])
    .index("by_owner", ["ownerId"])
    .index("by_task", ["taskId"]),

  travelerGroups: defineTable({
    ownerId: v.string(),
    group: v.object({
      name: v.string(),
      adults: v.number(),
      children: v.number(),
      infants: v.number(),
      pets: v.number(),
      requirements: v.array(
        v.object({
          label: v.string(),
          disclosure: v.union(v.literal("always"), v.literal("only_when_relevant")),
        }),
      ),
    }),
    createdAt: v.string(),
    updatedAt: v.string(),
  }).index("by_owner", ["ownerId"]),

  categoryAutomationPreferences: defineTable({
    ownerId: v.string(),
    ownerCategoryKey: v.string(),
    preference: v.object({
      category: v.union(v.literal("accommodation"), v.literal("restaurant"), v.literal("service"), v.literal("transport"), v.literal("delivery"), v.literal("marketplace"), v.literal("property"), v.literal("vehicle"), v.literal("other")),
      backgroundSearchEnabled: v.boolean(),
      notificationsEnabled: v.boolean(),
    }),
    updatedAt: v.string(),
  }).index("by_owner_category", ["ownerCategoryKey"]).index("by_owner", ["ownerId"]),

  proactiveFindings: defineTable({
    taskId: v.id("callTasks"),
    ownerId: v.string(),
    summary: v.string(),
    source: v.string(),
    expiresAt: v.optional(v.string()),
    state: v.union(v.literal("proposed"), v.literal("approved"), v.literal("dismissed"), v.literal("expired")),
    createdAt: v.string(),
    decidedAt: v.optional(v.string()),
  }).index("by_task", ["taskId"]).index("by_owner", ["ownerId"]),

  postStayReviews: defineTable({
    ownerId: v.string(),
    taskId: v.id("callTasks"),
    rating: v.optional(v.number()),
    liked: v.optional(v.string()),
    disliked: v.optional(v.string()),
    note: v.optional(v.string()),
    createdAt: v.string(),
  }).index("by_task", ["taskId"]).index("by_owner", ["ownerId"]),

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

  remoteHosts: defineTable({
    hostId: v.string(),
    displayName: v.string(),
    secretHash: v.string(),
    state: v.union(v.literal("online"), v.literal("offline"), v.literal("revoked")),
    createdAt: v.string(),
    updatedAt: v.string(),
    lastSeenAt: v.string(),
  }).index("by_host_id", ["hostId"]),

  remoteCommands: defineTable({
    hostId: v.string(),
    hostRequestKey: v.string(),
    clientRequestId: v.string(),
    kind: remoteCommandKindValidator,
    instruction: v.optional(v.string()),
    state: remoteCommandStatusValidator,
    nextEventSequence: v.number(),
    requestedAt: v.string(),
    startedAt: v.optional(v.string()),
    completedAt: v.optional(v.string()),
    cancellationRequestedAt: v.optional(v.string()),
    resultSummary: v.optional(v.string()),
    failureReason: v.optional(v.string()),
    expiresAt: v.string(),
  })
    .index("by_host_request", ["hostRequestKey"])
    .index("by_host_requested", ["hostId", "requestedAt"])
    .index("by_host_state_requested", ["hostId", "state", "requestedAt"])
    .index("by_expires_at", ["expiresAt"]),

  remoteCommandEvents: defineTable({
    commandId: v.id("remoteCommands"),
    hostId: v.string(),
    sequence: v.number(),
    kind: remoteCommandEventKindValidator,
    message: v.string(),
    createdAt: v.string(),
  })
    .index("by_command_sequence", ["commandId", "sequence"])
    .index("by_host", ["hostId"]),
});
