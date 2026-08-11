import { DomainError } from "./errors.js";

export type QuietHours = {
  timeZone: string;
  startsAt: string;
  endsAt: string;
};

export const DEFAULT_QUIET_HOURS: Omit<QuietHours, "timeZone"> = Object.freeze({
  startsAt: "22:00",
  endsAt: "08:00",
});

export type QuietHoursOverrideReason =
  | "active_call_waiting_for_user"
  | "offer_expiring_soon";

export type NotificationDecision =
  | { kind: "send_now"; reason: "outside_quiet_hours" | QuietHoursOverrideReason }
  | { kind: "queue_until"; deliverAt: string };

function parseTime(value: string): number {
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new DomainError("VALIDATION_FAILED", "Quiet-hours time is invalid");
  }
  const [hour = NaN, minute = NaN] = value.split(":").map(Number);
  return hour * 60 + minute;
}

function localParts(instant: Date, timeZone: string): {
  year: number;
  month: number;
  day: number;
  minuteOfDay: number;
} {
  try {
    const values = Object.fromEntries(
      new Intl.DateTimeFormat("en-US", {
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
    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    const hour = Number(values.hour);
    const minute = Number(values.minute);
    if (![year, month, day, hour, minute].every(Number.isInteger)) throw new Error("invalid");
    return { year, month, day, minuteOfDay: hour * 60 + minute };
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Quiet hours require a valid IANA time zone");
  }
}

function isQuietMinute(minuteOfDay: number, startsAt: string, endsAt: string): boolean {
  const start = parseTime(startsAt);
  const end = parseTime(endsAt);
  if (start === end) throw new DomainError("VALIDATION_FAILED", "Quiet hours must have a duration");
  return start < end
    ? minuteOfDay >= start && minuteOfDay < end
    : minuteOfDay >= start || minuteOfDay < end;
}

function localDatePlusDays(local: { year: number; month: number; day: number }, days: number): string {
  return new Date(Date.UTC(local.year, local.month - 1, local.day + days)).toISOString().slice(0, 10);
}

/**
 * Returns a local date-time label rather than guessing an instant across DST.
 * The notification scheduler converts this user-visible local target to an
 * actual delivery instant using its time-zone-aware queue provider.
 */
function nextQuietHoursEndLabel(now: Date, quietHours: QuietHours): string {
  const local = localParts(now, quietHours.timeZone);
  const end = parseTime(quietHours.endsAt);
  const endHour = String(Math.floor(end / 60)).padStart(2, "0");
  const endMinute = String(end % 60).padStart(2, "0");
  const endsToday = local.minuteOfDay < end;
  const date = localDatePlusDays(local, endsToday ? 0 : 1);
  return `${date}T${endHour}:${endMinute}:00[${quietHours.timeZone}]`;
}

export function decideNotificationDelivery(input: {
  now: Date;
  quietHours: QuietHours;
  overrideReason?: QuietHoursOverrideReason;
}): NotificationDecision {
  const local = localParts(input.now, input.quietHours.timeZone);
  if (!isQuietMinute(local.minuteOfDay, input.quietHours.startsAt, input.quietHours.endsAt)) {
    return { kind: "send_now", reason: "outside_quiet_hours" };
  }
  if (input.overrideReason) {
    return { kind: "send_now", reason: input.overrideReason };
  }
  return {
    kind: "queue_until",
    deliverAt: nextQuietHoursEndLabel(input.now, input.quietHours),
  };
}
