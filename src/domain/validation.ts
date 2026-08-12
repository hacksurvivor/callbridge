import { z } from "zod";

import { DomainError } from "./errors.js";
import { assertDateResolutionMatches } from "./dateResolution.js";
import { CALL_WINDOW_DAYS, TASK_CATEGORIES } from "./model.js";

const nonBlank = z.string().trim().min(1).max(2_000);
const languageTag = z
  .string()
  .trim()
  .regex(/^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, "Must be a BCP 47 language tag");
const isoDate = z.string().date();
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const currency = z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/);
const ianaTimeZone = z.string().trim().min(1).max(100).superRefine((value, context) => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
  } catch {
    context.addIssue({ code: "custom", message: "Must use a valid IANA time zone" });
  }
});

const dateResolutionSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("explicit"),
    checkIn: isoDate,
    checkOut: isoDate,
    resolvedAt: z.string().datetime({ offset: true }),
    referenceTimeZone: ianaTimeZone,
    timeZoneSource: z.enum(["device", "profile", "manual"]),
  }),
  z.object({
    source: z.literal("relative"),
    expression: z.literal("next_weekend"),
    referenceInstant: z.string().datetime({ offset: true }),
    checkIn: isoDate,
    checkOut: isoDate,
    resolvedAt: z.string().datetime({ offset: true }),
    referenceTimeZone: ianaTimeZone,
    timeZoneSource: z.enum(["device", "profile", "manual"]),
  }),
]);

export const sourceMaterialSchema = z
  .object({
    typedContext: nonBlank.optional(),
    voiceNote: z
      .object({
        storageKey: nonBlank,
        transcript: nonBlank.optional(),
        mediaType: z.string().trim().min(1).max(100).optional(),
      })
      .optional(),
    transcript: nonBlank.optional(),
    sourceUrl: z.string().url().max(2_048).optional(),
    screenshot: z
      .object({
        storageKey: nonBlank,
        mediaType: z.enum(["image/jpeg", "image/png", "image/webp"]),
        extractedText: nonBlank.optional(),
      })
      .optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one source is required",
  });

const taskContactSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("phone"),
    value: z.string().trim().min(3).max(40),
    label: z.string().trim().min(1).max(100).optional(),
    verified: z.boolean(),
  }),
  z.object({
    kind: z.literal("email"),
    value: z.string().email().max(254),
    label: z.string().trim().min(1).max(100).optional(),
    verified: z.boolean(),
  }),
  z.object({
    kind: z.literal("website"),
    value: z.string().url().max(2_048),
    label: z.string().trim().min(1).max(100).optional(),
    verified: z.boolean(),
  }),
]);

const detailValueSchema = z.union([
  nonBlank,
  z.number().finite(),
  z.boolean(),
  z.array(nonBlank.max(300)).max(50),
]);

export const autonomySettingsSchema = z
  .object({
    fullAccess: z.boolean(),
    automaticallyTryNextVerifiedNumber: z.boolean(),
    automaticallyRetryUnavailableNumber: z.boolean(),
    retryDelayMinutes: z.literal(5),
    maxAutomaticRetriesPerNumber: z.literal(2),
    mentionPastVisits: z.boolean(),
    useCompetitorPricing: z.boolean(),
    nameCompetitorAndExactPrice: z.boolean(),
    proactiveFollowUp: z
      .object({
        goal: nonBlank.max(500),
        expiresAt: z.string().datetime({ offset: true }),
      })
      .optional(),
  })
  .superRefine((value, context) => {
    if (
      !value.fullAccess &&
      (value.automaticallyTryNextVerifiedNumber ||
        value.automaticallyRetryUnavailableNumber)
    ) {
      context.addIssue({
        code: "custom",
        path: ["fullAccess"],
        message: "Automatic number selection and retries require Full Access",
      });
    }
    if (value.nameCompetitorAndExactPrice && !value.useCompetitorPricing) {
      context.addIssue({
        code: "custom",
        path: ["nameCompetitorAndExactPrice"],
        message: "Exact competitor prices require competitor pricing to be enabled",
      });
    }
    if (value.proactiveFollowUp && !value.fullAccess) {
      context.addIssue({
        code: "custom",
        path: ["fullAccess"],
        message: "Proactive follow-up requires Full Access for this task",
      });
    }
  });

export const memoryRetentionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("save_for_30_days"),
    retainForDays: z.literal(30),
  }),
  z.object({
    mode: z.literal("no_save"),
  }),
]);

export const localCallWindowSchema = z
  .object({
    timeZone: z.string().trim().min(1).max(100),
    days: z.array(z.enum(CALL_WINDOW_DAYS)).min(1).max(7),
    opensAt: localTime,
    closesAt: localTime,
  })
  .superRefine((value, context) => {
    if (new Set(value.days).size !== value.days.length) {
      context.addIssue({
        code: "custom",
        path: ["days"],
        message: "Call window days must be unique",
      });
    }
    if (value.opensAt >= value.closesAt) {
      context.addIssue({
        code: "custom",
        path: ["closesAt"],
        message: "Call window must close after it opens",
      });
    }
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value.timeZone }).format();
    } catch {
      context.addIssue({
        code: "custom",
        path: ["timeZone"],
        message: "Call window must use a valid IANA time zone",
      });
    }
  });

export const permissionBoundariesSchema = z.object({
  scope: z.literal("gather_options_only"),
  mayShareProvidedDetails: z.boolean(),
  mayBook: z.literal(false),
  mayPay: z.literal(false),
  mayAcceptTerms: z.literal(false),
  mayMakeIrreversibleCommitment: z.literal(false),
  mayCancel: z.literal(false),
});

export const callTaskDraftSchema = z.object({
  category: z.enum(TASK_CATEGORIES),
  title: nonBlank.max(300),
  sources: sourceMaterialSchema,
  target: z.object({
    name: nonBlank.max(300).optional(),
    contacts: z.array(taskContactSchema).max(20),
    address: nonBlank.max(500).optional(),
  }),
  details: z
    .record(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/), detailValueSchema)
    .refine((value) => Object.keys(value).length <= 80, {
      message: "At most 80 task detail fields are allowed",
    }),
  travelerGroupSnapshot: z
    .object({
      name: nonBlank.max(100),
      adults: z.number().int().min(0).max(30),
      children: z.number().int().min(0).max(30),
      infants: z.number().int().min(0).max(30),
      pets: z.number().int().min(0).max(30),
      requirements: z.array(
        z.object({
          label: nonBlank.max(300),
          disclosure: z.enum(["always", "only_when_relevant"]),
        }),
      ).max(30),
    })
    .refine((group) => group.adults + group.children + group.infants >= 1, {
      message: "Traveler group snapshot needs at least one person",
    })
    .optional(),
  dateResolution: dateResolutionSchema.optional(),
  deliveryInstructions: z
    .object({
      savedLocationId: z.string().trim().min(1).max(200).optional(),
      leaveLocation: nonBlank.max(500).optional(),
      entryInstructions: nonBlank.max(500).optional(),
      intercom: nonBlank.max(100).optional(),
      landmarks: nonBlank.max(500).optional(),
      contactPreference: z.enum([
        "call_recipient",
        "message_recipient",
        "contact_user",
        "no_contact",
      ]),
    })
    .optional(),
  questions: z.array(nonBlank.max(500)).max(20),
  budget: z
    .object({
      maxMinorUnits: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      currency,
      includesMandatoryFees: z.boolean(),
    })
    .optional(),
  userLanguage: languageTag.optional(),
  callLanguage: languageTag.optional(),
  locale: languageTag.optional(),
  notes: nonBlank.max(2_000).optional(),
  autonomy: autonomySettingsSchema,
  memory: memoryRetentionSchema,
  callWindow: localCallWindowSchema,
  permissions: permissionBoundariesSchema,
});

export type ValidatedCallTaskDraft = z.infer<typeof callTaskDraftSchema>;

export function validateDraft(value: unknown): ValidatedCallTaskDraft {
  const result = callTaskDraftSchema.safeParse(value);
  if (!result.success) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "The call task draft is invalid",
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}

export function validateForConfirmation(value: unknown): ValidatedCallTaskDraft {
  const draft = validateDraft(value);
  const missing: string[] = [];

  if (!draft.target.name) missing.push("target.name is required");
  if (!draft.target.contacts.some((contact) => contact.kind === "phone")) {
    missing.push("at least one phone contact is required");
  }
  if (draft.questions.length === 0) missing.push("at least one question is required");
  if (!draft.userLanguage) missing.push("userLanguage is required");
  if (!draft.callLanguage) missing.push("callLanguage is required");
  if (!draft.locale) missing.push("locale is required");

  if (draft.category === "accommodation") {
    const checkIn = draft.details.checkIn;
    const checkOut = draft.details.checkOut;
    if (typeof checkIn !== "string" || !isoDate.safeParse(checkIn).success) {
      missing.push("details.checkIn is required for accommodation");
    }
    if (typeof checkOut !== "string" || !isoDate.safeParse(checkOut).success) {
      missing.push("details.checkOut is required for accommodation");
    }
    if (
      typeof checkIn === "string" &&
      typeof checkOut === "string" &&
      isoDate.safeParse(checkIn).success &&
      isoDate.safeParse(checkOut).success &&
      checkOut <= checkIn
    ) {
      missing.push("details.checkOut must be after details.checkIn");
    }
    if (!draft.dateResolution) {
      missing.push("dateResolution is required for accommodation");
    } else if (
      typeof checkIn === "string" &&
      typeof checkOut === "string" &&
      isoDate.safeParse(checkIn).success &&
      isoDate.safeParse(checkOut).success
    ) {
      try {
        assertDateResolutionMatches({ resolution: draft.dateResolution, checkIn, checkOut });
      } catch (error) {
        if (error instanceof DomainError) missing.push(...error.details, error.message);
        else throw error;
      }
    }
  }

  if (draft.category === "delivery") {
    const instructions = draft.deliveryInstructions;
    if (!instructions) {
      missing.push("deliveryInstructions is required for delivery");
    } else if (
      !instructions.leaveLocation &&
      !instructions.entryInstructions &&
      !instructions.intercom &&
      !instructions.landmarks
    ) {
      missing.push("at least one delivery location instruction is required");
    }
  }

  if (missing.length > 0) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "The draft is not ready for confirmation",
      missing,
    );
  }
  if (
    draft.autonomy.proactiveFollowUp &&
    new Date(draft.autonomy.proactiveFollowUp.expiresAt).getTime() <= Date.now()
  ) {
    throw new DomainError("VALIDATION_FAILED", "Proactive follow-up has already expired");
  }
  return draft;
}
