import type { CommunicationPreferences } from "./communicationPreferences.js";
import { validateCommunicationPreferences } from "./communicationPreferences.js";
import { DomainError } from "./errors.js";
import {
  buildMorningBrief,
  type BriefActivity,
  type BriefCommitment,
  type MorningBrief,
} from "./morningBrief.js";

export type MorningBriefDeliveryPayload = MorningBrief & {
  type: "morning_brief";
  localDate: string;
};

export type MorningBriefPreparationInput = {
  ownerId: string;
  now: Date;
  since: Date;
  preferences: unknown | null;
  activity: readonly BriefActivity[];
  commitments: readonly BriefCommitment[];
};

export type MorningBriefPreparationDecision =
  | {
      kind: "skipped";
      reason:
        | "missing_preferences"
        | "disabled"
        | "invalid_preferences"
        | "not_delivery_time"
        | "quiet_hours"
        | "empty_brief";
    }
  | {
      kind: "ready";
      ownerId: string;
      localDate: string;
      deliveryKey: string;
      timeZone: string;
      scheduledLocalTime: string;
      payload: MorningBriefDeliveryPayload;
    };

const LOCAL_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function minuteOfDay(value: string): number {
  const [hour = NaN, minute = NaN] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function isQuietMinute(value: string, startsAt: string, endsAt: string): boolean {
  const point = minuteOfDay(value);
  const start = minuteOfDay(startsAt);
  const end = minuteOfDay(endsAt);
  return start < end ? point >= start && point < end : point >= start || point < end;
}

function localDateTime(instant: Date, timeZone: string): { date: string; time: string } {
  try {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-CA", {
        timeZone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      })
        .formatToParts(instant)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
    if (!values.year || !values.month || !values.day || !values.hour || !values.minute) {
      throw new Error("invalid");
    }
    return {
      date: `${values.year}-${values.month}-${values.day}`,
      time: `${values.hour}:${values.minute}`,
    };
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Morning brief requires a valid IANA time zone");
  }
}

/**
 * Recognize a corrupted persisted preference whose configured delivery minute
 * is quiet. This check intentionally runs before full validation so delivery
 * fails closed with the most specific reason.
 */
function hasQuietDeliveryConfiguration(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const candidate = value as {
    quietHours?: { startsAt?: unknown; endsAt?: unknown };
    morningBrief?: { enabled?: unknown; deliverAt?: unknown };
  };
  const startsAt = candidate.quietHours?.startsAt;
  const endsAt = candidate.quietHours?.endsAt;
  const deliverAt = candidate.morningBrief?.deliverAt;
  if (
    candidate.morningBrief?.enabled !== true ||
    typeof startsAt !== "string" ||
    typeof endsAt !== "string" ||
    typeof deliverAt !== "string" ||
    !LOCAL_TIME.test(startsAt) ||
    !LOCAL_TIME.test(endsAt) ||
    !LOCAL_TIME.test(deliverAt) ||
    startsAt === endsAt
  ) {
    return false;
  }
  return isQuietMinute(deliverAt, startsAt, endsAt);
}

function validatedPreferences(value: unknown): CommunicationPreferences | null {
  try {
    return validateCommunicationPreferences(value);
  } catch (error) {
    if (error instanceof DomainError) return null;
    throw error;
  }
}

/**
 * Provider-neutral eligibility and payload construction for one scheduler tick.
 * A ready decision still must be claimed durably by tenant/date before an
 * adapter is invoked.
 */
export function prepareMorningBriefDelivery(
  input: MorningBriefPreparationInput,
): MorningBriefPreparationDecision {
  if (!input.ownerId.trim()) {
    throw new DomainError("VALIDATION_FAILED", "Morning brief requires an owner");
  }
  if (Number.isNaN(input.now.getTime()) || Number.isNaN(input.since.getTime())) {
    throw new DomainError("VALIDATION_FAILED", "Morning brief times are invalid");
  }
  if (input.preferences === null) {
    return { kind: "skipped", reason: "missing_preferences" };
  }
  if (hasQuietDeliveryConfiguration(input.preferences)) {
    return { kind: "skipped", reason: "quiet_hours" };
  }
  const preferences = validatedPreferences(input.preferences);
  if (!preferences) return { kind: "skipped", reason: "invalid_preferences" };
  if (!preferences.morningBrief.enabled) return { kind: "skipped", reason: "disabled" };

  const local = localDateTime(input.now, preferences.timeZone);
  if (local.time !== preferences.morningBrief.deliverAt) {
    return { kind: "skipped", reason: "not_delivery_time" };
  }
  if (
    isQuietMinute(
      local.time,
      preferences.quietHours.startsAt,
      preferences.quietHours.endsAt,
    )
  ) {
    return { kind: "skipped", reason: "quiet_hours" };
  }

  const brief = buildMorningBrief({
    now: input.now,
    since: input.since,
    timeZone: preferences.timeZone,
    activity: input.activity,
    commitments: input.commitments,
  });
  if (!brief) return { kind: "skipped", reason: "empty_brief" };

  return {
    kind: "ready",
    ownerId: input.ownerId,
    localDate: local.date,
    deliveryKey: `${input.ownerId}:${local.date}`,
    timeZone: preferences.timeZone,
    scheduledLocalTime: preferences.morningBrief.deliverAt,
    payload: {
      type: "morning_brief",
      localDate: local.date,
      generatedAt: brief.generatedAt,
      items: brief.items,
    },
  };
}
