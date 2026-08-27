import { describe, expect, it } from "vitest";

import {
  assertInquiryQuoteMatches,
  decimalToMinorUnits,
  parseInquiryPricingQuote,
} from "../shared/inquiryPricing.js";

function quote(overrides: Record<string, unknown> = {}) {
  return parseInquiryPricingQuote({
    quoteId: "00000000-0000-4000-8000-000000000001",
    revision: 2,
    executionRevision: "inquiry-v1:sha256:priced",
    provider: "twilio",
    destination: { isoCountry: "MD", country: "Moldova", maskedPhone: "+373…1234" },
    policy: { allowed: true, riskTier: "low_risk_only", provisioning: "just_in_time" },
    pstn: {
      rateDescription: "Programmable outbound minute - Moldova",
      currentPricePerMinute: "0.21",
      currency: "USD",
      maximumConnectedSeconds: 180,
      estimatedMaximumCharge: "0.63",
    },
    quote: {
      quotedAt: "2026-08-27T03:00:00.000Z",
      expiresAt: "2026-08-27T03:05:00.000Z",
      source: "twilio_voice_number_pricing_api_v2",
      accountSpecific: true,
    },
    exclusions: ["twilio_media_streams", "openai_realtime_audio", "taxes_and_carrier_surcharges"],
    ...overrides,
  });
}

function assertMatches(candidate = quote()) {
  return () => assertInquiryQuoteMatches({
    quote: candidate,
    revision: 2,
    executionRevision: "inquiry-v1:sha256:priced",
    destinationCountryCode: "MD",
    maximumConnectedSeconds: 180,
    costCeiling: { currency: "USD", maxTotalMinorUnits: 500 },
    nowMs: Date.parse("2026-08-27T03:01:00.000Z"),
  });
}

describe("general inquiry pricing contract", () => {
  it("binds a fresh low-risk quote to the exact revision, country, duration, currency, and ceiling", () => {
    expect(assertMatches()).not.toThrow();
    expect(decimalToMinorUnits("0.63")).toBe(63);
    expect(decimalToMinorUnits("12.3456")).toBe(1_235);
  });

  it("rejects stale, mismatched, over-ceiling, and special-rate quotes", () => {
    expect(() => assertInquiryQuoteMatches({
      quote: quote(),
      revision: 3,
      executionRevision: "inquiry-v1:sha256:priced",
      destinationCountryCode: "MD",
      maximumConnectedSeconds: 180,
      costCeiling: { currency: "USD", maxTotalMinorUnits: 500 },
      nowMs: Date.parse("2026-08-27T03:01:00.000Z"),
    })).toThrow("PRICING_REVISION_MISMATCH");

    expect(assertMatches(quote({
      destination: { isoCountry: "GE", country: "Georgia", maskedPhone: "+995…1234" },
    }))).toThrow("DESTINATION_COUNTRY_MISMATCH");

    expect(assertMatches(quote({
      pstn: {
        rateDescription: "Programmable outbound minute - Moldova",
        currentPricePerMinute: "2",
        currency: "USD",
        maximumConnectedSeconds: 180,
        estimatedMaximumCharge: "6",
      },
    }))).toThrow("COST_CEILING_EXCEEDED");

    expect(assertMatches(quote({
      pstn: {
        rateDescription: "Premium shared-cost service",
        currentPricePerMinute: "0.1",
        currency: "USD",
        maximumConnectedSeconds: 180,
        estimatedMaximumCharge: "0.3",
      },
    }))).toThrow("HIGH_RISK_DESTINATION_TYPE");

    expect(() => assertInquiryQuoteMatches({
      quote: quote(),
      revision: 2,
      executionRevision: "inquiry-v1:sha256:priced",
      destinationCountryCode: "MD",
      maximumConnectedSeconds: 180,
      costCeiling: { currency: "USD", maxTotalMinorUnits: 500 },
      nowMs: Date.parse("2026-08-27T03:05:00.000Z"),
    })).toThrow("PRICING_QUOTE_EXPIRED");
  });
});
