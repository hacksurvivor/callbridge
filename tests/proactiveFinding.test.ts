import { describe, expect, it } from "vitest";
import { canActOnFinding, validateProactiveFinding } from "../src/domain/proactiveFinding.js";

describe("proactive findings", () => {
  it("cannot be acted on before explicit approval", () => {
    expect(canActOnFinding("proposed")).toBe(false);
    expect(canActOnFinding("approved")).toBe(true);
  });
  it("requires factual summary and source", () => {
    expect(() => validateProactiveFinding({ summary: "", source: "site" })).toThrow("summary and source");
  });
});
