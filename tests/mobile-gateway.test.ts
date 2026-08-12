import { describe, expect, it } from "vitest";

import { buildDraftFromRequest, isRemoteTaskSyncEnabled } from "../mobile/src/convex-task-gateway.js";

describe("mobile Convex task gateway", () => {
  it("builds a valid safe-by-default accommodation draft", () => {
    const draft = buildDraftFromRequest("Find a hotel room for my family");

    expect(draft.category).toBe("accommodation");
    expect(draft.sources).toEqual({ typedContext: "Find a hotel room for my family" });
    expect(draft.permissions).toMatchObject({
      scope: "gather_options_only",
      mayBook: false,
      mayPay: false,
      mayAcceptTerms: false,
      mayMakeIrreversibleCommitment: false,
      mayCancel: false,
    });
    expect(draft.autonomy.fullAccess).toBe(false);
    expect(draft.memory).toEqual({ mode: "save_for_30_days", retainForDays: 30 });
  });

  it("routes a courier request to the delivery category", () => {
    expect(buildDraftFromRequest("Tell my courier where to leave the delivery").category).toBe("delivery");
  });

  it("requires an explicit runtime switch before remote writes are possible", () => {
    expect(isRemoteTaskSyncEnabled).toBe(false);
  });
});
