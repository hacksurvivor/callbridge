import { z } from "zod";

import { DomainError } from "./errors.js";

export const TASK_ACTIVITY_KINDS = [
  "task_started",
  "lookup",
  "contact_attempt",
  "contact_answered",
  "offer_found",
  "decision_required",
  "task_completed",
  "task_paused",
  "task_stopped",
  "warning",
] as const;

export type TaskActivityKind = (typeof TASK_ACTIVITY_KINDS)[number];

/** Public, factual timeline data. It deliberately contains no model reasoning. */
export type TaskActivityEvent = {
  kind: TaskActivityKind;
  summary: string;
  actionLabel?: string;
  source: "agent" | "system" | "user";
  occurredAt: string;
};

const activityEventSchema = z.object({
  kind: z.enum(TASK_ACTIVITY_KINDS),
  summary: z.string().trim().min(1).max(500),
  actionLabel: z.string().trim().min(1).max(120).optional(),
  source: z.enum(["agent", "system", "user"]),
  occurredAt: z.string().datetime({ offset: true }),
});

export function validateTaskActivityEvent(value: unknown): TaskActivityEvent {
  const result = activityEventSchema.safeParse(value);
  if (!result.success) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Task activity event is invalid",
      result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
    );
  }
  const { actionLabel, ...event } = result.data;
  return actionLabel === undefined ? event : { ...event, actionLabel };
}
