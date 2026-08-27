import { describe, expect, it, vi } from "vitest";

import type { TwilioVoiceQuote } from "../src/internationalCalling";
import { ensureTwilioLowRiskDialingPermission } from "../src/twilioDialingPermissions";

function quote(isoCountry: string): TwilioVoiceQuote {
  return {
    provider: "twilio",
    destination: { isoCountry, country: isoCountry, maskedPhone: "+202…5678" },
    policy: { allowed: true, riskTier: "low_risk_only", provisioning: "just_in_time" },
    pstn: {
      rateDescription: "Outbound voice",
      currentPricePerMinute: "0.21",
      currency: "USD",
      maximumConnectedSeconds: 180,
      estimatedMaximumCharge: "0.63",
    },
    quote: {
      quotedAt: "2026-08-26T08:00:00.000Z",
      source: "twilio_public_outbound_pricing_csv",
      accountSpecific: false,
    },
    exclusions: ["twilio_media_streams", "openai_realtime_audio", "taxes_and_carrier_surcharges"],
  };
}

function permission(enabled: boolean, isoCountry = "EG") {
  return new Response(JSON.stringify({
    iso_code: isoCountry,
    name: isoCountry,
    low_risk_numbers_enabled: enabled,
    high_risk_special_numbers_enabled: false,
    high_risk_tollfraud_numbers_enabled: false,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

function unsafePermission() {
  return new Response(JSON.stringify({
    iso_code: "EG",
    name: "Egypt",
    low_risk_numbers_enabled: true,
    high_risk_special_numbers_enabled: true,
    high_risk_tollfraud_numbers_enabled: true,
  }), { status: 200, headers: { "content-type": "application/json" } });
}

describe("just-in-time Twilio dialing permissions", () => {
  it("does not write when the destination is already enabled", async () => {
    const fetchImpl = vi.fn(async () => permission(true));
    const result = await ensureTwilioLowRiskDialingPermission({
      quote: quote("EG"),
      apiKey: "SK-control",
      apiKeySecret: "secret",
      fetchImpl,
    });
    expect(result).toMatchObject({ isoCountry: "EG", changed: false, lowRiskNumbersEnabled: true });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enables only low-risk numbers and verifies the provider update", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(permission(false))
      .mockResolvedValueOnce(new Response(JSON.stringify({ update_count: 1 }), { status: 200 }))
      .mockResolvedValueOnce(permission(true));
    const result = await ensureTwilioLowRiskDialingPermission({
      quote: quote("EG"),
      apiKey: "SK-control",
      apiKeySecret: "secret",
      fetchImpl,
    });
    expect(result.changed).toBe(true);
    const [, request] = fetchImpl.mock.calls[1]!;
    const update = JSON.parse(new URLSearchParams(String(request?.body)).get("UpdateRequest")!);
    expect(update).toEqual([{
      iso_code: "EG",
      low_risk_numbers_enabled: true,
      high_risk_special_numbers_enabled: false,
      high_risk_tollfraud_numbers_enabled: false,
    }]);
  });

  it("disables pre-existing high-risk permissions even when low-risk calling is already enabled", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(unsafePermission())
      .mockResolvedValueOnce(new Response(JSON.stringify({ update_count: 1 }), { status: 200 }))
      .mockResolvedValueOnce(permission(true));
    await expect(ensureTwilioLowRiskDialingPermission({
      quote: quote("EG"),
      apiKey: "SK-control",
      apiKeySecret: "secret",
      fetchImpl,
    })).resolves.toMatchObject({ changed: true, highRiskSpecialNumbersEnabled: false, highRiskTollFraudNumbersEnabled: false });
    const update = JSON.parse(new URLSearchParams(String(fetchImpl.mock.calls[1]![1]?.body)).get("UpdateRequest")!);
    expect(update[0]).toMatchObject({
      low_risk_numbers_enabled: true,
      high_risk_special_numbers_enabled: false,
      high_risk_tollfraud_numbers_enabled: false,
    });
  });

  it("fails closed when control-plane credentials or provider verification are unavailable", async () => {
    await expect(ensureTwilioLowRiskDialingPermission({
      quote: quote("EG"),
      apiKey: "",
      apiKeySecret: "",
    })).rejects.toThrow("twilio_control_plane_not_configured");

    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(permission(false))
      .mockResolvedValueOnce(new Response(JSON.stringify({ update_count: 1 }), { status: 200 }))
      .mockResolvedValueOnce(permission(false));
    await expect(ensureTwilioLowRiskDialingPermission({
      quote: quote("EG"),
      apiKey: "SK-control",
      apiKeySecret: "secret",
      fetchImpl,
    })).rejects.toThrow("twilio_geo_permission_update_not_observed");
  });

  it("uses Twilio's shared provider country for Canadian destinations", async () => {
    const fetchImpl = vi.fn(async (_resource: RequestInfo | URL) => permission(true, "US"));
    const result = await ensureTwilioLowRiskDialingPermission({
      quote: quote("CA"),
      apiKey: "SK-control",
      apiKeySecret: "secret",
      fetchImpl,
    });
    expect(result).toMatchObject({ isoCountry: "CA", providerIsoCountry: "US" });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/Countries/US");
  });

  it("does not widen Kazakhstan permissions by enabling Russia", async () => {
    const fetchImpl = vi.fn(async (_resource: RequestInfo | URL) => permission(true, "KZ"));
    const result = await ensureTwilioLowRiskDialingPermission({
      quote: quote("KZ"),
      apiKey: "SK-control",
      apiKeySecret: "secret",
      fetchImpl,
    });
    expect(result).toMatchObject({ isoCountry: "KZ", providerIsoCountry: "KZ" });
    expect(String(fetchImpl.mock.calls[0]![0])).toContain("/Countries/KZ");
    expect(String(fetchImpl.mock.calls[0]![0])).not.toContain("/Countries/RU");
  });
});
