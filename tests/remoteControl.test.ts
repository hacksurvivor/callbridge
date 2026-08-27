import { describe, expect, it } from "vitest";

import {
  constantTimeEqualHex,
  normalizeRemoteInstruction,
  validateRemoteClientRequestId,
  validateRemoteHostId,
  validateRemoteSecretHash,
} from "../src/domain/remoteControl.js";

describe("remote control boundary", () => {
  it("accepts normalized host credentials and request identifiers", () => {
    expect(validateRemoteHostId("550E8400-E29B-41D4-A716-446655440000")).toBe("550e8400-e29b-41d4-a716-446655440000");
    expect(validateRemoteSecretHash("A".repeat(64))).toBe("a".repeat(64));
    expect(validateRemoteClientRequestId("ios:request-1234")).toBe("ios:request-1234");
  });

  it("rejects malformed capability material", () => {
    expect(() => validateRemoteHostId("my-mac")).toThrow("UUID");
    expect(() => validateRemoteSecretHash("secret")).toThrow("invalid");
    expect(() => validateRemoteClientRequestId("short")).toThrow("invalid");
  });

  it("requires text only for agent tasks", () => {
    expect(normalizeRemoteInstruction("agent_task", "  inspect the project  ")).toBe("inspect the project");
    expect(() => normalizeRemoteInstruction("agent_task", " ")).toThrow("requires an instruction");
    expect(normalizeRemoteInstruction("status", "ignored")).toBeUndefined();
  });

  it("compares capability hashes without an early mismatch return", () => {
    expect(constantTimeEqualHex("ab12", "AB12")).toBe(true);
    expect(constantTimeEqualHex("ab12", "ab13")).toBe(false);
    expect(constantTimeEqualHex("ab12", "ab1200")).toBe(false);
  });
});
