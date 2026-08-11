import { describe, expect, it } from "vitest";

import { validateTaskActivityEvent } from "../src/domain/activityEvents.js";

describe("task activity events", () => {
  it("accepts factual public agent updates", () => {
    expect(
      validateTaskActivityEvent({
        kind: "contact_answered",
        summary: "The hotel answered and is checking availability.",
        actionLabel: "Checking availability",
        source: "agent",
        occurredAt: "2026-08-11T10:00:00.000Z",
      }),
    ).toMatchObject({ kind: "contact_answered" });
  });

  it("rejects an unstructured or oversized timeline event", () => {
    expect(() =>
      validateTaskActivityEvent({
        kind: "lookup",
        summary: " ",
        source: "agent",
        occurredAt: "not-a-date",
      }),
    ).toThrow(/Task activity event is invalid/);
  });
});
