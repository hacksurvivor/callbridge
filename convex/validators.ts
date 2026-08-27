import { v } from "convex/values";

export const sourceMaterialValidator = v.object({
  typedContext: v.optional(v.string()),
  voiceNote: v.optional(
    v.object({
      storageKey: v.string(),
      transcript: v.optional(v.string()),
      mediaType: v.optional(v.string()),
    }),
  ),
  transcript: v.optional(v.string()),
  sourceUrl: v.optional(v.string()),
  screenshot: v.optional(
    v.object({
      storageKey: v.string(),
      mediaType: v.union(v.literal("image/jpeg"), v.literal("image/png"), v.literal("image/webp")),
      extractedText: v.optional(v.string()),
    }),
  ),
});

export const taskCategoryValidator = v.union(
  v.literal("accommodation"),
  v.literal("restaurant"),
  v.literal("service"),
  v.literal("transport"),
  v.literal("delivery"),
  v.literal("marketplace"),
  v.literal("property"),
  v.literal("vehicle"),
  v.literal("other"),
);

export const autonomySettingsValidator = v.object({
  fullAccess: v.boolean(),
  automaticallyTryNextVerifiedNumber: v.boolean(),
  automaticallyRetryUnavailableNumber: v.boolean(),
  retryDelayMinutes: v.literal(5),
  maxAutomaticRetriesPerNumber: v.literal(2),
  mentionPastVisits: v.boolean(),
  useCompetitorPricing: v.boolean(),
  nameCompetitorAndExactPrice: v.boolean(),
  proactiveFollowUp: v.optional(
    v.object({
      goal: v.string(),
      expiresAt: v.string(),
    }),
  ),
});

export const memoryRetentionValidator = v.union(
  v.object({
    mode: v.literal("save_for_30_days"),
    retainForDays: v.literal(30),
  }),
  v.object({
    mode: v.literal("no_save"),
  }),
);

export const callWindowDayValidator = v.union(
  v.literal("mon"),
  v.literal("tue"),
  v.literal("wed"),
  v.literal("thu"),
  v.literal("fri"),
  v.literal("sat"),
  v.literal("sun"),
);

export const localCallWindowValidator = v.object({
  timeZone: v.string(),
  days: v.array(callWindowDayValidator),
  opensAt: v.string(),
  closesAt: v.string(),
});

export const permissionBoundariesValidator = v.object({
  scope: v.literal("gather_options_only"),
  mayShareProvidedDetails: v.boolean(),
  mayBook: v.literal(false),
  mayPay: v.literal(false),
  mayAcceptTerms: v.literal(false),
  mayMakeIrreversibleCommitment: v.literal(false),
  mayCancel: v.literal(false),
});

export const detailValueValidator = v.union(
  v.string(),
  v.number(),
  v.boolean(),
  v.array(v.string()),
);

export const dateResolutionValidator = v.union(
  v.object({
    source: v.literal("explicit"),
    checkIn: v.string(),
    checkOut: v.string(),
    resolvedAt: v.string(),
    referenceTimeZone: v.string(),
    timeZoneSource: v.union(v.literal("device"), v.literal("profile"), v.literal("manual")),
  }),
  v.object({
    source: v.literal("relative"),
    expression: v.literal("next_weekend"),
    referenceInstant: v.string(),
    checkIn: v.string(),
    checkOut: v.string(),
    resolvedAt: v.string(),
    referenceTimeZone: v.string(),
    timeZoneSource: v.union(v.literal("device"), v.literal("profile"), v.literal("manual")),
  }),
);

export const callTaskDraftValidator = v.object({
  category: taskCategoryValidator,
  title: v.string(),
  sources: sourceMaterialValidator,
  target: v.object({
    name: v.optional(v.string()),
    contacts: v.array(
      v.object({
        kind: v.union(v.literal("phone"), v.literal("email"), v.literal("website")),
        value: v.string(),
        label: v.optional(v.string()),
        verified: v.boolean(),
      }),
    ),
    address: v.optional(v.string()),
    countryCode: v.optional(v.string()),
  }),
  details: v.record(v.string(), detailValueValidator),
  travelerGroupSnapshot: v.optional(
    v.object({
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
  ),
  dateResolution: v.optional(dateResolutionValidator),
  deliveryInstructions: v.optional(
    v.object({
      savedLocationId: v.optional(v.string()),
      leaveLocation: v.optional(v.string()),
      entryInstructions: v.optional(v.string()),
      intercom: v.optional(v.string()),
      landmarks: v.optional(v.string()),
      contactPreference: v.union(
        v.literal("call_recipient"),
        v.literal("message_recipient"),
        v.literal("contact_user"),
        v.literal("no_contact"),
      ),
    }),
  ),
  questions: v.array(v.string()),
  budget: v.optional(
    v.object({
      maxMinorUnits: v.number(),
      currency: v.string(),
      includesMandatoryFees: v.boolean(),
    }),
  ),
  userLanguage: v.optional(v.string()),
  callLanguage: v.optional(v.string()),
  locale: v.optional(v.string()),
  notes: v.optional(v.string()),
  autonomy: autonomySettingsValidator,
  memory: memoryRetentionValidator,
  callWindow: localCallWindowValidator,
  permissions: permissionBoundariesValidator,
});

export const callTaskStatusValidator = v.union(
  v.literal("draft"),
  v.literal("confirmed"),
  v.literal("gathering_options"),
  v.literal("options_ready"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const cancellationTermsValidator = v.union(
  v.object({ knowledge: v.literal("unknown") }),
  v.object({
    knowledge: v.literal("known_free"),
    checkedAt: v.string(),
    source: v.string(),
  }),
  v.object({
    knowledge: v.literal("known_fee"),
    fee: v.object({
      minorUnits: v.number(),
      currency: v.string(),
    }),
    checkedAt: v.string(),
    source: v.string(),
  }),
);

export const cancellationRequestValidator = v.object({
  state: v.union(
    v.literal("terms_required"),
    v.literal("confirmation_required"),
    v.literal("confirmed"),
  ),
  requestedAt: v.string(),
  requestedByUserId: v.string(),
  terms: cancellationTermsValidator,
  termsDisclosedAt: v.optional(v.string()),
  confirmation: v.optional(
    v.object({
      confirmedAt: v.string(),
      confirmedByUserId: v.string(),
      confirmedRevision: v.number(),
      disclosedTerms: v.union(
        v.object({
          knowledge: v.literal("known_free"),
          checkedAt: v.string(),
          source: v.string(),
        }),
        v.object({
          knowledge: v.literal("known_fee"),
          fee: v.object({
            minorUnits: v.number(),
            currency: v.string(),
          }),
          checkedAt: v.string(),
          source: v.string(),
        }),
      ),
    }),
  ),
});

export const confirmationValidator = v.object({
  confirmedAt: v.string(),
  confirmedByUserId: v.string(),
  confirmedRevision: v.number(),
  permissionScope: v.literal("gather_options_only"),
  noSaveModeAcknowledged: v.boolean(),
});

export const callTaskDocumentValidator = v.object({
  _id: v.id("callTasks"),
  _creationTime: v.number(),
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
});

export const friendlyPermissionLevelValidator = v.union(
  v.literal("manage_everything"),
  v.literal("help_with_tasks"),
  v.literal("view_updates"),
);

export const historyVisibilityValidator = v.union(
  v.literal("full_history"),
  v.literal("new_updates_only"),
);

export const remoteCommandKindValidator = v.union(
  v.literal("agent_task"),
  v.literal("status"),
  v.literal("pause_history"),
  v.literal("resume_history"),
  v.literal("summarize_recent"),
);

export const remoteCommandStatusValidator = v.union(
  v.literal("pending"),
  v.literal("running"),
  v.literal("cancellation_requested"),
  v.literal("succeeded"),
  v.literal("failed"),
  v.literal("cancelled"),
);

export const remoteCommandEventKindValidator = v.union(
  v.literal("status"),
  v.literal("output"),
  v.literal("warning"),
  v.literal("result"),
);

export const notificationPreferenceValidator = v.union(
  v.literal("push"),
  v.literal("monitor_only"),
);

export const communicationPreferencesValidator = v.object({
  timeZone: v.string(),
  quietHours: v.object({
    startsAt: v.string(),
    endsAt: v.string(),
  }),
  morningBrief: v.object({
    enabled: v.boolean(),
    deliverAt: v.string(),
  }),
});

export const taskActivityKindValidator = v.union(
  v.literal("task_started"),
  v.literal("lookup"),
  v.literal("contact_attempt"),
  v.literal("contact_answered"),
  v.literal("offer_found"),
  v.literal("decision_required"),
  v.literal("task_completed"),
  v.literal("task_paused"),
  v.literal("task_stopped"),
  v.literal("warning"),
);

export const taskActivityEventValidator = v.object({
  kind: taskActivityKindValidator,
  summary: v.string(),
  actionLabel: v.optional(v.string()),
  source: v.union(v.literal("agent"), v.literal("system"), v.literal("user")),
  occurredAt: v.string(),
});

export const morningBriefItemValidator = v.union(
  v.object({
    kind: v.literal("update"),
    taskId: v.string(),
    taskTitle: v.string(),
    summary: v.string(),
    occurredAt: v.string(),
  }),
  v.object({
    kind: v.literal("today"),
    taskId: v.string(),
    taskTitle: v.string(),
    summary: v.string(),
    occursAt: v.string(),
  }),
);

export const morningBriefDeliveryPayloadValidator = v.object({
  type: v.literal("morning_brief"),
  localDate: v.string(),
  generatedAt: v.string(),
  items: v.array(morningBriefItemValidator),
});

export const relationshipMemoryValidator = v.object({
  category: taskCategoryValidator,
  placeName: v.string(),
  placeAddress: v.optional(v.string()),
  summary: v.string(),
  facts: v.array(v.string()),
  lastRelevantDate: v.optional(v.string()),
  mayUseInCalls: v.boolean(),
  visibility: v.literal("owner_only"),
});

export const deliveryDisclosureKindValidator = v.union(
  v.literal("entry_instructions"),
  v.literal("intercom"),
);

export const travelerRequirementValidator = v.object({
  label: v.string(),
  disclosure: v.union(v.literal("always"), v.literal("only_when_relevant")),
});

export const travelerGroupValidator = v.object({
  name: v.string(),
  adults: v.number(),
  children: v.number(),
  infants: v.number(),
  pets: v.number(),
  requirements: v.array(travelerRequirementValidator),
});

export const categoryAutomationPreferenceValidator = v.object({
  category: taskCategoryValidator,
  backgroundSearchEnabled: v.boolean(),
  notificationsEnabled: v.boolean(),
});
