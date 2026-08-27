import type { TwilioVoiceQuote } from "./internationalCalling";

type CountryPermission = {
  iso_code?: string;
  name?: string;
  low_risk_numbers_enabled?: boolean;
  high_risk_special_numbers_enabled?: boolean;
  high_risk_tollfraud_numbers_enabled?: boolean;
  message?: string;
};

type BulkCountryUpdate = {
  update_count?: number;
  message?: string;
};

export type DialingPermissionResult = {
  isoCountry: string;
  providerIsoCountry: string;
  lowRiskNumbersEnabled: true;
  highRiskSpecialNumbersEnabled: false;
  highRiskTollFraudNumbersEnabled: false;
  changed: boolean;
};

const PROVIDER_ISO_ALIASES: Readonly<Record<string, string>> = {
  CA: "US",
};

function providerIsoCountry(isoCountry: string): string {
  return PROVIDER_ISO_ALIASES[isoCountry] ?? isoCountry;
}

function authHeader(apiKey: string, apiKeySecret: string): string {
  if (!apiKey || !apiKeySecret) throw new Error("twilio_control_plane_not_configured");
  return `Basic ${btoa(`${apiKey}:${apiKeySecret}`)}`;
}

async function fetchCountry(input: {
  isoCountry: string;
  authorization: string;
  fetchImpl: typeof fetch;
}): Promise<CountryPermission> {
  const response = await input.fetchImpl(`https://voice.twilio.com/v1/DialingPermissions/Countries/${input.isoCountry}`, {
    headers: { authorization: input.authorization },
  });
  const data = await response.json<CountryPermission>();
  if (!response.ok) throw new Error(`twilio_geo_permission_read_failed:${response.status}:${data.message ?? "unknown"}`);
  return data;
}

export async function ensureTwilioLowRiskDialingPermission(input: {
  quote: TwilioVoiceQuote;
  apiKey: string;
  apiKeySecret: string;
  fetchImpl?: typeof fetch;
}): Promise<DialingPermissionResult> {
  const isoCountry = input.quote.destination.isoCountry.toUpperCase();
  if (!/^[A-Z]{2}$/.test(isoCountry)) throw new Error("twilio_geo_permission_country_invalid");
  if (input.quote.policy.riskTier !== "low_risk_only" || input.quote.policy.provisioning !== "just_in_time") {
    throw new Error("twilio_geo_permission_policy_invalid");
  }

  const fetchImpl: typeof fetch = input.fetchImpl ?? ((resource, init) => fetch(resource, init));
  const authorization = authHeader(input.apiKey, input.apiKeySecret);
  const providerCountry = providerIsoCountry(isoCountry);
  const current = await fetchCountry({ isoCountry: providerCountry, authorization, fetchImpl });
  if (
    current.low_risk_numbers_enabled === true
    && current.high_risk_special_numbers_enabled !== true
    && current.high_risk_tollfraud_numbers_enabled !== true
  ) {
    return {
      isoCountry,
      providerIsoCountry: providerCountry,
      lowRiskNumbersEnabled: true,
      highRiskSpecialNumbersEnabled: false,
      highRiskTollFraudNumbersEnabled: false,
      changed: false,
    };
  }

  const updateRequest = JSON.stringify([{
    iso_code: providerCountry,
    low_risk_numbers_enabled: true,
    high_risk_special_numbers_enabled: false,
    high_risk_tollfraud_numbers_enabled: false,
  }]);
  const response = await fetchImpl("https://voice.twilio.com/v1/DialingPermissions/BulkCountryUpdates", {
    method: "POST",
    headers: { authorization, "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ UpdateRequest: updateRequest }),
  });
  const updated = await response.json<BulkCountryUpdate>();
  if (!response.ok || updated.update_count !== 1) {
    throw new Error(`twilio_geo_permission_update_failed:${response.status}:${updated.message ?? updated.update_count ?? "unknown"}`);
  }

  const verified = await fetchCountry({ isoCountry: providerCountry, authorization, fetchImpl });
  if (verified.low_risk_numbers_enabled !== true) throw new Error("twilio_geo_permission_update_not_observed");
  if (verified.high_risk_special_numbers_enabled === true || verified.high_risk_tollfraud_numbers_enabled === true) {
    throw new Error("twilio_geo_permission_high_risk_enabled");
  }
  return {
    isoCountry,
    providerIsoCountry: providerCountry,
    lowRiskNumbersEnabled: true,
    highRiskSpecialNumbersEnabled: false,
    highRiskTollFraudNumbersEnabled: false,
    changed: true,
  };
}
