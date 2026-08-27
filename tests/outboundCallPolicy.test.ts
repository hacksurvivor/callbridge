import { describe, expect, it } from "vitest";

import { assertOutboundCallPolicy } from "../src/domain/outboundCallPolicy.js";

const approved = {
  CALLBRIDGE_APPROVED_CALL_COUNTRIES: "TH,CZ",
  CALLBRIDGE_CALL_POLICY_VERSION: "legal-review-2026-08",
  CALLBRIDGE_TRANSCRIPTION_DISCLOSURE: "required_before_conversation",
  CALLBRIDGE_TRANSCRIPT_RETENTION_DAYS: "30",
};

describe("outbound call policy", () => {
  it("allows only an explicitly approved destination and policy", () => {
    expect(() => assertOutboundCallPolicy({ countryCode: "TH", env: approved })).not.toThrow();
  });

  it("blocks missing and unapproved destinations", () => {
    expect(() => assertOutboundCallPolicy({ env: approved })).toThrow("destination country");
    expect(() => assertOutboundCallPolicy({ countryCode: "US", env: approved })).toThrow("not approved");
  });

  it("requires disclosure and bounded retention", () => {
    expect(() => assertOutboundCallPolicy({
      countryCode: "TH",
      env: { ...approved, CALLBRIDGE_TRANSCRIPTION_DISCLOSURE: "optional" },
    })).toThrow("disclosure");
    expect(() => assertOutboundCallPolicy({
      countryCode: "TH",
      env: { ...approved, CALLBRIDGE_TRANSCRIPT_RETENTION_DAYS: "365" },
    })).toThrow("0 to 30");
  });
});
