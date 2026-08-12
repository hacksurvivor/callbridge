import { describe, expect, it } from "vitest";

import { LocalTaskStore } from "../mobile/src/task-store.js";

describe("mobile local task store", () => {
  it("never represents a local preview as a completed external call", () => {
    const store = new LocalTaskStore();
    store.createDraft("Find a hotel room");
    const confirmed = store.confirmCurrent();

    expect(confirmed.activity.map((event) => event.title)).toEqual([
      "Draft confirmed",
      "Waiting for a live calling connection",
    ]);
    expect(confirmed.activity.flatMap((event) => [event.title, event.detail]).join(" ")).not.toMatch(/answered|final price/i);
  });
});
