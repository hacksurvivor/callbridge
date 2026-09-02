import { describe, expect, it } from "vitest";

import {
  TASK_ARTIFACT_TOOL_NAMES,
  artifactToolInputSchemas,
  containsCredentialLikeText,
  parseArtifactPayload,
  parseCreateArtifactPayload,
  parseWebMcpArtifactPatch,
} from "../shared/taskArtifacts.js";

describe("typed task artifact contracts", () => {
  it("defines exactly the three approved artifact tools", () => {
    expect(TASK_ARTIFACT_TOOL_NAMES).toEqual([
      "create_task_artifact",
      "update_task_artifact",
      "read_task_artifacts",
    ]);
    expect(Object.keys(artifactToolInputSchemas)).toEqual(TASK_ARTIFACT_TOOL_NAMES);
  });

  it.each([
    {
      type: "conversation",
      channel: "sms",
      title: "Provider conversation",
      participants: [{ id: "agent", displayName: "CallBridge", role: "agent" }],
    },
    {
      type: "auth_required",
      providerId: "callbridge_demo",
      providerName: "Controlled provider",
      reason: "Continue through the protected handoff.",
      continuation: "open_secure_browser",
    },
    {
      type: "user_question",
      prompt: "Which arrival window should be shared?",
      responseMode: "single_choice",
      options: [{ id: "late", label: "After midnight" }],
    },
  ])("accepts WebMCP-safe $type creation", (payload) => {
    expect(parseCreateArtifactPayload(payload)).toEqual(payload);
  });

  it("excludes evidence, provider claims, responses, arbitrary URLs, and secrets from WebMCP creation", () => {
    const forbidden = [
      { type: "evidence", kind: "screenshot", assetRef: "https://evil.example/a.png", caption: "x", capturedAt: new Date().toISOString(), provenance: "browser_capture", redactionState: "not_required" },
      { type: "auth_required", providerId: "callbridge_demo", providerName: "Demo", reason: "Continue", continuation: "open_secure_browser", redirectUrl: "https://evil.example" },
      { type: "user_question", prompt: "Question", responseMode: "text", response: { value: "Impersonated", submittedAt: new Date().toISOString() } },
      { type: "conversation", channel: "sms", title: "Thread", participants: [{ id: "provider", displayName: "Provider", role: "provider" }], providerMessage: "Fabricated" },
      { type: "auth_required", providerId: "callbridge_demo", providerName: "Demo", reason: "password=hunter2", continuation: "open_secure_browser" },
    ];
    for (const payload of forbidden) expect(() => parseCreateArtifactPayload(payload)).toThrow();
  });

  it("allows only agent draft append and non-terminal metadata updates", () => {
    expect(parseWebMcpArtifactPatch({
      type: "conversation",
      appendAgentDraft: { authorDisplayName: "CallBridge", text: "Draft reply for review." },
    })).toMatchObject({ type: "conversation" });
    for (const forbidden of [
      { type: "conversation", providerMessage: { text: "Fake provider reply" } },
      { type: "conversation", appendAgentDraft: { authorDisplayName: "CallBridge", text: "send this now" }, delivered: true },
      { type: "auth_required", state: "authorized" },
      { type: "user_question", response: { value: "Answer" } },
      { type: "evidence", caption: "Replace evidence" },
    ]) expect(() => parseWebMcpArtifactPatch(forbidden)).toThrow();
  });

  it("recognizes credential-like text without logging or returning the secret", () => {
    expect(containsCredentialLikeText("access_token=abc123456789")).toBe(true);
    expect(containsCredentialLikeText("The desk accepts arrivals after midnight.")).toBe(false);
  });

  it("accepts only allowlisted evidence references in durable projections", () => {
    const accepted = parseArtifactPayload({
      type: "evidence",
      kind: "screenshot",
      assetRef: "fixture:evidence:late-arrival-policy",
      caption: "Controlled fixture evidence.",
      capturedAt: "2026-08-31T07:00:00.000Z",
      provenance: "browser_capture",
      redactionState: "not_required",
      simulated: true,
    });
    expect(accepted.type).toBe("evidence");
    expect(() => parseArtifactPayload({ ...accepted, assetRef: "https://evil.example/evidence.png" })).toThrow();
  });
});
