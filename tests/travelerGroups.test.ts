import { describe, expect, it } from "vitest";
import { taskDetailsFromTravelerGroup, validateTravelerGroup } from "../src/domain/travelerGroups.js";

describe("traveler groups", () => {
  const family = { name: "Family", adults: 4, children: 2, infants: 1, pets: 0, requirements: [
    { label: "Accessible room", disclosure: "always" as const },
    { label: "Quiet floor", disclosure: "only_when_relevant" as const },
  ] };
  it("creates a task snapshot with mandatory and contextual requirements separated", () => {
    expect(taskDetailsFromTravelerGroup(family)).toMatchObject({ adults: 4, children: 2, infants: 1, required_traveler_requirements: ["Accessible room"], contextual_traveler_preferences: ["Quiet floor"] });
  });
  it("rejects an empty group", () => {
    expect(() => validateTravelerGroup({ ...family, adults: 0, children: 0, infants: 0 })).toThrow("at least one");
  });
});
