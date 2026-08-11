import { describe, expect, it } from "vitest";

import { resolveNextWeekend } from "../src/domain/dateResolution.js";
import { DomainError } from "../src/domain/errors.js";
import { validateForConfirmation } from "../src/domain/validation.js";
import { completeDraft } from "./fixtures.js";

describe("date resolution guardrails", () => {
  it("resolves next weekend from the declared user time zone, not the server locale", () => {
    expect(
      resolveNextWeekend({
        referenceInstant: "2026-08-10T23:30:00.000Z",
        referenceTimeZone: "Asia/Bangkok",
        timeZoneSource: "device",
        resolvedAt: "2026-08-10T23:30:00.000Z",
      }),
    ).toMatchObject({
      checkIn: "2026-08-14",
      checkOut: "2026-08-16",
      referenceTimeZone: "Asia/Bangkok",
      timeZoneSource: "device",
    });
  });

  it("fails confirmation when accommodation dates have no traceable resolution", () => {
    const draft = completeDraft();
    delete draft.dateResolution;
    try {
      validateForConfirmation(draft);
      throw new Error("Expected confirmation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).details).toContain("dateResolution is required for accommodation");
    }
  });

  it("fails confirmation when a relative resolution is inconsistent with its time-zone basis", () => {
    const draft = completeDraft();
    draft.dateResolution = {
      source: "relative",
      expression: "next_weekend",
      referenceInstant: "2026-08-10T23:30:00.000Z",
      referenceTimeZone: "Asia/Bangkok",
      timeZoneSource: "device",
      resolvedAt: "2026-08-10T23:30:00.000Z",
      checkIn: "2026-08-21",
      checkOut: "2026-08-23",
    };
    draft.details.checkIn = "2026-08-21";
    draft.details.checkOut = "2026-08-23";
    try {
      validateForConfirmation(draft);
      throw new Error("Expected confirmation to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(DomainError);
      expect((error as DomainError).details).toContain(
        "Relative dates do not match the deterministic time-zone resolution",
      );
    }
  });
});
