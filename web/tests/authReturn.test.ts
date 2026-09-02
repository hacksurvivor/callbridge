import { describe, expect, it } from "vitest";

import { validatedAuthReturnPath } from "../src/authReturn.js";

describe("CallBridge authentication return path", () => {
  const origin = "https://callbridge-web.pages.dev";

  it("restores an owned task pointer after authentication", () => {
    expect(validatedAuthReturnPath({ returnTo: "/callback?task=q972cstept9hrb333ezr10zz1x8dnv5v" }, origin)).toBe(
      "/callback?task=q972cstept9hrb333ezr10zz1x8dnv5v",
    );
  });

  it("allows the callback home without inventing a task", () => {
    expect(validatedAuthReturnPath({ returnTo: "/callback" }, origin)).toBe("/callback");
  });

  it("rejects cross-origin and malformed task return paths", () => {
    expect(validatedAuthReturnPath({ returnTo: "https://example.com/callback?task=q972cstept9hrb333ezr10zz1x8dnv5v" }, origin)).toBeNull();
    expect(validatedAuthReturnPath({ returnTo: "/callback?task=not valid" }, origin)).toBeNull();
  });
});
