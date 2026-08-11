import { z } from "zod";

import { DomainError } from "./errors.js";

const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

function isValidIanaTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function minutes(value: string): number {
  const [hour = NaN, minute = NaN] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isWithinQuietHours(value: string, startsAt: string, endsAt: string): boolean {
  const point = minutes(value);
  const start = minutes(startsAt);
  const end = minutes(endsAt);
  return start < end ? point >= start && point < end : point >= start || point < end;
}

export const communicationPreferencesSchema = z
  .object({
    timeZone: z.string().trim().min(1).max(100),
    quietHours: z.object({
      startsAt: localTime,
      endsAt: localTime,
    }),
    morningBrief: z.object({
      enabled: z.boolean(),
      deliverAt: localTime,
    }),
  })
  .superRefine((value, context) => {
    if (!isValidIanaTimeZone(value.timeZone)) {
      context.addIssue({ code: "custom", path: ["timeZone"], message: "Must use a valid IANA time zone" });
    }
    if (value.quietHours.startsAt === value.quietHours.endsAt) {
      context.addIssue({ code: "custom", path: ["quietHours"], message: "Quiet hours must have a duration" });
    }
    if (
      value.morningBrief.enabled &&
      isWithinQuietHours(
        value.morningBrief.deliverAt,
        value.quietHours.startsAt,
        value.quietHours.endsAt,
      )
    ) {
      context.addIssue({
        code: "custom",
        path: ["morningBrief", "deliverAt"],
        message: "Morning brief must be outside quiet hours",
      });
    }
  });

export type CommunicationPreferences = z.infer<typeof communicationPreferencesSchema>;

export const DEFAULT_COMMUNICATION_PREFERENCES: CommunicationPreferences = Object.freeze({
  timeZone: "UTC",
  quietHours: { startsAt: "22:00", endsAt: "08:00" },
  morningBrief: { enabled: true, deliverAt: "08:00" },
});

export function validateCommunicationPreferences(value: unknown): CommunicationPreferences {
  const result = communicationPreferencesSchema.safeParse(value);
  if (!result.success) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Communication preferences are invalid",
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  return result.data;
}
