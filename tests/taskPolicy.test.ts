import { describe, expect, it } from "vitest";

import {
  canAutomaticallyTryNextNumber,
  canCompleteAction,
  canRunProactiveFollowUp,
  memoryDisposition,
  planAutomaticRetry,
  shouldMonitorConfirmedCommitment,
} from "../src/domain/taskPolicy.js";
import { completeDraft } from "./fixtures.js";

describe("task policy", () => {
  it("purges no-save task memory when the task completes", () => {
    expect(
      memoryDisposition({ mode: "no_save" }, "2026-08-01T00:00:00.000Z"),
    ).toEqual({
      saveDerivedMemory: false,
      purgeAt: "2026-08-01T00:00:00.000Z",
    });
  });

  it("keeps saved task context for exactly 30 days after completion", () => {
    expect(
      memoryDisposition(
        { mode: "save_for_30_days", retainForDays: 30 },
        "2026-08-01T00:00:00.000Z",
      ),
    ).toEqual({
      saveDerivedMemory: true,
      purgeAt: "2026-08-31T00:00:00.000Z",
    });
  });

  it("only permits explicitly confirmed free reversible reservations", () => {
    expect(canCompleteAction("restaurant", "reserve_free", true)).toBe(true);
    expect(canCompleteAction("property", "reserve_free", true)).toBe(false);
    expect(canCompleteAction("restaurant", "cancel_with_fee", true)).toBe(false);
    expect(canCompleteAction("restaurant", "purchase", true)).toBe(false);
    expect(canCompleteAction("restaurant", "sign_terms", true)).toBe(false);
  });

  it("requires Full Access for an automatic retry", () => {
    const draft = completeDraft();
    expect(
      planAutomaticRetry({
        autonomy: draft.autonomy,
        callWindow: draft.callWindow,
        automaticRetriesAlreadyMade: 0,
        stopped: false,
        now: new Date("2026-08-11T10:00:00.000Z"),
      }),
    ).toEqual({ kind: "manual_confirmation_required" });
  });

  it("limits Full Access to two automatic five-minute retries per number", () => {
    const draft = completeDraft();
    const autonomy = {
      ...draft.autonomy,
      fullAccess: true,
      automaticallyRetryUnavailableNumber: true,
    };
    expect(
      planAutomaticRetry({
        autonomy,
        callWindow: draft.callWindow,
        automaticRetriesAlreadyMade: 1,
        stopped: false,
        now: new Date("2026-08-11T10:00:00.000Z"),
      }),
    ).toEqual({
      kind: "scheduled",
      scheduledAt: "2026-08-11T10:05:00.000Z",
      retryNumber: 2,
      countdownMinutes: 5,
    });
    expect(
      planAutomaticRetry({
        autonomy,
        callWindow: draft.callWindow,
        automaticRetriesAlreadyMade: 2,
        stopped: false,
        now: new Date("2026-08-11T10:00:00.000Z"),
      }),
    ).toEqual({ kind: "limit_reached" });
  });

  it("moves a retry to the target's next local opening", () => {
    const draft = completeDraft();
    const autonomy = {
      ...draft.autonomy,
      fullAccess: true,
      automaticallyRetryUnavailableNumber: true,
    };
    const callWindow = {
      ...draft.callWindow,
      opensAt: "09:00",
      closesAt: "18:00",
    };
    expect(
      planAutomaticRetry({
        autonomy,
        callWindow,
        automaticRetriesAlreadyMade: 0,
        stopped: false,
        now: new Date("2026-08-11T10:55:00.000Z"),
      }),
    ).toEqual({
      kind: "scheduled",
      scheduledAt: "2026-08-12T02:00:00.000Z",
      retryNumber: 1,
      countdownMinutes: 5,
    });
  });

  it("honors the user's stop control and only advances to verified numbers", () => {
    const draft = completeDraft();
    const autonomy = {
      ...draft.autonomy,
      fullAccess: true,
      automaticallyTryNextVerifiedNumber: true,
      automaticallyRetryUnavailableNumber: true,
    };
    expect(
      planAutomaticRetry({
        autonomy,
        callWindow: draft.callWindow,
        automaticRetriesAlreadyMade: 0,
        stopped: true,
        now: new Date("2026-08-11T10:00:00.000Z"),
      }),
    ).toEqual({ kind: "stopped" });
    expect(
      canAutomaticallyTryNextNumber({
        autonomy,
        verified: true,
        alreadyTried: false,
        stopped: false,
      }),
    ).toBe(true);
    expect(
      canAutomaticallyTryNextNumber({
        autonomy,
        verified: false,
        alreadyTried: false,
        stopped: false,
      }),
    ).toBe(false);
  });

  it("requires a time-bounded Full Access authorization for proactive follow-up", () => {
    const draft = completeDraft();
    const now = new Date("2026-08-11T10:00:00.000Z");
    expect(canRunProactiveFollowUp({ autonomy: draft.autonomy, now })).toBe(false);
    const authorized = {
      ...draft.autonomy,
      fullAccess: true,
      proactiveFollowUp: {
        goal: "Check the hotel for a quiet room",
        expiresAt: "2026-08-11T22:00:00.000Z",
      },
    };
    expect(canRunProactiveFollowUp({ autonomy: authorized, now })).toBe(true);
    expect(
      canRunProactiveFollowUp({
        autonomy: authorized,
        now: new Date("2026-08-11T22:00:00.000Z"),
      }),
    ).toBe(false);
  });

  it("monitors only important or soon confirmed commitments", () => {
    const now = new Date("2026-08-11T10:00:00.000Z");
    expect(
      shouldMonitorConfirmedCommitment({
        confirmed: true,
        important: false,
        occursAt: "2026-08-13T09:00:00.000Z",
        now,
      }),
    ).toBe(true);
    expect(
      shouldMonitorConfirmedCommitment({
        confirmed: true,
        important: false,
        occursAt: "2026-08-13T11:00:01.000Z",
        now,
      }),
    ).toBe(false);
    expect(
      shouldMonitorConfirmedCommitment({ confirmed: true, important: true, now }),
    ).toBe(true);
    expect(
      shouldMonitorConfirmedCommitment({ confirmed: false, important: true, now }),
    ).toBe(false);
  });
});
