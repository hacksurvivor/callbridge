import { randomUUID } from "node:crypto";

import { DomainError } from "./errors.js";
import type {
  AuthenticatedActor,
  CallTask,
  CallTaskDraft,
  CancellationTerms,
} from "./model.js";
import { isWithinLocalCallWindow, nextAllowedCallAt } from "./taskPolicy.js";
import { validateDraft, validateForConfirmation } from "./validation.js";

export type Clock = { now(): Date };
export type IdGenerator = { generate(): string };

export const systemClock: Clock = { now: () => new Date() };
export const uuidGenerator: IdGenerator = { generate: () => randomUUID() };

function assertOwner(task: CallTask, actor: AuthenticatedActor): void {
  if (task.ownerId !== actor.userId) {
    throw new DomainError("FORBIDDEN", "The call task belongs to another user");
  }
}

function assertExpectedRevision(task: CallTask, expectedRevision: number): void {
  if (task.revision !== expectedRevision) {
    throw new DomainError("STALE_REVISION", "The task has changed; reload before continuing");
  }
}

function validateCancellationTerms(terms: CancellationTerms): void {
  if (terms.knowledge === "unknown") return;
  if (!terms.source.trim() || Number.isNaN(new Date(terms.checkedAt).getTime())) {
    throw new DomainError("VALIDATION_FAILED", "Cancellation terms evidence is invalid");
  }
  if (
    terms.knowledge === "known_fee" &&
    (!Number.isSafeInteger(terms.fee.minorUnits) ||
      terms.fee.minorUnits <= 0 ||
      !/^[A-Z]{3}$/.test(terms.fee.currency))
  ) {
    throw new DomainError("VALIDATION_FAILED", "Cancellation fee is invalid");
  }
}

export function createCallTask(
  draftInput: unknown,
  actor: AuthenticatedActor,
  clock: Clock = systemClock,
  ids: IdGenerator = uuidGenerator,
): CallTask {
  const draft = validateDraft(draftInput) as CallTaskDraft;
  const timestamp = clock.now().toISOString();
  return {
    id: ids.generate(),
    ownerId: actor.userId,
    status: "draft",
    revision: 1,
    draft,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function updateCallTaskDraft(
  task: CallTask,
  replacementDraft: unknown,
  expectedRevision: number,
  actor: AuthenticatedActor,
  clock: Clock = systemClock,
): CallTask {
  assertOwner(task, actor);
  if (task.status !== "draft") {
    throw new DomainError("INVALID_TRANSITION", "Only a draft task can be edited");
  }
  assertExpectedRevision(task, expectedRevision);
  return {
    ...task,
    draft: validateDraft(replacementDraft) as CallTaskDraft,
    revision: task.revision + 1,
    updatedAt: clock.now().toISOString(),
  };
}

export function confirmCallTask(
  task: CallTask,
  expectedRevision: number,
  actor: AuthenticatedActor,
  clock: Clock = systemClock,
  options: { noSaveModeAcknowledged: boolean } = { noSaveModeAcknowledged: false },
): CallTask {
  assertOwner(task, actor);
  if (task.status !== "draft") {
    throw new DomainError("INVALID_TRANSITION", "Only a draft task can be confirmed");
  }
  assertExpectedRevision(task, expectedRevision);
  validateForConfirmation(task.draft);
  if (task.draft.memory.mode === "no_save" && !options.noSaveModeAcknowledged) {
    throw new DomainError(
      "VALIDATION_FAILED",
      "Confirm that this task will not be saved to memory after completion",
    );
  }
  const timestamp = clock.now().toISOString();
  const nextRevision = task.revision + 1;
  return {
    ...task,
    status: "confirmed",
    revision: nextRevision,
    confirmation: {
      confirmedAt: timestamp,
      confirmedByUserId: actor.userId,
      confirmedRevision: nextRevision,
      permissionScope: "gather_options_only",
      noSaveModeAcknowledged:
        task.draft.memory.mode === "no_save" && options.noSaveModeAcknowledged,
    },
    updatedAt: timestamp,
  };
}

export function beginOptionGathering(
  task: CallTask,
  actor: AuthenticatedActor,
  clock: Clock = systemClock,
): CallTask {
  assertOwner(task, actor);
  if (task.status !== "confirmed" || !task.confirmation) {
    throw new DomainError(
      "INVALID_TRANSITION",
      "Option gathering requires the user's explicit confirmation",
    );
  }
  if (
    task.confirmation.confirmedRevision !== task.revision ||
    task.confirmation.confirmedByUserId !== actor.userId ||
    task.confirmation.permissionScope !== "gather_options_only"
  ) {
    throw new DomainError("INVALID_TRANSITION", "The confirmation does not match this task revision");
  }
  if (
    task.draft.memory.mode === "no_save" &&
    !task.confirmation.noSaveModeAcknowledged
  ) {
    throw new DomainError("INVALID_TRANSITION", "No-save mode was not acknowledged");
  }
  const now = clock.now();
  if (!isWithinLocalCallWindow(now, task.draft.callWindow)) {
    throw new DomainError(
      "CALL_WINDOW_CLOSED",
      "The target is outside its local call window",
      [nextAllowedCallAt(now, task.draft.callWindow)],
    );
  }
  return {
    ...task,
    status: "gathering_options",
    revision: task.revision + 1,
    updatedAt: now.toISOString(),
  };
}

export function stopAutomaticRetries(
  task: CallTask,
  actor: AuthenticatedActor,
  clock: Clock = systemClock,
): CallTask {
  assertOwner(task, actor);
  if (task.retryControl) return task;
  const timestamp = clock.now().toISOString();
  return {
    ...task,
    revision: task.revision + 1,
    retryControl: {
      stoppedAt: timestamp,
      stoppedByUserId: actor.userId,
    },
    updatedAt: timestamp,
  };
}

/**
 * Records what is known about cancellation. This never performs the cancellation.
 * Unknown terms can only lead to an inquiry; known free or fee-bearing terms must
 * still be explicitly confirmed against the exact task revision.
 */
export function prepareCancellation(
  task: CallTask,
  terms: CancellationTerms,
  expectedRevision: number,
  actor: AuthenticatedActor,
  clock: Clock = systemClock,
): CallTask {
  assertOwner(task, actor);
  assertExpectedRevision(task, expectedRevision);
  if (task.status === "draft" || task.status === "cancelled") {
    throw new DomainError("INVALID_TRANSITION", "This task has no active arrangement to cancel");
  }
  validateCancellationTerms(terms);
  const timestamp = clock.now().toISOString();
  return {
    ...task,
    revision: task.revision + 1,
    cancellation: {
      state: terms.knowledge === "unknown" ? "terms_required" : "confirmation_required",
      requestedAt: timestamp,
      requestedByUserId: actor.userId,
      terms,
      ...(terms.knowledge === "unknown" ? {} : { termsDisclosedAt: timestamp }),
    },
    updatedAt: timestamp,
  };
}

export function confirmCancellation(
  task: CallTask,
  expectedRevision: number,
  actor: AuthenticatedActor,
  clock: Clock = systemClock,
): CallTask {
  assertOwner(task, actor);
  assertExpectedRevision(task, expectedRevision);
  const request = task.cancellation;
  if (
    !request ||
    request.state !== "confirmation_required" ||
    request.terms.knowledge === "unknown" ||
    !request.termsDisclosedAt
  ) {
    throw new DomainError(
      "INVALID_TRANSITION",
      "Known cancellation terms must be disclosed before explicit confirmation",
    );
  }
  const timestamp = clock.now().toISOString();
  const nextRevision = task.revision + 1;
  return {
    ...task,
    revision: nextRevision,
    cancellation: {
      ...request,
      state: "confirmed",
      confirmation: {
        confirmedAt: timestamp,
        confirmedByUserId: actor.userId,
        confirmedRevision: nextRevision,
        disclosedTerms: request.terms,
      },
    },
    updatedAt: timestamp,
  };
}

export function cancellationNextStep(
  task: CallTask,
): "not_requested" | "inquire_terms_only" | "await_confirmation" | "manual_execution_required" {
  if (!task.cancellation) return "not_requested";
  if (task.cancellation.state === "terms_required") return "inquire_terms_only";
  if (task.cancellation.state === "confirmation_required") return "await_confirmation";
  return "manual_execution_required";
}
