import { httpActionGeneric as httpAction, httpRouter, makeFunctionReference } from "convex/server";

const processLemonSqueezyWebhook = makeFunctionReference<
  "action",
  { rawBody: string; signature: string | null },
  "applied" | "duplicate"
>("lemonSqueezyWebhook:processWebhook");
const processTelephonyCallback = makeFunctionReference<
  "action",
  { rawBody: string; signature: string | null },
  string
>("telephonyWebhook:processCallback");
const processHotelDemoEvent = makeFunctionReference<
  "action",
  { rawBody: string; signature: string | null; timestamp: string | null },
  "accepted" | "duplicate" | "buffered" | "private_only"
>("hotelDemoWebhook:processEvent");
const processInquiryWorkerCallback = makeFunctionReference<
  "action",
  { rawBody: string; signature: string | null; timestamp: string | null },
  { kind: "event" | "result"; duplicate: boolean }
>("inquiryWorkerWebhook:processCallback");
const completeGmailOAuth = makeFunctionReference<
  "action",
  { code: string; state: string },
  { emailAddress: string }
>("gmailOAuth:completeOAuth");
const registerRemoteHost = makeFunctionReference<
  "mutation",
  { hostId: string; displayName: string; secretHash: string; now: string },
  string
>("remoteBridge:registerHost");
const heartbeatRemoteHost = makeFunctionReference<
  "mutation",
  { hostId: string; secretHash: string; now: string },
  { hostId: string; displayName: string; state: "online" | "offline" | "revoked"; lastSeenAt: string }
>("remoteBridge:heartbeat");
const enqueueRemoteCommand = makeFunctionReference<
  "mutation",
  { hostId: string; secretHash: string; clientRequestId: string; kind: string; instruction?: string; now: string; expiresAt: string },
  string
>("remoteBridge:enqueueCommand");
const claimRemoteCommand = makeFunctionReference<
  "mutation",
  { hostId: string; secretHash: string; now: string },
  Record<string, unknown> | null
>("remoteBridge:claimNextCommand");
const appendRemoteCommandEvent = makeFunctionReference<
  "mutation",
  { hostId: string; secretHash: string; commandId: string; kind: "status" | "output" | "warning" | "result"; message: string; now: string },
  number
>("remoteBridge:appendCommandEvent");
const completeRemoteCommand = makeFunctionReference<
  "mutation",
  { hostId: string; secretHash: string; commandId: string; outcome: "succeeded" | "failed" | "cancelled"; summary: string; now: string },
  null
>("remoteBridge:completeCommand");
const cancelRemoteCommand = makeFunctionReference<
  "mutation",
  { hostId: string; secretHash: string; commandId: string; now: string },
  string
>("remoteBridge:requestCancellation");
const getRemoteCommandState = makeFunctionReference<
  "query",
  { hostId: string; secretHash: string; commandId: string },
  string
>("remoteBridge:getCommandState");
const listRemoteCommands = makeFunctionReference<
  "query",
  { hostId: string; secretHash: string; limit: number },
  Record<string, unknown>
>("remoteBridge:listCommands");

const http = httpRouter();

http.route({
  path: "/webhooks/lemon-squeezy",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signature = request.headers.get("x-signature");
    try {
      const result = await ctx.runAction(processLemonSqueezyWebhook, { rawBody, signature });
      return Response.json({ ok: true, result }, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Webhook rejected";
      const configurationFailure = message.includes("not configured");
      return Response.json(
        { ok: false, error: configurationFailure ? "Webhook is not configured" : "Webhook rejected" },
        { status: configurationFailure ? 503 : 401 },
      );
    }
  }),
});

const remoteResponseHeaders = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function remoteJson(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: remoteResponseHeaders });
}

function remoteError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Remote bridge request rejected";
  const code = typeof error === "object" && error !== null && "data" in error
    ? (error as { data?: { code?: unknown } }).data?.code
    : undefined;
  const unauthorized = code === "REMOTE_HOST_UNAUTHORIZED" || message.includes("REMOTE_HOST_UNAUTHORIZED");
  return remoteJson({ ok: false, error: unauthorized ? "Remote host authorization failed" : "Remote bridge request rejected" }, unauthorized ? 401 : 400);
}

async function remoteRequest(request: Request): Promise<{ body: Record<string, unknown>; secretHash: string }> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(contentLength) && contentLength > 16_384) throw new Error("Remote bridge request is too large");
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) throw new Error("REMOTE_HOST_UNAUTHORIZED");
  const secret = authorization.slice("Bearer ".length).trim();
  if (secret.length < 32 || secret.length > 512) throw new Error("REMOTE_HOST_UNAUTHORIZED");
  const rawBody = await request.text();
  if (rawBody.length > 16_384) throw new Error("Remote bridge request is too large");
  const decoded = JSON.parse(rawBody) as unknown;
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error("Remote bridge request body is invalid");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const secretHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  return { body: decoded as Record<string, unknown>, secretHash };
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string") throw new Error(`Remote bridge field ${key} is required`);
  return value;
}

http.route({
  path: "/api/remote/host/register",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const now = new Date().toISOString();
      const hostId = requiredString(body, "hostId");
      const hostRecordId = await ctx.runMutation(registerRemoteHost, {
        hostId,
        displayName: requiredString(body, "displayName"),
        secretHash,
        now,
      });
      return remoteJson({ ok: true, hostId, hostRecordId, lastSeenAt: now });
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/api/remote/host/heartbeat",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const host = await ctx.runMutation(heartbeatRemoteHost, {
        hostId: requiredString(body, "hostId"),
        secretHash,
        now: new Date().toISOString(),
      });
      return remoteJson({ ok: true, host });
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/api/remote/commands/enqueue",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const now = new Date();
      const instruction = body.instruction;
      const commandId = await ctx.runMutation(enqueueRemoteCommand, {
        hostId: requiredString(body, "hostId"),
        secretHash,
        clientRequestId: requiredString(body, "clientRequestId"),
        kind: requiredString(body, "kind"),
        ...(typeof instruction === "string" ? { instruction } : {}),
        now: now.toISOString(),
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
      });
      return remoteJson({ ok: true, commandId }, 202);
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/api/remote/commands/claim",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const command = await ctx.runMutation(claimRemoteCommand, {
        hostId: requiredString(body, "hostId"),
        secretHash,
        now: new Date().toISOString(),
      });
      return remoteJson({ ok: true, command });
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/api/remote/commands/event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const kind = requiredString(body, "kind");
      if (!(kind === "status" || kind === "output" || kind === "warning" || kind === "result")) throw new Error("Remote event kind is invalid");
      const sequence = await ctx.runMutation(appendRemoteCommandEvent, {
        hostId: requiredString(body, "hostId"),
        secretHash,
        commandId: requiredString(body, "commandId"),
        kind,
        message: requiredString(body, "message"),
        now: new Date().toISOString(),
      });
      return remoteJson({ ok: true, sequence });
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/api/remote/commands/complete",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const outcome = requiredString(body, "outcome");
      if (!(outcome === "succeeded" || outcome === "failed" || outcome === "cancelled")) throw new Error("Remote outcome is invalid");
      await ctx.runMutation(completeRemoteCommand, {
        hostId: requiredString(body, "hostId"),
        secretHash,
        commandId: requiredString(body, "commandId"),
        outcome,
        summary: requiredString(body, "summary"),
        now: new Date().toISOString(),
      });
      return remoteJson({ ok: true });
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/api/remote/commands/cancel",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const state = await ctx.runMutation(cancelRemoteCommand, {
        hostId: requiredString(body, "hostId"),
        secretHash,
        commandId: requiredString(body, "commandId"),
        now: new Date().toISOString(),
      });
      return remoteJson({ ok: true, state });
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/api/remote/commands/state",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const state = await ctx.runQuery(getRemoteCommandState, {
        hostId: requiredString(body, "hostId"),
        secretHash,
        commandId: requiredString(body, "commandId"),
      });
      return remoteJson({ ok: true, state });
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/api/remote/commands/list",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const { body, secretHash } = await remoteRequest(request);
      const limitValue = body.limit;
      const result = await ctx.runQuery(listRemoteCommands, {
        hostId: requiredString(body, "hostId"),
        secretHash,
        limit: typeof limitValue === "number" ? limitValue : 20,
      });
      return remoteJson({ ok: true, ...result });
    } catch (error) {
      return remoteError(error);
    }
  }),
});

http.route({
  path: "/webhooks/inquiry-worker",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    try {
      const result = await ctx.runAction(processInquiryWorkerCallback, {
        rawBody,
        signature: request.headers.get("x-callbridge-signature"),
        timestamp: request.headers.get("x-callbridge-timestamp"),
      });
      return Response.json({ ok: true, result }, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Callback rejected";
      const configurationFailure = message.includes("not configured");
      return Response.json(
        { ok: false, error: configurationFailure ? "Inquiry worker webhook is not configured" : "Callback rejected" },
        { status: configurationFailure ? 503 : 401 },
      );
    }
  }),
});

http.route({
  path: "/webhooks/telephony",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    const signature = request.headers.get("x-callbridge-signature");
    try {
      const taskId = await ctx.runAction(processTelephonyCallback, { rawBody, signature });
      return Response.json({ ok: true, taskId }, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Callback rejected";
      const configurationFailure = message.includes("not configured");
      return Response.json(
        { ok: false, error: configurationFailure ? "Telephony callback is not configured" : "Callback rejected" },
        { status: configurationFailure ? 503 : 401 },
      );
    }
  }),
});

http.route({
  path: "/webhooks/hotel-demo-event",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const rawBody = await request.text();
    try {
      const result = await ctx.runAction(processHotelDemoEvent, {
        rawBody,
        signature: request.headers.get("x-callbridge-signature"),
        timestamp: request.headers.get("x-callbridge-timestamp"),
      });
      return Response.json({ ok: true, result }, { status: 200 });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Event rejected";
      const configurationFailure = message.includes("not configured");
      return Response.json(
        { ok: false, error: configurationFailure ? "Hotel demo webhook is not configured" : "Event rejected" },
        { status: configurationFailure ? 503 : 401 },
      );
    }
  }),
});

function oauthPage(title: string, message: string, status = 200): Response {
  const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character] ?? character);
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title></head><body><main><h1>${escape(title)}</h1><p>${escape(message)}</p><p>You can close this window and return to Concierge.</p></main></body></html>`;
  return new Response(body, {
    status,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
    },
  });
}

http.route({
  path: "/oauth/google/callback",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const providerError = url.searchParams.get("error");
    if (providerError) return oauthPage("Gmail was not connected", `Google returned: ${providerError}`, 400);
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    if (!code || !state) return oauthPage("Gmail was not connected", "The OAuth callback was incomplete.", 400);
    try {
      const result = await ctx.runAction(completeGmailOAuth, { code, state });
      return oauthPage("Gmail connected", `${result.emailAddress} is available to Concierge in read-only mode.`);
    } catch {
      return oauthPage("Gmail was not connected", "The authorization was invalid, expired, or could not be completed.", 400);
    }
  }),
});

export default http;
