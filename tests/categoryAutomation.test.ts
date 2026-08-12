import { describe, expect, it } from "vitest";
import { mayNotifyAboutFinding, maySearchInBackground } from "../src/domain/categoryAutomation.js";

describe("category automation preferences", () => {
  it("keeps background research independent from notification delivery", () => {
    const preference = { category: "marketplace" as const, backgroundSearchEnabled: true, notificationsEnabled: false };
    expect(maySearchInBackground(preference)).toBe(true);
    expect(mayNotifyAboutFinding(preference)).toBe(false);
  });
  it("fails closed when no preference exists", () => {
    expect(maySearchInBackground(undefined)).toBe(false);
    expect(mayNotifyAboutFinding(undefined)).toBe(false);
  });
});
