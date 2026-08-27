import { z } from "zod";

export const INQUIRY_PRICING_QUOTE_TTL_MS = 5 * 60 * 1_000;

const moneyText = z.string().trim().regex(/^\d+(?:\.\d{1,6})?$/, "Must be a non-negative decimal amount");

export const inquiryPricingQuoteSchema = z
  .object({
    quoteId: z.string().uuid(),
    revision: z.number().int().positive(),
    executionRevision: z.string().trim().min(1),
    provider: z.literal("twilio"),
    destination: z
      .object({
        isoCountry: z.string().trim().toUpperCase().regex(/^[A-Z]{2}$/),
        country: z.string().trim().min(1).max(120),
        maskedPhone: z.string().trim().min(1).max(40),
      })
      .strict(),
    policy: z
      .object({
        allowed: z.literal(true),
        riskTier: z.literal("low_risk_only"),
        provisioning: z.literal("just_in_time"),
      })
      .strict(),
    pstn: z
      .object({
        rateDescription: z.string().trim().min(1).max(300),
        currentPricePerMinute: moneyText,
        currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
        maximumConnectedSeconds: z.number().int().min(30).max(900),
        estimatedMaximumCharge: moneyText,
      })
      .strict(),
    quote: z
      .object({
        quotedAt: z.string().datetime(),
        expiresAt: z.string().datetime(),
        source: z.enum([
          "twilio_voice_number_pricing_api_v2",
          "twilio_public_outbound_pricing_csv",
        ]),
        accountSpecific: z.boolean(),
      })
      .strict(),
    exclusions: z.tuple([
      z.literal("twilio_media_streams"),
      z.literal("openai_realtime_audio"),
      z.literal("taxes_and_carrier_surcharges"),
    ]),
  })
  .strict();

export type InquiryPricingQuote = z.output<typeof inquiryPricingQuoteSchema>;

export type InquiryPricingState =
  | { status: "not_ready" }
  | { status: "ready"; quote: InquiryPricingQuote };

export function parseInquiryPricingQuote(input: unknown): InquiryPricingQuote {
  return inquiryPricingQuoteSchema.parse(input);
}

export function decimalToMinorUnits(value: string): number {
  const normalized = moneyText.parse(value);
  const [whole, fraction = ""] = normalized.split(".");
  const padded = `${fraction}00`.slice(0, 2);
  const roundUp = fraction.slice(2).split("").some((digit) => digit !== "0") ? 1 : 0;
  const minorUnits = Number(whole) * 100 + Number(padded) + roundUp;
  if (!Number.isSafeInteger(minorUnits)) throw new Error("Price exceeds safe integer range");
  return minorUnits;
}

const PROHIBITED_RATE_DESCRIPTION = /\b(?:premium|shared[- ]?cost|special service|satellite|personal number)\b/i;

export function assertInquiryQuoteMatches(input: {
  quote: InquiryPricingQuote;
  revision: number;
  executionRevision: string;
  destinationCountryCode: string;
  maximumConnectedSeconds: number;
  costCeiling: { currency: string; maxTotalMinorUnits: number };
  nowMs?: number;
}): void {
  const quote = parseInquiryPricingQuote(input.quote);
  if (quote.revision !== input.revision || quote.executionRevision !== input.executionRevision) {
    throw new Error("PRICING_REVISION_MISMATCH");
  }
  if (quote.destination.isoCountry !== input.destinationCountryCode.toUpperCase()) {
    throw new Error("DESTINATION_COUNTRY_MISMATCH");
  }
  if (quote.pstn.maximumConnectedSeconds !== input.maximumConnectedSeconds) {
    throw new Error("PRICING_DURATION_MISMATCH");
  }
  if (quote.pstn.currency !== input.costCeiling.currency.toUpperCase()) {
    throw new Error("PRICING_CURRENCY_MISMATCH");
  }
  if (decimalToMinorUnits(quote.pstn.estimatedMaximumCharge) > input.costCeiling.maxTotalMinorUnits) {
    throw new Error("COST_CEILING_EXCEEDED");
  }
  if (PROHIBITED_RATE_DESCRIPTION.test(quote.pstn.rateDescription)) {
    throw new Error("HIGH_RISK_DESTINATION_TYPE");
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(quote.quote.quotedAt) > nowMs + 60_000 || Date.parse(quote.quote.expiresAt) <= nowMs) {
    throw new Error("PRICING_QUOTE_EXPIRED");
  }
}
