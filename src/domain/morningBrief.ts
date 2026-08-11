import { DomainError } from "./errors.js";
import type { TaskActivityEvent } from "./activityEvents.js";

export type BriefActivity = TaskActivityEvent & {
  taskId: string;
  taskTitle: string;
};

export type BriefCommitment = {
  taskId: string;
  taskTitle: string;
  important: boolean;
  occursAt: string;
  summary: string;
};

export type MorningBrief = {
  generatedAt: string;
  items: Array<
    | { kind: "update"; taskId: string; taskTitle: string; summary: string; occurredAt: string }
    | { kind: "today"; taskId: string; taskTitle: string; summary: string; occursAt: string }
  >;
};

function localDate(instant: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(instant);
    const values = Object.fromEntries(
      parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
    );
    if (!values.year || !values.month || !values.day) throw new Error("invalid");
    return `${values.year}-${values.month}-${values.day}`;
  } catch {
    throw new DomainError("VALIDATION_FAILED", "Morning brief requires a valid IANA time zone");
  }
}

/**
 * Pure, provider-neutral brief construction. A scheduler may deliver the
 * result at the user's selected time, but a null result means no notification.
 */
export function buildMorningBrief(input: {
  now: Date;
  timeZone: string;
  since: Date;
  activity: readonly BriefActivity[];
  commitments: readonly BriefCommitment[];
}): MorningBrief | null {
  if (Number.isNaN(input.now.getTime()) || Number.isNaN(input.since.getTime())) {
    throw new DomainError("VALIDATION_FAILED", "Morning brief times are invalid");
  }
  const today = localDate(input.now, input.timeZone);
  const updates = input.activity
    .filter((event) => {
      const occurredAt = new Date(event.occurredAt);
      return !Number.isNaN(occurredAt.getTime()) && occurredAt > input.since && occurredAt <= input.now;
    })
    .map(({ taskId, taskTitle, summary, occurredAt }) => ({
      kind: "update" as const,
      taskId,
      taskTitle,
      summary,
      occurredAt,
    }));
  const todayItems = input.commitments
    .filter((commitment) => {
      const occursAt = new Date(commitment.occursAt);
      return (
        commitment.important &&
        !Number.isNaN(occursAt.getTime()) &&
        localDate(occursAt, input.timeZone) === today
      );
    })
    .map(({ taskId, taskTitle, summary, occursAt }) => ({
      kind: "today" as const,
      taskId,
      taskTitle,
      summary,
      occursAt,
    }));
  const items = [...updates, ...todayItems];
  if (items.length === 0) return null;
  return { generatedAt: input.now.toISOString(), items };
}
