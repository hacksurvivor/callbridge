import { describe, expect, it } from "vitest";

import { DomainError } from "../src/domain/errors.js";
import {
  beginOptionGathering,
  cancellationNextStep,
  confirmCancellation,
  confirmCallTask,
  createCallTask,
  prepareCancellation,
  stopAutomaticRetries,
  updateCallTaskDraft,
} from "../src/domain/workflow.js";
import { actor, completeDraft } from "./fixtures.js";

const clock = { now: () => new Date("2026-08-11T12:00:00.000Z") };
const ids = { generate: () => "task_123" };

describe("call task workflow", () => {
  it("normalizes generic categories and all supported source forms", () => {
    const draft = completeDraft();
    draft.category = "restaurant";
    draft.title = "Ask for a dinner table";
    draft.details = { date: "2026-09-10", guests: 4, allergies: ["peanuts"] };
    const task = createCallTask(draft, actor, clock, ids);
    expect(task).toMatchObject({
      id: "task_123",
      ownerId: actor.userId,
      status: "draft",
      revision: 1,
      draft: {
        category: "restaurant",
        details: { guests: 4 },
      },
    });
    expect(task.draft.sources).toMatchObject({
      typedContext: expect.any(String),
      voiceNote: expect.objectContaining({ transcript: expect.any(String) }),
      transcript: expect.any(String),
      sourceUrl: expect.any(String),
      screenshot: expect.objectContaining({ extractedText: expect.any(String) }),
    });
  });

  it("requires at least one source", () => {
    const draft = completeDraft();
    draft.sources = {};
    expect(() => createCallTask(draft, actor, clock, ids)).toThrowError(DomainError);
  });

  it("supports revision-checked draft replacement", () => {
    const task = createCallTask(completeDraft(), actor, clock, ids);
    const replacement = completeDraft();
    replacement.questions = ["Do you have connecting rooms?"];
    const updated = updateCallTaskDraft(task, replacement, 1, actor, clock);
    expect(updated.revision).toBe(2);
    expect(updated.draft.questions).toEqual(["Do you have connecting rooms?"]);
    expect(() => updateCallTaskDraft(task, replacement, 0, actor, clock)).toThrowError(
      expect.objectContaining({ code: "STALE_REVISION" }),
    );
  });

  it("requires generic call fields and category-specific accommodation dates", () => {
    const draft = completeDraft();
    draft.target.contacts = [];
    delete draft.details.checkOut;
    draft.questions = [];
    const task = createCallTask(draft, actor, clock, ids);
    try {
      confirmCallTask(task, 1, actor, clock);
      throw new Error("Expected confirmation validation to fail");
    } catch (error) {
      expect(error).toMatchObject({
        code: "VALIDATION_FAILED",
        details: expect.arrayContaining([
          "at least one phone contact is required",
          "details.checkOut is required for accommodation",
          "at least one question is required",
        ]),
      });
    }
  });

  it("records explicit confirmation against the exact revision", () => {
    const task = createCallTask(completeDraft(), actor, clock, ids);
    const confirmed = confirmCallTask(task, 1, actor, clock);
    expect(confirmed.status).toBe("confirmed");
    expect(confirmed.revision).toBe(2);
    expect(confirmed.confirmation).toEqual({
      confirmedAt: "2026-08-11T12:00:00.000Z",
      confirmedByUserId: actor.userId,
      confirmedRevision: 2,
      permissionScope: "gather_options_only",
      noSaveModeAcknowledged: false,
    });
    expect(() => updateCallTaskDraft(confirmed, completeDraft(), 2, actor, clock)).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
  });

  it("requires acknowledgement of explicit no-save mode before a call", () => {
    const draft = completeDraft();
    draft.memory = { mode: "no_save" };
    const task = createCallTask(draft, actor, clock, ids);
    expect(() => confirmCallTask(task, 1, actor, clock)).toThrowError(
      expect.objectContaining({ code: "VALIDATION_FAILED" }),
    );
    const confirmed = confirmCallTask(task, 1, actor, clock, {
      noSaveModeAcknowledged: true,
    });
    expect(confirmed.confirmation?.noSaveModeAcknowledged).toBe(true);
  });

  it("models editable saved delivery instructions under task retention controls", () => {
    const draft = completeDraft();
    draft.category = "delivery";
    draft.title = "Help the courier find the entrance";
    draft.details = { orderReference: "ORDER-123" };
    draft.deliveryInstructions = {
      savedLocationId: "saved_location_home",
      leaveLocation: "Leave with the lobby desk",
      entryInstructions: "Use the side entrance after 18:00",
      intercom: "42",
      landmarks: "Blue awning beside the pharmacy",
      contactPreference: "call_recipient",
    };
    draft.memory = { mode: "no_save" };
    const task = createCallTask(draft, actor, clock, ids);
    const editedDraft = structuredClone(task.draft);
    if (!editedDraft.deliveryInstructions) throw new Error("Missing delivery instructions");
    editedDraft.deliveryInstructions.leaveLocation = "Leave at apartment 42";
    const edited = updateCallTaskDraft(task, editedDraft, task.revision, actor, clock);
    const confirmed = confirmCallTask(
      edited,
      edited.revision,
      actor,
      clock,
      { noSaveModeAcknowledged: true },
    );
    expect(confirmed.draft.deliveryInstructions).toMatchObject({
      savedLocationId: "saved_location_home",
      leaveLocation: "Leave at apartment 42",
      contactPreference: "call_recipient",
    });
  });

  it("never begins option gathering before confirmation or outside local hours", () => {
    const task = createCallTask(completeDraft(), actor, clock, ids);
    expect(() => beginOptionGathering(task, actor, clock)).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );

    const confirmed = confirmCallTask(task, 1, actor, clock);
    const closed = {
      ...confirmed,
      draft: {
        ...confirmed.draft,
        callWindow: {
          ...confirmed.draft.callWindow,
          opensAt: "09:00",
          closesAt: "18:00",
        },
      },
    };
    expect(() => beginOptionGathering(closed, actor, clock)).toThrowError(
      expect.objectContaining({
        code: "CALL_WINDOW_CLOSED",
        details: ["2026-08-12T02:00:00.000Z"],
      }),
    );
  });

  it("records a visible stop for all remaining automatic retries", () => {
    const task = createCallTask(completeDraft(), actor, clock, ids);
    const stopped = stopAutomaticRetries(task, actor, clock);
    expect(stopped.retryControl).toEqual({
      stoppedAt: "2026-08-11T12:00:00.000Z",
      stoppedByUserId: actor.userId,
    });
    expect(stopAutomaticRetries(stopped, actor, clock)).toBe(stopped);
  });

  it("only inquires when cancellation terms are unknown", () => {
    const task = confirmCallTask(
      createCallTask(completeDraft(), actor, clock, ids),
      1,
      actor,
      clock,
    );
    const prepared = prepareCancellation(
      task,
      { knowledge: "unknown" },
      task.revision,
      actor,
      clock,
    );
    expect(cancellationNextStep(prepared)).toBe("inquire_terms_only");
    expect(() => confirmCancellation(prepared, prepared.revision, actor, clock)).toThrowError(
      expect.objectContaining({ code: "INVALID_TRANSITION" }),
    );
    expect(prepared.status).toBe("confirmed");
  });

  it("discloses an exact known fee and binds confirmation to that revision", () => {
    const task = confirmCallTask(
      createCallTask(completeDraft(), actor, clock, ids),
      1,
      actor,
      clock,
    );
    const prepared = prepareCancellation(
      task,
      {
        knowledge: "known_fee",
        fee: { minorUnits: 10_000, currency: "USD" },
        checkedAt: "2026-08-11T11:55:00.000Z",
        source: "Hotel cancellation policy",
      },
      task.revision,
      actor,
      clock,
    );
    expect(prepared.cancellation).toMatchObject({
      state: "confirmation_required",
      termsDisclosedAt: "2026-08-11T12:00:00.000Z",
      terms: {
        knowledge: "known_fee",
        fee: { minorUnits: 10_000, currency: "USD" },
      },
    });

    const approved = confirmCancellation(
      prepared,
      prepared.revision,
      actor,
      clock,
    );
    expect(approved.cancellation?.confirmation).toMatchObject({
      confirmedRevision: approved.revision,
      disclosedTerms: {
        knowledge: "known_fee",
        fee: { minorUnits: 10_000, currency: "USD" },
      },
    });
    expect(cancellationNextStep(approved)).toBe("manual_execution_required");
    expect(approved.status).not.toBe("cancelled");
  });

  it("rejects booking, payment, terms, cancellation, or irreversible permissions", () => {
    for (const forbiddenField of [
      "mayBook",
      "mayPay",
      "mayAcceptTerms",
      "mayMakeIrreversibleCommitment",
      "mayCancel",
    ]) {
      const draft = completeDraft() as unknown as Record<string, unknown>;
      draft.permissions = {
        ...completeDraft().permissions,
        [forbiddenField]: true,
      };
      expect(() => createCallTask(draft, actor, clock, ids)).toThrowError(
        expect.objectContaining({ code: "VALIDATION_FAILED" }),
      );
    }
  });
});
