type Environment = Readonly<Record<string, string | undefined>>;

function approvedCountries(value: string | undefined): Set<string> {
  return new Set((value ?? "").split(",").map((country) => country.trim()).filter(Boolean));
}

/**
 * Final server-side gate for live calling. Credentials alone never imply that
 * a destination is legally approved for AI voice processing or transcription.
 */
export function assertOutboundCallPolicy(input: {
  countryCode?: string;
  env: Environment;
}): void {
  if (!input.countryCode || !/^[A-Z]{2}$/.test(input.countryCode)) {
    throw new Error("A valid destination country is required before live calling");
  }
  if (!approvedCountries(input.env.CALLBRIDGE_APPROVED_CALL_COUNTRIES).has(input.countryCode)) {
    throw new Error(`Live calling is not approved for destination ${input.countryCode}`);
  }
  if (!input.env.CALLBRIDGE_CALL_POLICY_VERSION?.trim()) {
    throw new Error("An approved call policy version is required before live calling");
  }
  if (input.env.CALLBRIDGE_TRANSCRIPTION_DISCLOSURE !== "required_before_conversation") {
    throw new Error("Transcription disclosure must be required before conversation");
  }
  const retentionDays = Number(input.env.CALLBRIDGE_TRANSCRIPT_RETENTION_DAYS);
  if (!Number.isInteger(retentionDays) || retentionDays < 0 || retentionDays > 30) {
    throw new Error("Transcript retention must be an integer from 0 to 30 days");
  }
}
