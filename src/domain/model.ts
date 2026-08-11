export const CALL_TASK_STATUSES = [
  "draft",
  "confirmed",
  "gathering_options",
  "options_ready",
  "failed",
  "cancelled",
] as const;

export type CallTaskStatus = (typeof CALL_TASK_STATUSES)[number];

export const TASK_CATEGORIES = [
  "accommodation",
  "restaurant",
  "service",
  "transport",
  "delivery",
  "marketplace",
  "property",
  "vehicle",
  "other",
] as const;

export type TaskCategory = (typeof TASK_CATEGORIES)[number];

export type SourceMaterial = {
  typedContext?: string;
  voiceNote?: {
    storageKey: string;
    transcript?: string;
    mediaType?: string;
  };
  transcript?: string;
  sourceUrl?: string;
  screenshot?: {
    storageKey: string;
    mediaType: "image/jpeg" | "image/png" | "image/webp";
    extractedText?: string;
  };
};

export type TaskContact = {
  kind: "phone" | "email" | "website";
  value: string;
  label?: string;
  verified: boolean;
};

export type TaskTarget = {
  name?: string;
  contacts: TaskContact[];
  address?: string;
};

export type Money = {
  minorUnits: number;
  currency: string;
};

/**
 * Dates that are derived from language are never accepted as untraceable text.
 * The server stores both the concrete dates and the time-zone basis used to
 * produce them so a later confirmation cannot silently change their meaning.
 */
export type DateResolution =
  | {
      source: "explicit";
      checkIn: string;
      checkOut: string;
      resolvedAt: string;
      referenceTimeZone: string;
      timeZoneSource: "device" | "profile" | "manual";
    }
  | {
      source: "relative";
      expression: "next_weekend";
      referenceInstant: string;
      checkIn: string;
      checkOut: string;
      resolvedAt: string;
      referenceTimeZone: string;
      timeZoneSource: "device" | "profile" | "manual";
    };

export type TaskDetailValue = string | number | boolean | string[];

export type DeliveryInstructions = {
  savedLocationId?: string;
  leaveLocation?: string;
  entryInstructions?: string;
  intercom?: string;
  landmarks?: string;
  contactPreference:
    | "call_recipient"
    | "message_recipient"
    | "contact_user"
    | "no_contact";
};

export type AutonomySettings = {
  /**
   * Full access only widens the safe retry and communication conveniences below.
   * It never permits payment, term acceptance, purchase, or an irreversible commitment.
   */
  fullAccess: boolean;
  automaticallyTryNextVerifiedNumber: boolean;
  automaticallyRetryUnavailableNumber: boolean;
  retryDelayMinutes: 5;
  maxAutomaticRetriesPerNumber: 2;
  mentionPastVisits: boolean;
  useCompetitorPricing: boolean;
  nameCompetitorAndExactPrice: boolean;
  /** Explicit, task-scoped consent to keep checking while the user is unavailable. */
  proactiveFollowUp?: {
    goal: string;
    expiresAt: string;
  };
};

export type MemoryRetention =
  | {
      mode: "save_for_30_days";
      retainForDays: 30;
    }
  | {
      mode: "no_save";
    };

export const CALL_WINDOW_DAYS = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

export type CallWindowDay = (typeof CALL_WINDOW_DAYS)[number];

export type LocalCallWindow = {
  timeZone: string;
  days: CallWindowDay[];
  opensAt: string;
  closesAt: string;
};

export type PermissionBoundaries = {
  scope: "gather_options_only";
  mayShareProvidedDetails: boolean;
  mayBook: false;
  mayPay: false;
  mayAcceptTerms: false;
  mayMakeIrreversibleCommitment: false;
  mayCancel: false;
};

export const GATHER_OPTIONS_ONLY: PermissionBoundaries = Object.freeze({
  scope: "gather_options_only",
  mayShareProvidedDetails: true,
  mayBook: false,
  mayPay: false,
  mayAcceptTerms: false,
  mayMakeIrreversibleCommitment: false,
  mayCancel: false,
});

export type CallTaskDraft = {
  category: TaskCategory;
  title: string;
  sources: SourceMaterial;
  target: TaskTarget;
  details: Record<string, TaskDetailValue>;
  dateResolution?: DateResolution;
  deliveryInstructions?: DeliveryInstructions;
  questions: string[];
  budget?: {
    maxMinorUnits: number;
    currency: string;
    includesMandatoryFees: boolean;
  };
  userLanguage?: string;
  callLanguage?: string;
  locale?: string;
  notes?: string;
  autonomy: AutonomySettings;
  memory: MemoryRetention;
  callWindow: LocalCallWindow;
  permissions: PermissionBoundaries;
};

export type Confirmation = {
  confirmedAt: string;
  confirmedByUserId: string;
  confirmedRevision: number;
  permissionScope: "gather_options_only";
  noSaveModeAcknowledged: boolean;
};

export type CancellationTerms =
  | {
      knowledge: "unknown";
    }
  | {
      knowledge: "known_free";
      checkedAt: string;
      source: string;
    }
  | {
      knowledge: "known_fee";
      fee: Money;
      checkedAt: string;
      source: string;
    };

export type CancellationRequest = {
  state: "terms_required" | "confirmation_required" | "confirmed";
  requestedAt: string;
  requestedByUserId: string;
  terms: CancellationTerms;
  termsDisclosedAt?: string;
  confirmation?: {
    confirmedAt: string;
    confirmedByUserId: string;
    confirmedRevision: number;
    disclosedTerms: Exclude<CancellationTerms, { knowledge: "unknown" }>;
  };
};

export type CallTask = {
  id: string;
  ownerId: string;
  status: CallTaskStatus;
  revision: number;
  draft: CallTaskDraft;
  confirmation?: Confirmation;
  cancellation?: CancellationRequest;
  retryControl?: {
    stoppedAt: string;
    stoppedByUserId: string;
  };
  execution?: {
    externalSessionId: string;
    startedAt: string;
  };
  failureReason?: string;
  createdAt: string;
  updatedAt: string;
};

export type AuthenticatedActor = {
  userId: string;
  sessionId: string;
  organizationId?: string;
  roles: readonly string[];
  permissions: readonly string[];
};
