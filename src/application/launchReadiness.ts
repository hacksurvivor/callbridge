export const EXTERNAL_EFFECTS_FLAG = "CALLBRIDGE_EXTERNAL_EFFECTS_ENABLED";

export type LaunchCapability =
  | "convex"
  | "authentication"
  | "call_policy"
  | "billing_webhook"
  | "realtime"
  | "telephony"
  | "push_notifications"
  | "gmail"
  | "booking"
  | "public_contact_search"
  | "messaging_drafts";

export type CapabilityReadiness = {
  capability: LaunchCapability;
  ready: boolean;
  missing: string[];
  externallyEnabled: boolean;
};

export type LaunchReadinessReport = {
  readyForExternalEffects: boolean;
  externalEffectsEnabled: boolean;
  capabilities: CapabilityReadiness[];
};

type Environment = Readonly<Record<string, string | undefined>>;

const REQUIREMENTS: Readonly<Record<LaunchCapability, readonly string[]>> = {
  convex: ["CONVEX_CLOUD_URL"],
  authentication: ["WORKOS_CLIENT_ID", "WORKOS_API_KEY"],
  call_policy: [
    "CALLBRIDGE_APPROVED_CALL_COUNTRIES",
    "CALLBRIDGE_CALL_POLICY_VERSION",
    "CALLBRIDGE_TRANSCRIPTION_DISCLOSURE",
    "CALLBRIDGE_TRANSCRIPT_RETENTION_DAYS",
  ],
  billing_webhook: ["LEMON_SQUEEZY_WEBHOOK_SECRET"],
  realtime: ["OPENAI_API_KEY", "CALLBRIDGE_REALTIME_MODEL"],
  telephony: [
    "CALLBRIDGE_TELEPHONY_PROVIDER",
    "CALLBRIDGE_TELEPHONY_DISPATCH_URL",
    "CALLBRIDGE_TELEPHONY_API_KEY",
    "CALLBRIDGE_TELEPHONY_WEBHOOK_SECRET",
  ],
  push_notifications: ["EXPO_ACCESS_TOKEN"],
  gmail: [
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET",
    "GOOGLE_OAUTH_REDIRECT_URI",
    "CALLBRIDGE_CONNECTOR_TOKEN_ENCRYPTION_KEY",
  ],
  booking: ["BOOKING_DEMAND_API_KEY", "BOOKING_AFFILIATE_ID"],
  public_contact_search: ["OPENAI_API_KEY", "CALLBRIDGE_CONTACT_SEARCH_MODEL"],
  messaging_drafts: ["OPENAI_API_KEY", "CALLBRIDGE_DRAFT_MODEL"],
};

function configured(env: Environment, name: string): boolean {
  const value = env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function launchReadiness(env: Environment): LaunchReadinessReport {
  const externalEffectsEnabled = env[EXTERNAL_EFFECTS_FLAG] === "true";
  const capabilities = (Object.keys(REQUIREMENTS) as LaunchCapability[]).map((capability) => {
    const missing = REQUIREMENTS[capability].filter((name) => !configured(env, name));
    return {
      capability,
      ready: missing.length === 0,
      missing: [...missing],
      externallyEnabled: externalEffectsEnabled && missing.length === 0,
    };
  });
  return {
    externalEffectsEnabled,
    readyForExternalEffects: externalEffectsEnabled && capabilities
      .filter(({ capability }) => ["convex", "authentication", "call_policy", "realtime", "telephony"].includes(capability))
      .every(({ ready }) => ready),
    capabilities,
  };
}

export function assertCapabilityEnabled(
  capability: LaunchCapability,
  env: Environment,
): void {
  const report = launchReadiness(env);
  const readiness = report.capabilities.find((entry) => entry.capability === capability);
  if (!report.externalEffectsEnabled) {
    throw new Error(`${EXTERNAL_EFFECTS_FLAG} must be exactly true before external effects are allowed`);
  }
  if (!readiness?.ready) {
    throw new Error(`${capability} is not configured: missing ${readiness?.missing.join(", ") ?? "requirements"}`);
  }
}
