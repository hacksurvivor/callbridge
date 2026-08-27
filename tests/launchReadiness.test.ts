import { describe, expect, it } from "vitest";

import {
  assertCapabilityEnabled,
  launchReadiness,
} from "../src/application/launchReadiness.js";

describe("launch readiness", () => {
  it("fails closed even when credentials exist but the effects flag is off", () => {
    const env = {
      CALLBRIDGE_EXTERNAL_EFFECTS_ENABLED: "false",
      OPENAI_API_KEY: "present",
      CALLBRIDGE_REALTIME_MODEL: "model",
    };
    expect(launchReadiness(env).capabilities.find(({ capability }) => capability === "realtime")).toMatchObject({
      ready: true,
      externallyEnabled: false,
    });
    expect(() => assertCapabilityEnabled("realtime", env)).toThrow("must be exactly true");
  });

  it("reports missing names without exposing configured values", () => {
    const report = launchReadiness({ CALLBRIDGE_EXTERNAL_EFFECTS_ENABLED: "true" });
    expect(report.readyForExternalEffects).toBe(false);
    expect(report.capabilities.find(({ capability }) => capability === "telephony")?.missing).toEqual([
      "CALLBRIDGE_TELEPHONY_PROVIDER",
      "CALLBRIDGE_TELEPHONY_DISPATCH_URL",
      "CALLBRIDGE_TELEPHONY_API_KEY",
      "CALLBRIDGE_TELEPHONY_WEBHOOK_SECRET",
    ]);
    expect(JSON.stringify(report)).not.toContain("API_KEY=");
  });

  it("enables only the configured capability after the global gate", () => {
    const env = {
      CALLBRIDGE_EXTERNAL_EFFECTS_ENABLED: "true",
      LEMON_SQUEEZY_WEBHOOK_SECRET: "present",
    };
    expect(() => assertCapabilityEnabled("billing_webhook", env)).not.toThrow();
    expect(() => assertCapabilityEnabled("realtime", env)).toThrow("OPENAI_API_KEY");
  });
});
