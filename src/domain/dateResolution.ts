import { DomainError } from "./errors.js";
import type { DateResolution } from "./model.js";

const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

function assertIanaTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
  } catch {
    throw new DomainError("VALIDATION_FAILED", "A valid IANA time zone is required");
  }
}

function localCalendarDate(instant: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(instant);
  const values = Object.fromEntries(
    parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
  );
  const weekday = values.weekday ? WEEKDAY_INDEX[values.weekday] : undefined;
  const year = Number(values.year);
  const month = Number(values.month);
  const day = Number(values.day);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day) || weekday === undefined) {
    throw new DomainError("VALIDATION_FAILED", "Could not resolve the local calendar date");
  }
  return { year, month, day, weekday };
}

function plusDays(date: { year: number; month: number; day: number }, days: number): string {
  const result = new Date(Date.UTC(date.year, date.month - 1, date.day + days));
  return result.toISOString().slice(0, 10);
}

/**
 * A deliberately small, deterministic resolver for the canonical expression
 * emitted by the language layer. It uses the user's declared IANA time zone;
 * it never uses the server clock's locale or asks the model to do date maths.
 */
export function resolveNextWeekend(input: {
  referenceInstant: string;
  referenceTimeZone: string;
  timeZoneSource: "device" | "profile" | "manual";
  resolvedAt?: string;
}): Extract<DateResolution, { source: "relative" }> {
  assertIanaTimeZone(input.referenceTimeZone);
  const reference = new Date(input.referenceInstant);
  if (Number.isNaN(reference.getTime())) {
    throw new DomainError("VALIDATION_FAILED", "Reference instant is invalid");
  }
  const local = localCalendarDate(reference, input.referenceTimeZone);
  // Friday is the configurable product default for a two-night weekend stay.
  // If today is Friday, "next weekend" means the following Friday.
  let daysUntilFriday = 5 - local.weekday;
  if (daysUntilFriday <= 0) daysUntilFriday += 7;
  const checkIn = plusDays(local, daysUntilFriday);
  const checkOut = plusDays(local, daysUntilFriday + 2);
  return {
    source: "relative",
    expression: "next_weekend",
    referenceInstant: reference.toISOString(),
    referenceTimeZone: input.referenceTimeZone,
    timeZoneSource: input.timeZoneSource,
    checkIn,
    checkOut,
    resolvedAt: input.resolvedAt ?? new Date().toISOString(),
  };
}

export function assertDateResolutionMatches(input: {
  resolution: DateResolution;
  checkIn: string;
  checkOut: string;
}): void {
  const { resolution, checkIn, checkOut } = input;
  if (resolution.checkIn !== checkIn || resolution.checkOut !== checkOut) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Concrete task dates must match the recorded date resolution",
    );
  }
  if (resolution.source === "relative") {
    const expected = resolveNextWeekend({
      referenceInstant: resolution.referenceInstant,
      referenceTimeZone: resolution.referenceTimeZone,
      timeZoneSource: resolution.timeZoneSource,
      resolvedAt: resolution.resolvedAt,
    });
    if (expected.checkIn !== resolution.checkIn || expected.checkOut !== resolution.checkOut) {
      throw new DomainError(
        "VALIDATION_FAILED",
        "Relative dates do not match the deterministic time-zone resolution",
      );
    }
  }
}
