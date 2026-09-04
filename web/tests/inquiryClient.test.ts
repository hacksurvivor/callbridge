import { describe, expect, it } from "vitest";

import {
  readTaskIdFromLocation,
  selectAutomaticRestoreTaskId,
} from "../src/convex/inquiryClient.js";

describe("readTaskIdFromLocation", () => {
  it("is safe during server rendering", () => {
    expect(readTaskIdFromLocation()).toBeNull();
  });

  it("reads a plausible task id from an explicit location", () => {
    const location = { href: "https://callbridge.example/?task=q972cstept9hrb333" } as Location;
    expect(readTaskIdFromLocation(location)).toBe("q972cstept9hrb333");
  });
});

describe("selectAutomaticRestoreTaskId", () => {
  it("selects the newest valid task when the URL has no task pointer", () => {
    expect(selectAutomaticRestoreTaskId([
      "newest-task-123",
      "older-task-456",
    ], null)).toBe("newest-task-123");
  });

  it("never replaces an explicit task pointer", () => {
    expect(selectAutomaticRestoreTaskId([
      "newest-task-123",
    ], "requested-task-789")).toBeNull();
  });

  it("ignores invalid history entries", () => {
    expect(selectAutomaticRestoreTaskId(["bad id", "valid-task-123"], null)).toBe("valid-task-123");
  });
});
