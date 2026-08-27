export const CALLBRIDGE_MANUAL_REVIEW_COUNTRIES = ["BY", "RU"] as const;
export const CALLBRIDGE_BLOCKED_COUNTRIES = ["CU", "IR", "KP", "SY"] as const;

const E164 = /^\+[1-9]\d{7,14}$/;

export type TwilioVoiceQuote = {
  provider: "twilio";
  destination: {
    isoCountry: string;
    country: string;
    maskedPhone: string;
  };
  policy: {
    allowed: true;
    riskTier: "low_risk_only";
    provisioning: "just_in_time";
  };
  pstn: {
    rateDescription: string;
    currentPricePerMinute: string;
    currency: string;
    maximumConnectedSeconds: number;
    estimatedMaximumCharge: string;
  };
  quote: {
    quotedAt: string;
    source: "twilio_voice_number_pricing_api_v2" | "twilio_public_outbound_pricing_csv";
    accountSpecific: boolean;
  };
  exclusions: readonly ["twilio_media_streams", "openai_realtime_audio", "taxes_and_carrier_surcharges"];
};

type TwilioVoiceNumberPricingResponse = {
  country?: string;
  iso_country?: string;
  outbound_call_prices?: Array<{
    current_price?: string | number | null;
    friendly_name?: string;
    origination_prefixes?: string[];
  }>;
  price_unit?: string;
  message?: string;
};

type PricedDestination = {
  isoCountry: string;
  country: string;
  description: string;
  currentPricePerMinute: number;
  currency: string;
  source: TwilioVoiceQuote["quote"]["source"];
  accountSpecific: boolean;
};

export type InternationalCallingPolicy = {
  blockedCountries: ReadonlySet<string>;
  manualReviewCountries: ReadonlySet<string>;
  maximumPstnRateUsd: number;
  maximumPstnCallUsd: number;
};

function parseCountrySet(value: string | undefined, fallback: readonly string[]): ReadonlySet<string> {
  const values = value?.split(",").map((item) => item.trim().toUpperCase()).filter(Boolean) ?? [...fallback];
  if (!values.length || values.some((item) => !/^[A-Z]{2}$/.test(item))) throw new Error("International country policy is invalid");
  return new Set(values);
}

function positiveMoney(value: string | undefined, fallback: number, name: string): number {
  const parsed = value === undefined || value.trim() === "" ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

export function loadInternationalCallingPolicy(env: {
  CALLBRIDGE_BLOCKED_CALL_COUNTRIES?: string;
  CALLBRIDGE_MANUAL_REVIEW_COUNTRIES?: string;
  CALLBRIDGE_MAX_PSTN_RATE_USD?: string;
  CALLBRIDGE_MAX_PSTN_CALL_USD?: string;
}): InternationalCallingPolicy {
  const blockedCountries = parseCountrySet(env.CALLBRIDGE_BLOCKED_CALL_COUNTRIES, CALLBRIDGE_BLOCKED_COUNTRIES);
  const manualReviewCountries = parseCountrySet(env.CALLBRIDGE_MANUAL_REVIEW_COUNTRIES, CALLBRIDGE_MANUAL_REVIEW_COUNTRIES);
  for (const country of manualReviewCountries) {
    if (blockedCountries.has(country)) throw new Error(`Country ${country} cannot be both blocked and manual-review`);
  }
  return {
    blockedCountries,
    manualReviewCountries,
    maximumPstnRateUsd: positiveMoney(env.CALLBRIDGE_MAX_PSTN_RATE_USD, 2, "CALLBRIDGE_MAX_PSTN_RATE_USD"),
    maximumPstnCallUsd: positiveMoney(env.CALLBRIDGE_MAX_PSTN_CALL_USD, 6, "CALLBRIDGE_MAX_PSTN_CALL_USD"),
  };
}

function maskPhone(phoneE164: string): string {
  return phoneE164.length <= 8 ? `${phoneE164.slice(0, 3)}…${phoneE164.slice(-2)}` : `${phoneE164.slice(0, 4)}…${phoneE164.slice(-4)}`;
}

function decimalCeiling(value: number): string {
  const scale = 1_000_000;
  const conservative = Math.ceil(value * scale) / scale;
  return conservative.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

function requireCallableCountry(isoCountry: string, policy: InternationalCallingPolicy): void {
  if (policy.manualReviewCountries.has(isoCountry)) throw new Error(`country_requires_manual_review:${isoCountry}`);
  if (policy.blockedCountries.has(isoCountry)) throw new Error(`country_blocked:${isoCountry}`);
}

const PROHIBITED_RATE_DESCRIPTION = /\b(?:premium|shared[- ]?cost|special service|satellite|personal number)\b/i;

function parseCsvRows(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index]!;
    if (quoted) {
      if (character === '"' && csv[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(value);
      value = "";
    } else if (character === "\n") {
      row.push(value.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (value || row.length) {
    row.push(value.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows;
}

function quoteFromPublicCsv(csv: string, to: string): PricedDestination {
  const rows = parseCsvRows(csv);
  if (rows.length < 2 || rows[0]?.slice(0, 4).join(",") !== "ISO,Country,Description,Price / min") {
    throw new Error("twilio_public_pricing_invalid");
  }
  const digits = to.slice(1);
  const matches = rows.slice(1).flatMap((row) => {
    const [isoCountry, country, description, rawPrice, , rawPrefixes] = row;
    const currentPricePerMinute = Number(rawPrice);
    if (!isoCountry || !country || !description || !Number.isFinite(currentPricePerMinute) || !rawPrefixes) return [];
    const matchingPrefixes = rawPrefixes.split(",").map((prefix) => prefix.trim()).filter((prefix) => /^\d+$/.test(prefix) && digits.startsWith(prefix));
    if (!matchingPrefixes.length) return [];
    return [{ isoCountry, country, description, currentPricePerMinute, prefixLength: Math.max(...matchingPrefixes.map((prefix) => prefix.length)) }];
  });
  if (!matches.length) throw new Error("twilio_destination_not_priced");
  const longestPrefix = Math.max(...matches.map((match) => match.prefixLength));
  const exact = matches.filter((match) => match.prefixLength === longestPrefix).sort((left, right) => right.currentPricePerMinute - left.currentPricePerMinute)[0]!;
  return {
    isoCountry: exact.isoCountry,
    country: exact.country,
    description: exact.description,
    currentPricePerMinute: exact.currentPricePerMinute,
    currency: "USD",
    source: "twilio_public_outbound_pricing_csv",
    accountSpecific: false,
  };
}

async function pricedDestination(input: {
  accountSid: string;
  apiKey: string;
  apiKeySecret: string;
  from: string;
  to: string;
  fetchImpl: typeof fetch;
  publicPricingCsvUrl: string;
}): Promise<PricedDestination> {
  const endpoint = new URL(`https://pricing.twilio.com/v2/Voice/Numbers/${encodeURIComponent(input.to)}`);
  endpoint.searchParams.set("OriginationNumber", input.from);
  const auth = btoa(`${input.apiKey}:${input.apiKeySecret}`);
  const response = await input.fetchImpl(endpoint, { headers: { authorization: `Basic ${auth}` } });
  if (response.ok) {
    const data = await response.json<TwilioVoiceNumberPricingResponse>();
    const isoCountry = data.iso_country?.toUpperCase();
    const rates = (data.outbound_call_prices ?? [])
      .map((item) => ({ rate: Number(item.current_price), description: item.friendly_name ?? `Twilio outbound voice to ${data.country ?? isoCountry ?? "destination"}` }))
      .filter((item) => Number.isFinite(item.rate) && item.rate >= 0)
      .sort((left, right) => right.rate - left.rate);
    if (isoCountry && /^[A-Z]{2}$/.test(isoCountry) && data.country && data.price_unit && rates.length) {
      return {
        isoCountry,
        country: data.country,
        description: rates[0]!.description,
        currentPricePerMinute: rates[0]!.rate,
        currency: data.price_unit.toUpperCase(),
        source: "twilio_voice_number_pricing_api_v2",
        accountSpecific: true,
      };
    }
  }
  const fallback = await input.fetchImpl(input.publicPricingCsvUrl);
  if (!fallback.ok) throw new Error(`twilio_pricing_unavailable:${response.status}:${fallback.status}`);
  return quoteFromPublicCsv(await fallback.text(), input.to);
}

export async function quoteTwilioVoiceCall(input: {
  accountSid: string;
  apiKey: string;
  apiKeySecret: string;
  from: string;
  to: string;
  maximumConnectedSeconds: number;
  policy: InternationalCallingPolicy;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  publicPricingCsvUrl?: string;
}): Promise<TwilioVoiceQuote> {
  if (!E164.test(input.from) || !E164.test(input.to)) throw new Error("Twilio pricing requires E.164 numbers");
  if (!Number.isInteger(input.maximumConnectedSeconds) || input.maximumConnectedSeconds < 1 || input.maximumConnectedSeconds > 3_600) {
    throw new Error("Maximum connected seconds is invalid");
  }
  if (!input.accountSid || !input.apiKey || !input.apiKeySecret) throw new Error("Twilio pricing credentials are missing");

  const fetchImpl: typeof fetch = input.fetchImpl ?? ((resource, init) => fetch(resource, init));
  const priced = await pricedDestination({
    accountSid: input.accountSid,
    apiKey: input.apiKey,
    apiKeySecret: input.apiKeySecret,
    from: input.from,
    to: input.to,
    fetchImpl,
    publicPricingCsvUrl: input.publicPricingCsvUrl ?? "https://assets.cdn.prod.twilio.com/pricing-csv/OutboundVoicePricing.csv",
  });
  requireCallableCountry(priced.isoCountry, input.policy);
  if (PROHIBITED_RATE_DESCRIPTION.test(priced.description)) throw new Error("twilio_high_risk_destination_type");
  const currentPricePerMinute = priced.currentPricePerMinute;
  const estimatedMaximumCharge = currentPricePerMinute * Math.ceil(input.maximumConnectedSeconds / 60);
  if (priced.currency === "USD" && currentPricePerMinute > input.policy.maximumPstnRateUsd) throw new Error("twilio_rate_cap_exceeded");
  if (priced.currency === "USD" && estimatedMaximumCharge > input.policy.maximumPstnCallUsd) throw new Error("twilio_call_cap_exceeded");

  return {
    provider: "twilio",
    destination: { isoCountry: priced.isoCountry, country: priced.country, maskedPhone: maskPhone(input.to) },
    policy: { allowed: true, riskTier: "low_risk_only", provisioning: "just_in_time" },
    pstn: {
      rateDescription: priced.description,
      currentPricePerMinute: decimalCeiling(currentPricePerMinute),
      currency: priced.currency,
      maximumConnectedSeconds: input.maximumConnectedSeconds,
      estimatedMaximumCharge: decimalCeiling(estimatedMaximumCharge),
    },
    quote: {
      quotedAt: (input.now?.() ?? new Date()).toISOString(),
      source: priced.source,
      accountSpecific: priced.accountSpecific,
    },
    exclusions: ["twilio_media_streams", "openai_realtime_audio", "taxes_and_carrier_surcharges"],
  };
}
