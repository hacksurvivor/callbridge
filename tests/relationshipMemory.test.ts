import { describe, expect, it } from "vitest";

import { validateRelationshipMemory } from "../src/domain/relationshipMemory.js";

describe("relationship memory", () => {
  it("defaults each place card to owner-only control", () => {
    expect(
      validateRelationshipMemory({
        category: "accommodation",
        placeName: "Hotel Example",
        summary: "Quiet rooms and helpful late check-in.",
        facts: ["Stayed in September 2026", "Prefers quiet rooms"],
        lastRelevantDate: "2026-09-13",
        mayUseInCalls: true,
        visibility: "owner_only",
      }),
    ).toMatchObject({ visibility: "owner_only", mayUseInCalls: true });
  });

  it("rejects unbounded private notes", () => {
    expect(() =>
      validateRelationshipMemory({
        category: "accommodation",
        placeName: "Hotel Example",
        summary: " ",
        facts: [],
        mayUseInCalls: false,
        visibility: "owner_only",
      }),
    ).toThrow(/Relationship memory is invalid/);
  });
});
