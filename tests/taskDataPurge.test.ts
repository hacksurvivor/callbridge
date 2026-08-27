import { describe, expect, it } from "vitest";

import { purgeTaskDraft } from "../src/domain/taskDataPurge.js";
import { completeDraft } from "./fixtures.js";

describe("task data purge", () => {
  it("removes raw request, contacts, dates, notes and sensitive delivery data", () => {
    const draft = completeDraft();
    const purged = purgeTaskDraft({
      ...draft,
      sources: { typedContext: "secret request", transcript: "secret transcript" },
      target: { name: "Private Hotel", contacts: [{ kind: "phone", value: "+66123", verified: true }], address: "Secret address" },
      notes: "private note",
      deliveryInstructions: { entryInstructions: "door code", intercom: "1234", contactPreference: "no_contact" },
    });
    const serialized = JSON.stringify(purged);
    expect(purged.title).toBe("Deleted task");
    expect(purged.sources).toEqual({ typedContext: "[deleted]" });
    expect(purged.target).toEqual({ contacts: [] });
    expect(serialized).not.toMatch(/secret|private|door code|1234|\+66123/i);
    expect(purged.permissions).toEqual(draft.permissions);
  });
});
