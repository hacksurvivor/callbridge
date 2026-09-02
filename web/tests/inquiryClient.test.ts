import { describe, expect, it } from "vitest";

import { readTaskIdFromLocation } from "../src/convex/inquiryClient.js";

describe("readTaskIdFromLocation", () => {
  it("is safe during server rendering", () => {
    expect(readTaskIdFromLocation()).toBeNull();
  });

  it("reads a plausible task id from an explicit location", () => {
    const location = { href: "https://callbridge.example/?task=q972cstept9hrb333" } as Location;
    expect(readTaskIdFromLocation(location)).toBe("q972cstept9hrb333");
  });
});
