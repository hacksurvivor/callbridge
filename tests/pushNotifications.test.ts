import { describe, expect, it } from "vitest";

import { validateExpoPushToken } from "../src/domain/pushNotifications.js";

describe("push notification tokens", () => {
  it("accepts Expo token formats and trims whitespace", () => {
    expect(validateExpoPushToken(" ExpoPushToken[abcdefghijklmnop] ")).toBe("ExpoPushToken[abcdefghijklmnop]");
    expect(validateExpoPushToken("ExponentPushToken[abcdefghijklmnop]")).toContain("ExponentPushToken");
  });

  it("rejects arbitrary endpoints and short tokens", () => {
    expect(() => validateExpoPushToken("https://example.com/collect")).toThrow("invalid");
    expect(() => validateExpoPushToken("ExpoPushToken[x]")).toThrow("invalid");
  });
});
