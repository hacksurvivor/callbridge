import { describe, expect, it, vi } from "vitest";

import {
  loadInternationalCallingPolicy,
  quoteTwilioVoiceCall,
} from "../src/internationalCalling";

const credentials = {
  accountSid: "AC00000000000000000000000000000000",
  apiKey: "SK00000000000000000000000000000000",
  apiKeySecret: "secret",
  from: "+12065550100",
  maximumConnectedSeconds: 180,
};

function pricingResponse(input: { isoCountry: string; country: string; rate: string }) {
  return new Response(JSON.stringify({
    country: input.country,
    iso_country: input.isoCountry,
    outbound_call_prices: [{ current_price: input.rate, friendly_name: `Programmable Outbound Minute - ${input.country}`, origination_prefixes: ["ALL"] }],
    price_unit: "USD",
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("international Twilio calling policy", () => {
  it("accepts any provider-priced destination without a static allowlist", () => {
    const policy = loadInternationalCallingPolicy({});
    expect(policy.blockedCountries.has("EG")).toBe(false);
    expect(policy.blockedCountries.has("IN")).toBe(false);
    expect(policy.blockedCountries.has("TJ")).toBe(false);
    expect(policy.blockedCountries.has("KZ")).toBe(false);
    expect(policy.manualReviewCountries.has("RU")).toBe(true);
    expect(policy.manualReviewCountries.has("BY")).toBe(true);
  });

  it("quotes newly requested countries such as Egypt without prior configuration", async () => {
    const quote = await quoteTwilioVoiceCall({
      ...credentials,
      to: "+20212345678",
      policy: loadInternationalCallingPolicy({}),
      fetchImpl: vi.fn(async () => pricingResponse({ isoCountry: "EG", country: "Egypt", rate: "0.21" })),
    });
    expect(quote).toMatchObject({
      destination: { isoCountry: "EG", country: "Egypt" },
      policy: { allowed: true, riskTier: "low_risk_only", provisioning: "just_in_time" },
    });
  });

  it("returns a masked, time-bounded, source-labelled quote", async () => {
    const fetchImpl = vi.fn(async () => pricingResponse({ isoCountry: "GE", country: "Georgia", rate: "0.4727" }));
    const quote = await quoteTwilioVoiceCall({
      ...credentials,
      to: "+995322123456",
      policy: loadInternationalCallingPolicy({}),
      fetchImpl,
      now: () => new Date("2026-08-26T08:00:00.000Z"),
    });
    expect(quote).toMatchObject({
      destination: { isoCountry: "GE", maskedPhone: "+995…3456" },
      policy: { allowed: true, riskTier: "low_risk_only" },
      pstn: { currentPricePerMinute: "0.4727", estimatedMaximumCharge: "1.4181", currency: "USD" },
      quote: { source: "twilio_voice_number_pricing_api_v2", accountSpecific: true },
    });
    expect(JSON.stringify(quote)).not.toContain("2123456");
  });

  it("rounds displayed provider charges upward instead of understating the ceiling", async () => {
    const quote = await quoteTwilioVoiceCall({
      ...credentials,
      to: "+995322123456",
      policy: loadInternationalCallingPolicy({}),
      fetchImpl: vi.fn(async () => pricingResponse({ isoCountry: "GE", country: "Georgia", rate: "0.0100001" })),
    });
    expect(quote.pstn).toMatchObject({
      currentPricePerMinute: "0.010001",
      estimatedMaximumCharge: "0.030001",
    });
  });

  it("fails closed for manual-review or blocked countries, unavailable pricing, and rate caps", async () => {
    await expect(quoteTwilioVoiceCall({
      ...credentials,
      to: "+74951234567",
      policy: loadInternationalCallingPolicy({}),
      fetchImpl: vi.fn(async () => pricingResponse({ isoCountry: "RU", country: "Russia", rate: "0.1" })),
    })).rejects.toThrow("country_requires_manual_review:RU");

    await expect(quoteTwilioVoiceCall({
      ...credentials,
      to: "+982112345678",
      policy: loadInternationalCallingPolicy({}),
      fetchImpl: vi.fn(async () => pricingResponse({ isoCountry: "IR", country: "Iran", rate: "0.1" })),
    })).rejects.toThrow("country_blocked:IR");

    await expect(quoteTwilioVoiceCall({
      ...credentials,
      to: "+995322123456",
      policy: loadInternationalCallingPolicy({ CALLBRIDGE_MAX_PSTN_RATE_USD: "0.25" }),
      fetchImpl: vi.fn(async () => pricingResponse({ isoCountry: "GE", country: "Georgia", rate: "0.4727" })),
    })).rejects.toThrow("twilio_rate_cap_exceeded");

    await expect(quoteTwilioVoiceCall({
      ...credentials,
      to: "+995322123456",
      policy: loadInternationalCallingPolicy({}),
      fetchImpl: vi.fn(async () => new Response("unavailable", { status: 503 })),
      publicPricingCsvUrl: "https://example.com/fallback.csv",
    })).rejects.toThrow("twilio_pricing_unavailable:503:503");

    await expect(quoteTwilioVoiceCall({
      ...credentials,
      to: "+448712345678",
      policy: loadInternationalCallingPolicy({}),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({
        country: "United Kingdom",
        iso_country: "GB",
        outbound_call_prices: [{ current_price: "0.5", friendly_name: "Premium shared-cost service" }],
        price_unit: "USD",
      }), { status: 200 })),
    })).rejects.toThrow("twilio_high_risk_destination_type");
  });

  it("falls back to Twilio's official retail CSV and picks the most specific destination prefix", async () => {
    const csv = [
      "ISO,Country,Description,Price / min,Origination Prefixes,Destination Prefixes",
      "JP,Japan,Programmable Outbound Minute - Japan,0.07460,,81",
      "JP,Japan,Programmable Outbound Minute - Japan - Mobile,0.18500,,8190",
    ].join("\n");
    const fetchImpl = vi.fn(async (resource: RequestInfo | URL) => String(resource).includes("pricing.twilio.com")
      ? new Response(JSON.stringify({ message: "permission missing" }), { status: 403 })
      : new Response(csv, { status: 200 }));
    const quote = await quoteTwilioVoiceCall({
      ...credentials,
      to: "+819012345678",
      policy: loadInternationalCallingPolicy({}),
      fetchImpl,
    });
    expect(quote).toMatchObject({
      destination: { isoCountry: "JP", country: "Japan" },
      pstn: { rateDescription: "Programmable Outbound Minute - Japan - Mobile", currentPricePerMinute: "0.185" },
      quote: { source: "twilio_public_outbound_pricing_csv", accountSpecific: false },
    });
  });
});
