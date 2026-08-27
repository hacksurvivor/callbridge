import { describe, expect, it } from "vitest";

import { buildAgentInstructions, escapeXml, verifiedDestination } from "../src/policy";

describe("telephony worker policy", () => {
  it("accepts only a verified E.164 destination", () => {
    expect(verifiedDestination([{ kind: "phone", value: "+66812345678", verified: true }])).toBe("+66812345678");
    expect(() => verifiedDestination([{ kind: "phone", value: "0812345678", verified: true }])).toThrow("E.164");
    expect(() => verifiedDestination([{ kind: "phone", value: "+66812345678", verified: false }])).toThrow("verified");
  });

  it("escapes values embedded in TwiML", () => {
    expect(escapeXml('a&<b>"c"')).toBe("a&amp;&lt;b&gt;&quot;c&quot;");
  });

  it("structurally states the inquiry-only boundary", () => {
    const prompt = buildAgentInstructions({ title: "Check a room", questions: ["Total price?"], callLanguage: "th-TH" });
    expect(prompt).toContain("AI assistant");
    expect(prompt).toContain("transcribed");
    expect(prompt).toContain("Never book, buy, pay, accept terms, cancel");
  });
});
