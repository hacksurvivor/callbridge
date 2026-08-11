import { DomainError } from "./errors.js";
import type {
  AutonomySettings,
  CallWindowDay,
  LocalCallWindow,
  MemoryRetention,
  TaskCategory,
} from "./model.js";

export const DEFAULT_AUTONOMY: AutonomySettings = Object.freeze({
  fullAccess: false,
  automaticallyTryNextVerifiedNumber: false,
  automaticallyRetryUnavailableNumber: false,
  retryDelayMinutes: 5,
  maxAutomaticRetriesPerNumber: 2,
  mentionPastVisits: false,
  useCompetitorPricing: false,
  nameCompetitorAndExactPrice: false,
});

export function canRunProactiveFollowUp(input: {
  autonomy: AutonomySettings;
  now: Date;
  stopped?: boolean;
}): boolean {
  const authorization = input.autonomy.proactiveFollowUp;
  if (input.stopped || !input.autonomy.fullAccess || !authorization) return false;
  const expiresAt = new Date(authorization.expiresAt);
  return !Number.isNaN(expiresAt.getTime()) && input.now.getTime() < expiresAt.getTime();
}

/** Monitoring is opt-in by importance, with a small automatic window before an event. */
export function shouldMonitorConfirmedCommitment(input: {
  confirmed: boolean;
  important: boolean;
  occursAt?: string;
  now: Date;
}): boolean {
  if (!input.confirmed) return false;
  if (input.important) return true;
  if (!input.occursAt) return false;
  const occursAt = new Date(input.occursAt);
  if (Number.isNaN(occursAt.getTime())) return false;
  const millisecondsUntil = occursAt.getTime() - input.now.getTime();
  return millisecondsUntil >= 0 && millisecondsUntil <= 48 * 60 * 60 * 1_000;
}

export type MemoryDisposition = {
  saveDerivedMemory: boolean;
  purgeAt: string;
};

export function memoryDisposition(
  retention: MemoryRetention,
  taskCompletedAt: string,
): MemoryDisposition {
  const completedAt = new Date(taskCompletedAt);
  if (Number.isNaN(completedAt.getTime())) {
    throw new DomainError("VALIDATION_FAILED", "Task completion time is invalid");
  }
  if (retention.mode === "no_save") {
    return { saveDerivedMemory: false, purgeAt: completedAt.toISOString() };
  }
  completedAt.setUTCDate(completedAt.getUTCDate() + retention.retainForDays);
  return { saveDerivedMemory: true, purgeAt: completedAt.toISOString() };
}

export function canCompleteAction(
  category: TaskCategory,
  action: "reserve_free" | "cancel_with_fee" | "purchase" | "sign_terms",
  explicitlyConfirmed: boolean,
): boolean {
  if (!explicitlyConfirmed) return false;
  if (action === "reserve_free") {
    return !["property", "vehicle", "marketplace"].includes(category);
  }
  return false;
}

const DAY_BY_SHORT_NAME: Record<string, CallWindowDay> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  formatterCache.set(timeZone, formatter);
  return formatter;
}

function localWindowPosition(
  instant: Date,
  timeZone: string,
): { day: CallWindowDay; minuteOfDay: number } {
  const values = Object.fromEntries(
    formatterFor(timeZone)
      .formatToParts(instant)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  const day = values.weekday ? DAY_BY_SHORT_NAME[values.weekday] : undefined;
  const hour = Number(values.hour);
  const minute = Number(values.minute);
  if (!day || !Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new DomainError("VALIDATION_FAILED", "Could not evaluate the local call window");
  }
  return { day, minuteOfDay: hour * 60 + minute };
}

function minuteOfDay(value: string): number {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new DomainError("VALIDATION_FAILED", "Call window time is invalid");
  }
  return hour * 60 + minute;
}

export function isWithinLocalCallWindow(instant: Date, window: LocalCallWindow): boolean {
  const local = localWindowPosition(instant, window.timeZone);
  return (
    window.days.includes(local.day) &&
    local.minuteOfDay >= minuteOfDay(window.opensAt) &&
    local.minuteOfDay < minuteOfDay(window.closesAt)
  );
}

export function nextAllowedCallAt(from: Date, window: LocalCallWindow): string {
  const oneMinute = 60_000;
  const firstMinute = Math.ceil(from.getTime() / oneMinute) * oneMinute;
  const eightDaysLater = firstMinute + 8 * 24 * 60 * oneMinute;
  for (let timestamp = firstMinute; timestamp <= eightDaysLater; timestamp += oneMinute) {
    const candidate = new Date(timestamp);
    if (isWithinLocalCallWindow(candidate, window)) return candidate.toISOString();
  }
  throw new DomainError("VALIDATION_FAILED", "Call window has no reachable opening");
}

export type RetryDecision =
  | { kind: "stopped" }
  | { kind: "manual_confirmation_required" }
  | { kind: "limit_reached" }
  | {
      kind: "scheduled";
      scheduledAt: string;
      retryNumber: number;
      countdownMinutes: 5;
    };

export function planAutomaticRetry(input: {
  autonomy: AutonomySettings;
  callWindow: LocalCallWindow;
  automaticRetriesAlreadyMade: number;
  stopped: boolean;
  now: Date;
}): RetryDecision {
  if (input.stopped) return { kind: "stopped" };
  if (
    !input.autonomy.fullAccess ||
    !input.autonomy.automaticallyRetryUnavailableNumber
  ) {
    return { kind: "manual_confirmation_required" };
  }
  if (
    input.automaticRetriesAlreadyMade >=
    input.autonomy.maxAutomaticRetriesPerNumber
  ) {
    return { kind: "limit_reached" };
  }
  const retryAt = new Date(
    input.now.getTime() + input.autonomy.retryDelayMinutes * 60_000,
  );
  return {
    kind: "scheduled",
    scheduledAt: nextAllowedCallAt(retryAt, input.callWindow),
    retryNumber: input.automaticRetriesAlreadyMade + 1,
    countdownMinutes: 5,
  };
}

export function canAutomaticallyTryNextNumber(input: {
  autonomy: AutonomySettings;
  verified: boolean;
  alreadyTried: boolean;
  stopped: boolean;
}): boolean {
  return (
    !input.stopped &&
    input.autonomy.fullAccess &&
    input.autonomy.automaticallyTryNextVerifiedNumber &&
    input.verified &&
    !input.alreadyTried
  );
}
