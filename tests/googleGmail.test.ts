import { describe, expect, it } from "vitest";

import {
  buildGoogleAuthorizationUrl,
  createOAuthAttempt,
  decryptConnectorSecret,
  encryptConnectorSecret,
  parseGmailThread,
} from "../src/integrations/googleGmail.js";

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

describe("Google Gmail read-only connector", () => {
  it("builds an offline, PKCE-protected, read-only authorization request", async () => {
    const attempt = await createOAuthAttempt();
    const url = new URL(buildGoogleAuthorizationUrl({
      config: { clientId: "client", clientSecret: "secret", redirectUri: "https://example.test/oauth/google/callback" },
      attempt,
    }));

    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/gmail.readonly");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe(attempt.state);
  });

  it("encrypts refresh tokens at rest", async () => {
    const key = Buffer.alloc(32, 7).toString("base64url");
    const encrypted = await encryptConnectorSecret("refresh-token", key);
    expect(encrypted.ciphertext).not.toContain("refresh-token");
    await expect(decryptConnectorSecret(encrypted, key)).resolves.toBe("refresh-token");
  });

  it("parses a bounded plain-text Gmail thread", () => {
    const result = parseGmailThread({
      messages: [{
        internalDate: "1700000000000",
        payload: {
          mimeType: "multipart/alternative",
          headers: [{ name: "From", value: "Hotel <hotel@example.com>" }, { name: "Subject", value: "Your stay" }],
          parts: [{ mimeType: "text/plain", body: { data: base64Url("Breakfast is included.") } }],
        },
      }],
    });
    expect(result).toMatchObject({
      subject: "Your stay",
      messages: [{ sender: "Hotel <hotel@example.com>", text: "Breakfast is included." }],
    });
  });
});
