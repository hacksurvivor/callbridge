import { describe, expect, it } from "vitest";

import {
  canPerformSharedTaskAction,
  FRIENDLY_PERMISSION_LABELS,
  redactDraftForShare,
  sharedAccessNeverGrantsCommitmentAuthority,
} from "../src/domain/sharing.js";
import { completeDraft } from "./fixtures.js";

describe("friendly household and task sharing", () => {
  it("uses friendly permission labels rather than technical roles", () => {
    expect(FRIENDLY_PERMISSION_LABELS).toEqual({
      manage_everything: "Can manage everything",
      help_with_tasks: "Can help with tasks",
      view_updates: "Can only view updates",
    });
  });

  it("maps each friendly level to a strict capability set", () => {
    expect(canPerformSharedTaskAction("manage_everything", "share")).toBe(true);
    expect(canPerformSharedTaskAction("help_with_tasks", "confirm")).toBe(true);
    expect(canPerformSharedTaskAction("help_with_tasks", "share")).toBe(false);
    expect(canPerformSharedTaskAction("view_updates", "view")).toBe(true);
    expect(canPerformSharedTaskAction("view_updates", "edit")).toBe(false);
  });

  it("shares transcripts by default but can redact every transcript source", () => {
    const draft = completeDraft();
    expect(redactDraftForShare(draft, true).sources.transcript).toBe(
      "Typed transcript correction.",
    );
    const redacted = redactDraftForShare(draft, false);
    expect(redacted.sources.transcript).toBeUndefined();
    expect(redacted.sources.voiceNote?.transcript).toBeUndefined();
    expect(redacted.sources.screenshot?.extractedText).toBeUndefined();
    expect(redacted.sources.typedContext).toBe(draft.sources.typedContext);
  });

  it("never maps household permissions to financial or legal authority", () => {
    expect(sharedAccessNeverGrantsCommitmentAuthority()).toBe(true);
  });
});
