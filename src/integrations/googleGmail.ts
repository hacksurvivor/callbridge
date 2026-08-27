const GMAIL_READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_API_ENDPOINT = "https://gmail.googleapis.com/gmail/v1";

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type OAuthAttempt = {
  state: string;
  stateHash: string;
  codeVerifier: string;
  codeChallenge: string;
};

export type EncryptedSecret = {
  ciphertext: string;
  iv: string;
};

export type GmailThreadContext = {
  subject: string;
  messages: { sender: string; receivedAt: string; text: string }[];
};

type FetchLike = typeof fetch;

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return bytesToBase64Url(new Uint8Array(digest));
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return bytesToBase64Url(bytes);
}

export async function createOAuthAttempt(): Promise<OAuthAttempt> {
  const state = randomBase64Url(32);
  const codeVerifier = randomBase64Url(48);
  return {
    state,
    stateHash: await sha256(state),
    codeVerifier,
    codeChallenge: await sha256(codeVerifier),
  };
}

export async function hashOAuthState(state: string): Promise<string> {
  return await sha256(state);
}

export function buildGoogleAuthorizationUrl(input: {
  config: GoogleOAuthConfig;
  attempt: OAuthAttempt;
  loginHint?: string;
}): string {
  const url = new URL(GOOGLE_AUTH_ENDPOINT);
  url.searchParams.set("client_id", input.config.clientId);
  url.searchParams.set("redirect_uri", input.config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", GMAIL_READONLY_SCOPE);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", input.attempt.state);
  url.searchParams.set("code_challenge", input.attempt.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  if (input.loginHint?.trim()) url.searchParams.set("login_hint", input.loginHint.trim());
  return url.toString();
}

function assertOk(response: Response, operation: string): void {
  if (!response.ok) throw new Error(`${operation} failed with HTTP ${response.status}`);
}

export async function exchangeGoogleAuthorizationCode(input: {
  config: GoogleOAuthConfig;
  code: string;
  codeVerifier: string;
  fetchImpl?: FetchLike;
}): Promise<{ accessToken: string; refreshToken: string; scope: string }> {
  const response = await (input.fetchImpl ?? fetch)(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      code: input.code,
      code_verifier: input.codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: input.config.redirectUri,
    }),
  });
  assertOk(response, "Google authorization-code exchange");
  const payload = await response.json() as Record<string, unknown>;
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  const refreshToken = typeof payload.refresh_token === "string" ? payload.refresh_token : "";
  const scope = typeof payload.scope === "string" ? payload.scope : "";
  if (!accessToken || !refreshToken) throw new Error("Google did not return the required offline credentials");
  if (!scope.split(/\s+/).includes(GMAIL_READONLY_SCOPE)) throw new Error("Google did not grant gmail.readonly");
  return { accessToken, refreshToken, scope };
}

export async function refreshGoogleAccessToken(input: {
  config: GoogleOAuthConfig;
  refreshToken: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const response = await (input.fetchImpl ?? fetch)(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: input.config.clientId,
      client_secret: input.config.clientSecret,
      refresh_token: input.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  assertOk(response, "Google token refresh");
  const payload = await response.json() as Record<string, unknown>;
  const accessToken = typeof payload.access_token === "string" ? payload.access_token : "";
  if (!accessToken) throw new Error("Google did not return an access token");
  return accessToken;
}

export async function fetchGmailProfile(
  accessToken: string,
  fetchImpl: FetchLike = fetch,
): Promise<{ emailAddress: string }> {
  const response = await fetchImpl(`${GMAIL_API_ENDPOINT}/users/me/profile`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  assertOk(response, "Gmail profile read");
  const payload = await response.json() as Record<string, unknown>;
  const emailAddress = typeof payload.emailAddress === "string" ? payload.emailAddress.trim() : "";
  if (!emailAddress) throw new Error("Gmail profile did not include an email address");
  return { emailAddress };
}

type GmailPart = {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPart[];
};

function decodeBody(data: string): string {
  return new TextDecoder().decode(base64UrlToBytes(data));
}

function collectBodies(part: GmailPart | undefined, mimeType: string, output: string[]): void {
  if (!part) return;
  if (part.mimeType === mimeType && part.body?.data) output.push(decodeBody(part.body.data));
  for (const child of part.parts ?? []) collectBodies(child, mimeType, output);
}

function plainTextFromPayload(payload: GmailPart | undefined): string {
  const plain: string[] = [];
  collectBodies(payload, "text/plain", plain);
  if (plain.length > 0) return plain.join("\n");
  const html: string[] = [];
  collectBodies(payload, "text/html", html);
  return html.join("\n")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function header(headers: unknown, name: string): string {
  if (!Array.isArray(headers)) return "";
  const found = headers.find((candidate) => {
    if (!candidate || typeof candidate !== "object") return false;
    return String((candidate as Record<string, unknown>).name ?? "").toLowerCase() === name.toLowerCase();
  }) as Record<string, unknown> | undefined;
  return typeof found?.value === "string" ? found.value.trim() : "";
}

export function parseGmailThread(payload: unknown): GmailThreadContext {
  const record = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const messages = Array.isArray(record.messages) ? record.messages.slice(0, 50) : [];
  const parsed = messages.map((candidate) => {
    const message = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : {};
    const part = message.payload && typeof message.payload === "object" ? message.payload as GmailPart : undefined;
    const timestamp = typeof message.internalDate === "string" ? Number(message.internalDate) : Number.NaN;
    return {
      sender: header((part as GmailPart & { headers?: unknown })?.headers, "From") || "Unknown sender",
      receivedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : "",
      text: plainTextFromPayload(part).replace(/\s+/g, " ").trim().slice(0, 12_000),
      subject: header((part as GmailPart & { headers?: unknown })?.headers, "Subject"),
    };
  });
  return {
    subject: parsed.find((message) => message.subject)?.subject ?? "",
    messages: parsed.map(({ sender, receivedAt, text }) => ({ sender, receivedAt, text })),
  };
}

export async function fetchGmailThread(input: {
  accessToken: string;
  threadId: string;
  fetchImpl?: FetchLike;
}): Promise<GmailThreadContext> {
  const threadId = input.threadId.trim();
  if (!/^[A-Za-z0-9_-]{8,256}$/.test(threadId)) throw new Error("Gmail thread ID is invalid");
  const response = await (input.fetchImpl ?? fetch)(
    `${GMAIL_API_ENDPOINT}/users/me/threads/${encodeURIComponent(threadId)}?format=full`,
    { headers: { authorization: `Bearer ${input.accessToken}` } },
  );
  assertOk(response, "Gmail thread read");
  return parseGmailThread(await response.json());
}

async function encryptionKey(base64UrlKey: string, usage: ("encrypt" | "decrypt")[]) {
  const bytes = base64UrlToBytes(base64UrlKey.trim());
  if (bytes.byteLength !== 32) throw new Error("Connector encryption key must contain exactly 32 bytes");
  return await crypto.subtle.importKey("raw", toArrayBuffer(bytes), "AES-GCM", false, usage);
}

export async function encryptConnectorSecret(secret: string, base64UrlKey: string): Promise<EncryptedSecret> {
  if (!secret) throw new Error("Connector secret is empty");
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await encryptionKey(base64UrlKey, ["encrypt"]),
    new TextEncoder().encode(secret),
  );
  return { ciphertext: bytesToBase64Url(new Uint8Array(ciphertext)), iv: bytesToBase64Url(iv) };
}

export async function decryptConnectorSecret(
  encrypted: EncryptedSecret,
  base64UrlKey: string,
): Promise<string> {
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(base64UrlToBytes(encrypted.iv)) },
    await encryptionKey(base64UrlKey, ["decrypt"]),
    toArrayBuffer(base64UrlToBytes(encrypted.ciphertext)),
  );
  return new TextDecoder().decode(plaintext);
}

export { GMAIL_READONLY_SCOPE };
