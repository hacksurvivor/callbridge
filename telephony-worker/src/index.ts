import { DurableObject } from "cloudflare:workers";

import { escapeXml } from "./policy";
import { decimalToMinorUnits } from "../../shared/inquiryPricing.js";
import {
  InquiryRealtimeController,
  buildRealtimeSessionUpdate,
  validateInquiryDispatchRequest,
  type InquiryDispatchRequest,
  type InquiryRealtimeSnapshot,
  type RealtimeCommand,
} from "./inquiryRealtime.js";
import {
  buildDecisionReadyResult,
  deliverInquiryWorkerCallback,
  readTwilioReportedCost,
  type InquiryExtraction,
} from "./inquiryResult.js";
import { analyzeInquiryTranscript, formatInquiryTranscript } from "./inquiryExtraction.js";
import type { InquiryCallResult } from "../../shared/inquiryState.js";
import type {
  InquiryWorkerCostCallback,
  InquiryWorkerEventCallback,
  InquiryWorkerResultCallback,
} from "../../shared/inquiryWorkerCallbacks.js";
import {
  loadInternationalCallingPolicy,
  quoteTwilioVoiceCall,
  type TwilioVoiceQuote,
} from "./internationalCalling";
import { ensureTwilioLowRiskDialingPermission } from "./twilioDialingPermissions";
import {
  DemoHotelRecipient,
  cancelDemoHotelAdmission,
  demoHotelHealth,
  demoHotelSessionPath,
  handleDemoHotelVoiceWebhook,
  reserveDemoHotelAdmission,
  validTwilioFormSignature,
  type DemoHotelEnv,
} from "./demoHotelRecipient.js";

type Env = DemoHotelEnv & {
  CALL_SESSIONS: DurableObjectNamespace<CallSession>;
  EXTERNAL_EFFECTS_ENABLED: string;
  OPENAI_API_KEY: string;
  OPENAI_REALTIME_MODEL: string;
  OPENAI_SUMMARY_MODEL: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_API_KEY: string;
  TWILIO_API_KEY_SECRET: string;
  TWILIO_CONTROL_API_KEY: string;
  TWILIO_CONTROL_API_KEY_SECRET: string;
  TWILIO_FROM_NUMBER: string;
  CALLBRIDGE_BLOCKED_CALL_COUNTRIES?: string;
  CALLBRIDGE_MANUAL_REVIEW_COUNTRIES?: string;
  CALLBRIDGE_MAX_PSTN_RATE_USD?: string;
  CALLBRIDGE_MAX_PSTN_CALL_USD?: string;
  DISPATCH_API_KEY: string;
  CALLBACK_HMAC_SECRET: string;
  CALLBACK_URL: string;
};

type StoredSession = {
  request: InquiryDispatchRequest;
  destination: string;
  streamToken: string;
  callSid?: string;
  creationState: "configured" | "creating" | "accepted" | "definitely_not_created";
  realtimeSnapshot?: InquiryRealtimeSnapshot;
  nextWorkerSequence?: number;
  deliveredCallbackKeys?: string[];
  completionDelivered?: boolean;
  terminalReason?: InquiryCallResult["terminalReason"];
  pendingWorkerEvent?: { logicalKey: string; callback: InquiryWorkerEventCallback };
  analysisPrepared?: boolean;
  preparedExtraction?: InquiryExtraction | null;
  resultTerminalAt?: string;
  pendingResultCallback?: InquiryWorkerResultCallback;
  pendingCostReconciliation?: { resultKey: string; attempts: number };
};

export function scrubStoredRealtimeSnapshot(snapshot: InquiryRealtimeSnapshot | undefined): InquiryRealtimeSnapshot | undefined {
  return snapshot ? { ...snapshot, rawTurns: [], rawTurnBytes: 0 } : undefined;
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function authorized(request: Request, secret: string): boolean {
  const value = request.headers.get("authorization");
  return Boolean(secret && value === `Bearer ${secret}`);
}

type SafeRealtimeError = {
  type?: string;
  code?: string;
  message?: string;
  param?: string;
};

function safeRealtimeError(value: unknown): SafeRealtimeError | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const text = (key: keyof SafeRealtimeError): string | undefined => {
    const candidate = record[key];
    return typeof candidate === "string" ? candidate.slice(0, 240) : undefined;
  };
  return {
    ...(text("type") ? { type: text("type") } : {}),
    ...(text("code") ? { code: text("code") } : {}),
    ...(text("message") ? { message: text("message") } : {}),
    ...(text("param") ? { param: text("param") } : {}),
  };
}

async function realtimeSmoke(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env.DISPATCH_API_KEY)) return json({ error: "unauthorized" }, 401);
  if (!env.OPENAI_API_KEY || !env.OPENAI_REALTIME_MODEL) return json({ ok: false, stage: "configuration" }, 503);
  let response: Response;
  try {
    response = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(env.OPENAI_REALTIME_MODEL)}`, {
      headers: {
        authorization: `Bearer ${env.OPENAI_API_KEY}`,
        upgrade: "websocket",
        "OpenAI-Safety-Identifier": "callbridge-internal-realtime-smoke",
      },
    });
  } catch {
    return json({ ok: false, stage: "upgrade_fetch" }, 502);
  }
  const socket = response.webSocket;
  if (response.status !== 101 || !socket) return json({ ok: false, stage: "upgrade", status: response.status }, 502);
  socket.accept();
  const eventTypes: string[] = [];
  return await new Promise<Response>((resolve) => {
    let settled = false;
    const finish = (body: Record<string, unknown>, status = 200): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(1000, "smoke complete"); } catch { /* already closed */ }
      resolve(json({ model: env.OPENAI_REALTIME_MODEL, eventTypes, ...body }, status));
    };
    const timer = setTimeout(() => finish({ ok: false, stage: "first_audio_timeout" }, 504), 12_000);
    socket.addEventListener("message", (message) => {
      let event: { type?: string; error?: unknown };
      try { event = JSON.parse(String(message.data)); } catch { return; }
      if (event.type && eventTypes.length < 32 && !eventTypes.includes(event.type)) eventTypes.push(event.type);
      if (event.type === "session.updated") {
        socket.send(JSON.stringify({
          type: "response.create",
          response: { instructions: "Say exactly: Realtime bridge ready." },
        }));
      } else if (event.type === "response.output_audio.delta" || event.type === "response.audio.delta") {
        finish({ ok: true, stage: "first_audio" });
      } else if (event.type === "error") {
        finish({ ok: false, stage: "provider_error", error: safeRealtimeError(event.error) }, 502);
      }
    });
    socket.addEventListener("close", (event) => finish({
      ok: false,
      stage: "socket_closed",
      closeCode: event.code,
      wasClean: event.wasClean,
    }, 502));
    socket.addEventListener("error", () => finish({ ok: false, stage: "socket_error" }, 502));
    socket.send(JSON.stringify({
      type: "session.update",
      session: {
        type: "realtime",
        model: env.OPENAI_REALTIME_MODEL,
        output_modalities: ["audio"],
        instructions: "This is an internal connectivity test. Return only the requested phrase.",
        reasoning: { effort: "low" },
        truncation: {
          type: "retention_ratio",
          retention_ratio: 0.8,
          token_limits: { post_instructions: 8_000 },
        },
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: { model: "gpt-4o-transcribe", language: "en" },
            noise_reduction: { type: "near_field" },
            turn_detection: { type: "server_vad", create_response: false, interrupt_response: true },
          },
          output: { format: { type: "audio/pcmu" }, voice: "marin" },
        },
        tools: [],
        tool_choice: "none",
      },
    }));
  });
}

function mediaStreamPath(dispatchId: string, streamToken: string): string {
  return `/media-stream/${encodeURIComponent(dispatchId)}/${encodeURIComponent(streamToken)}`;
}

function parseMediaStreamPath(pathname: string): { dispatchId: string; streamToken: string } | null {
  const segments = pathname.split("/");
  if (segments.length !== 4 || segments[0] !== "" || segments[1] !== "media-stream") return null;
  try {
    const dispatchId = decodeURIComponent(segments[2] ?? "");
    const streamToken = decodeURIComponent(segments[3] ?? "");
    return dispatchId && streamToken ? { dispatchId, streamToken } : null;
  } catch {
    return null;
  }
}

export function terminalReasonForSocketClose(channel: "twilio" | "openai"): InquiryCallResult["terminalReason"] {
  return channel === "twilio" ? "remote_hangup" : "provider_failure";
}

export function terminalReasonForTwilioStatus(status: string): InquiryCallResult["terminalReason"] | null {
  if (status === "busy" || status === "no-answer") return "no_answer";
  if (status === "failed" || status === "canceled") return "provider_failure";
  if (status === "completed") return "remote_hangup";
  return null;
}

export function shouldAnalyzeProviderTranscript(providerTurns: readonly string[]): boolean {
  return providerTurns.some((turn) => turn.trim().length > 0);
}

export function connectedDurationSeconds(connectedAtMs: number, terminalAt: string): number {
  const terminalAtMs = Date.parse(terminalAt);
  if (!Number.isFinite(connectedAtMs) || !Number.isFinite(terminalAtMs)) return 0;
  return Math.max(0, (terminalAtMs - connectedAtMs) / 1_000);
}

class ProviderRejectedBeforeCreation extends Error {}
class ProviderCreationUncertain extends Error {}

async function createTwilioCall(input: {
  env: Env;
  to: string;
  twiml: string;
  statusCallbackUrl: string;
}): Promise<string> {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.env.TWILIO_ACCOUNT_SID)}/Calls.json`;
  const body = new URLSearchParams({
    To: input.to,
    From: input.env.TWILIO_FROM_NUMBER,
    Twiml: input.twiml,
    StatusCallback: input.statusCallbackUrl,
    StatusCallbackMethod: "POST",
  });
  for (const event of ["initiated", "ringing", "answered", "completed"]) body.append("StatusCallbackEvent", event);
  const auth = btoa(`${input.env.TWILIO_API_KEY}:${input.env.TWILIO_API_KEY_SECRET}`);
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch {
    throw new ProviderCreationUncertain("Twilio call creation outcome is unknown");
  }
  let data: { sid?: string; message?: string };
  try {
    data = await response.json<{ sid?: string; message?: string }>();
  } catch {
    if (!response.ok) throw new ProviderRejectedBeforeCreation(`Twilio rejected call creation (${response.status})`);
    throw new ProviderCreationUncertain("Twilio returned an unreadable successful call-creation response");
  }
  if (!response.ok) throw new ProviderRejectedBeforeCreation(`Twilio rejected call creation (${response.status})`);
  if (!data.sid) throw new ProviderCreationUncertain("Twilio accepted call creation without returning a call SID");
  return data.sid;
}

async function quoteCall(env: Env, to: string, maximumConnectedSeconds: number): Promise<TwilioVoiceQuote> {
  return await quoteTwilioVoiceCall({
    accountSid: env.TWILIO_ACCOUNT_SID,
    apiKey: env.TWILIO_CONTROL_API_KEY,
    apiKeySecret: env.TWILIO_CONTROL_API_KEY_SECRET,
    from: env.TWILIO_FROM_NUMBER,
    to,
    maximumConnectedSeconds,
    policy: loadInternationalCallingPolicy(env),
  });
}

function assertQuoteFitsConfirmedContract(quote: TwilioVoiceQuote, request: InquiryDispatchRequest): void {
  if (quote.destination.isoCountry !== request.contract.destination.countryCode) {
    throw new Error("destination_country_mismatch");
  }
  if (quote.pstn.currency !== request.contract.costCeiling.currency) {
    throw new Error("pricing_currency_mismatch");
  }
  if (decimalToMinorUnits(quote.pstn.estimatedMaximumCharge) > request.contract.costCeiling.maxTotalMinorUnits) {
    throw new Error("cost_ceiling_exceeded");
  }
}

async function pricingQuote(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env.DISPATCH_API_KEY)) return json({ error: "unauthorized" }, 401);
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_CONTROL_API_KEY || !env.TWILIO_CONTROL_API_KEY_SECRET || !env.TWILIO_FROM_NUMBER) {
    return json({ error: "twilio_not_configured" }, 503);
  }
  const input = await request.json<{ to?: string; maximumConnectedSeconds?: number }>();
  if (!input.to || !/^\+[1-9]\d{7,14}$/.test(input.to)) return json({ error: "invalid_destination" }, 400);
  try {
    return json(await quoteCall(env, input.to, input.maximumConnectedSeconds ?? 180));
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : "pricing_failed" }, 422);
  }
}

async function dispatch(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env.DISPATCH_API_KEY)) {
    return json({ creationState: "definitely_not_created", error: "unauthorized" }, 401);
  }
  if (env.EXTERNAL_EFFECTS_ENABLED !== "true") {
    return json({ creationState: "definitely_not_created", error: "external_effects_disabled" }, 503);
  }
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_API_KEY || !env.TWILIO_API_KEY_SECRET || !env.TWILIO_FROM_NUMBER) {
    return json({ creationState: "definitely_not_created", error: "twilio_not_configured" }, 503);
  }
  let input: InquiryDispatchRequest;
  try {
    input = validateInquiryDispatchRequest(await request.json<unknown>());
  } catch (error) {
    return json({ creationState: "definitely_not_created", error: error instanceof Error ? error.message : "invalid_dispatch" }, 400);
  }
  const headerIdempotencyKey = request.headers.get("idempotency-key")?.trim();
  if (!headerIdempotencyKey || headerIdempotencyKey !== input.dispatchIdempotencyKey) {
    return json({ creationState: "definitely_not_created", error: "idempotency_key_mismatch" }, 400);
  }
  const destination = input.contract.destination.e164PhoneNumber;
  const usesControlledDemoRecipient = env.DEMO_HOTEL_ENABLED === "true" && destination === env.DEMO_HOTEL_NUMBER;
  let quote: TwilioVoiceQuote;
  try {
    quote = await quoteCall(env, destination, input.contract.policy.maxConnectedSeconds);
    assertQuoteFitsConfirmedContract(quote, input);
  } catch (error) {
    return json({ creationState: "definitely_not_created", error: error instanceof Error ? error.message : "pricing_failed" }, 422);
  }
  const id = env.CALL_SESSIONS.idFromName(input.dispatchIdempotencyKey);
  const session = env.CALL_SESSIONS.get(id);
  let configured: Awaited<ReturnType<CallSession["configure"]>>;
  try {
    configured = await session.configure(input, destination);
  } catch (error) {
    return json({ creationState: "definitely_not_created", error: error instanceof Error ? error.message : "session_configuration_failed" }, 409);
  }
  if (configured.callSid) return json({ creationState: "accepted", externalCallId: configured.callSid, externalSessionId: configured.callSid, quote });
  if (configured.creationState === "creating") {
    return json({ creationState: "creation_uncertain", error: "provider_creation_outcome_requires_reconciliation" }, 409);
  }
  if (configured.creationState === "definitely_not_created") {
    return json({ creationState: "definitely_not_created", error: "provider_rejected_before_creation" }, 409);
  }

  let dialingPermission: Awaited<ReturnType<typeof ensureTwilioLowRiskDialingPermission>>;
  try {
    dialingPermission = await ensureTwilioLowRiskDialingPermission({
      quote,
      apiKey: env.TWILIO_CONTROL_API_KEY,
      apiKeySecret: env.TWILIO_CONTROL_API_KEY_SECRET,
    });
  } catch (error) {
    return json({ creationState: "definitely_not_created", error: error instanceof Error ? error.message : "dialing_permission_failed" }, 422);
  }

  if (usesControlledDemoRecipient) {
    const admission = await reserveDemoHotelAdmission({
      env,
      taskId: input.taskId,
      attemptId: input.attemptId,
      expectedTo: destination,
    });
    if (!admission.accepted) {
      return json({ creationState: "definitely_not_created", error: admission.error }, 409);
    }
  }

  const origin = new URL(request.url).origin.replace(/^http/, "ws");
  const streamUrl = `${origin}${mediaStreamPath(input.dispatchIdempotencyKey, configured.streamToken)}`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeXml(streamUrl)}" /></Connect></Response>`;
  const statusCallbackUrl = `${new URL(request.url).origin}/twilio/status/${encodeURIComponent(input.dispatchIdempotencyKey)}/${encodeURIComponent(configured.streamToken)}`;
  await session.beginCallCreation();
  try {
    const callSid = await createTwilioCall({ env, to: destination, twiml, statusCallbackUrl });
    await session.recordCallSid(callSid);
    return json({ creationState: "accepted", externalCallId: callSid, externalSessionId: callSid, quote, dialingPermission }, 201);
  } catch (error) {
    if (error instanceof ProviderRejectedBeforeCreation) {
      if (usesControlledDemoRecipient) await cancelDemoHotelAdmission(env, input.taskId, input.attemptId);
      await session.recordDefinitelyNotCreated();
      return json({ creationState: "definitely_not_created", error: error.message }, 422);
    }
    return json({ creationState: "creation_uncertain", error: "provider_creation_outcome_requires_reconciliation" }, 502);
  }
}

function parseTwilioStatusPath(pathname: string): { dispatchId: string; streamToken: string } | null {
  const match = pathname.match(/^\/twilio\/status\/([^/]+)\/([^/]+)$/);
  if (!match) return null;
  try {
    const dispatchId = decodeURIComponent(match[1]!);
    const streamToken = decodeURIComponent(match[2]!);
    return dispatchId && streamToken ? { dispatchId, streamToken } : null;
  } catch {
    return null;
  }
}

async function handleTwilioStatusCallback(request: Request, env: Env, path: { dispatchId: string; streamToken: string }): Promise<Response> {
  if (!env.TWILIO_AUTH_TOKEN) return new Response("Forbidden", { status: 403 });
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const raw = await request.text();
  const form = new URLSearchParams(raw);
  if (!signature || !await validTwilioFormSignature({ url: request.url, form, authToken: env.TWILIO_AUTH_TOKEN, signature })) {
    return new Response("Forbidden", { status: 403 });
  }
  const callSid = form.get("CallSid")?.trim() ?? "";
  const status = form.get("CallStatus")?.trim().toLowerCase() ?? "";
  if (!/^CA[0-9a-f]{32}$/i.test(callSid) || !status) return new Response("Bad Request", { status: 400 });
  const session = env.CALL_SESSIONS.get(env.CALL_SESSIONS.idFromName(path.dispatchId));
  const accepted = await session.recordProviderStatus({ streamToken: path.streamToken, callSid, status });
  return new Response(null, { status: accepted ? 204 : 409 });
}

async function reconcileTwilioCall(request: Request, env: Env): Promise<Response> {
  if (!authorized(request, env.DISPATCH_API_KEY)) return json({ error: "unauthorized" }, 401);
  const input: { dispatchIdempotencyKey?: string } = await request.json<{ dispatchIdempotencyKey?: string }>().catch(() => ({}));
  const dispatchId = input.dispatchIdempotencyKey?.trim() ?? "";
  if (!dispatchId || dispatchId.length > 200) return json({ error: "invalid_dispatch_id" }, 400);
  const session = env.CALL_SESSIONS.get(env.CALL_SESSIONS.idFromName(dispatchId));
  return json(await session.reconcileProviderStatus());
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      let callingPolicyConfigured = false;
      try {
        loadInternationalCallingPolicy(env);
        callingPolicyConfigured = true;
      } catch {
        callingPolicyConfigured = false;
      }
      return json({
        service: "callbridge-telephony",
        effectsEnabled: env.EXTERNAL_EFFECTS_ENABLED === "true",
        twilioConfigured: Boolean(env.TWILIO_ACCOUNT_SID && env.TWILIO_API_KEY && env.TWILIO_API_KEY_SECRET && env.TWILIO_FROM_NUMBER),
        twilioControlPlaneConfigured: Boolean(env.TWILIO_CONTROL_API_KEY && env.TWILIO_CONTROL_API_KEY_SECRET),
        callingPolicyConfigured,
        destinationPolicy: "provider_supported_just_in_time_low_risk",
        rateTransparency: "twilio_voice_number_pricing_api_v2_with_public_retail_fallback",
      });
    }
    if (request.method === "POST" && url.pathname === "/pricing-quote") return await pricingQuote(request, env);
    if (request.method === "POST" && url.pathname === "/dispatch") return await dispatch(request, env);
    if (request.method === "POST" && url.pathname === "/demo-hotel/voice") return await handleDemoHotelVoiceWebhook(request, env);
    if (request.method === "POST" && url.pathname === "/internal/reconcile-twilio-call") return await reconcileTwilioCall(request, env);
    if (request.method === "POST" && url.pathname === "/internal/realtime-smoke") return await realtimeSmoke(request, env);
    const twilioStatus = parseTwilioStatusPath(url.pathname);
    if (request.method === "POST" && twilioStatus) return await handleTwilioStatusCallback(request, env, twilioStatus);
    if (request.method === "GET" && url.pathname === "/internal/demo-hotel/health") {
      if (!authorized(request, env.DISPATCH_API_KEY)) return json({ error: "unauthorized" }, 401);
      return await demoHotelHealth(env);
    }
    const demoHotelSession = demoHotelSessionPath(url.pathname);
    if (request.method === "GET" && demoHotelSession && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const object = env.DEMO_HOTEL_RECIPIENT.get(env.DEMO_HOTEL_RECIPIENT.idFromName("aurora-demo-hotel-v1"));
      return await object.fetch(new Request(`${url.origin}/session/${encodeURIComponent(demoHotelSession.callSid)}/${encodeURIComponent(demoHotelSession.nonce)}`, request));
    }
    const mediaStream = parseMediaStreamPath(url.pathname);
    if (request.method === "GET" && mediaStream && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      return await env.CALL_SESSIONS.get(env.CALL_SESSIONS.idFromName(mediaStream.dispatchId)).fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

export { DemoHotelRecipient };

export class CallSession extends DurableObject<Env> {
  private twilio?: WebSocket;
  private openai?: WebSocket;
  private streamSid?: string;
  private controller?: InquiryRealtimeController;
  private openaiSessionConfigured = false;
  private firstAssistantAudioForwarded = false;
  private queuedInputAudio: string[] = [];
  private timeoutTimer?: ReturnType<typeof setTimeout>;
  private callbackStarted = false;
  private callbackTail: Promise<unknown> = Promise.resolve();

  async alarm(): Promise<void> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    if (!session) return;
    if (session.pendingWorkerEvent) {
      try {
        await this.deliverPreparedWorkerEvent(session);
      } catch (error) {
        this.logBackgroundFailure(session, "worker_event_delivery_failed", error);
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        return;
      }
    }
    const afterEvent = await this.ctx.storage.get<StoredSession>("session");
    if (afterEvent?.terminalReason && !afterEvent.completionDelivered && !afterEvent.pendingResultCallback) {
      try {
        await this.sendCallback(afterEvent);
      } catch (error) {
        this.logBackgroundFailure(afterEvent, "result_preparation_failed", error);
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        return;
      }
    }
    const afterPreparation = await this.ctx.storage.get<StoredSession>("session");
    if (afterPreparation?.pendingResultCallback && !afterPreparation.completionDelivered) {
      try {
        await this.deliverPreparedResult(afterPreparation);
      } catch (error) {
        this.logBackgroundFailure(afterPreparation, "result_delivery_failed", error);
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        return;
      }
    }
    const latest = await this.ctx.storage.get<StoredSession>("session");
    if (latest?.pendingCostReconciliation) await this.reconcilePendingCost(latest);
  }

  async configure(request: InquiryDispatchRequest, destination: string): Promise<{ streamToken: string; callSid?: string; creationState: StoredSession["creationState"] }> {
    const validated = validateInquiryDispatchRequest(request);
    const existing = await this.ctx.storage.get<StoredSession>("session");
    if (existing) {
      if (
        existing.request.taskId !== validated.taskId ||
        existing.request.attemptId !== validated.attemptId ||
        existing.request.confirmedExecutionRevision !== validated.confirmedExecutionRevision ||
        existing.request.dispatchIdempotencyKey !== validated.dispatchIdempotencyKey
      ) {
        throw new Error("Idempotency key is already bound to a different task revision");
      }
      return existing.callSid
        ? { streamToken: existing.streamToken, callSid: existing.callSid, creationState: "accepted" }
        : { streamToken: existing.streamToken, creationState: existing.creationState };
    }
    const streamToken = crypto.randomUUID();
    await this.ctx.storage.put("session", {
      request: validated,
      destination,
      streamToken,
      creationState: "configured",
      nextWorkerSequence: 1,
      deliveredCallbackKeys: [],
    } satisfies StoredSession);
    return { streamToken, creationState: "configured" };
  }

  async beginCallCreation(): Promise<void> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    if (!session || session.creationState !== "configured") throw new Error("Call session is not ready for provider creation");
    await this.ctx.storage.put("session", { ...session, creationState: "creating" } satisfies StoredSession);
  }

  async recordCallSid(callSid: string): Promise<void> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    if (!session) throw new Error("Call session is not configured");
    if (session.callSid && session.callSid !== callSid) throw new Error("Call session already has a different SID");
    await this.ctx.storage.put("session", { ...session, callSid, creationState: "accepted" } satisfies StoredSession);
  }

  async recordProviderStatus(input: { streamToken: string; callSid: string; status: string }): Promise<boolean> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    if (!session || input.streamToken !== session.streamToken || (session.callSid && input.callSid !== session.callSid)) return false;
    const updated = {
      ...session,
      callSid: input.callSid,
      creationState: "accepted" as const,
    } satisfies StoredSession;
    await this.ctx.storage.put("session", updated);
    const terminalReason = terminalReasonForTwilioStatus(input.status);
    if (terminalReason && !updated.terminalReason && !updated.completionDelivered) this.finish(updated, terminalReason);
    return true;
  }

  async reconcileProviderStatus(): Promise<{ reconciled: boolean; status?: string; terminalReason?: InquiryCallResult["terminalReason"]; error?: string }> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    if (!session?.callSid) return { reconciled: false, error: "call_sid_unavailable" };
    const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.env.TWILIO_ACCOUNT_SID)}/Calls/${encodeURIComponent(session.callSid)}.json`;
    const auth = btoa(`${this.env.TWILIO_API_KEY}:${this.env.TWILIO_API_KEY_SECRET}`);
    const response = await fetch(endpoint, { headers: { authorization: `Basic ${auth}` } });
    if (!response.ok) return { reconciled: false, error: `twilio_status_read_failed_${response.status}` };
    const data: { status?: string } = await response.json<{ status?: string }>().catch(() => ({}));
    const status = data.status?.trim().toLowerCase() ?? "";
    if (!status) return { reconciled: false, error: "twilio_status_unavailable" };
    const terminalReason = terminalReasonForTwilioStatus(status);
    await this.recordProviderStatus({ streamToken: session.streamToken, callSid: session.callSid, status });
    return terminalReason ? { reconciled: true, status, terminalReason } : { reconciled: false, status };
  }

  async recordDefinitelyNotCreated(): Promise<void> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    if (!session || session.callSid) throw new Error("Created calls cannot be marked absent");
    await this.ctx.storage.put("session", { ...session, creationState: "definitely_not_created" } satisfies StoredSession);
  }

  async fetch(request: Request): Promise<Response> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    const mediaStream = parseMediaStreamPath(new URL(request.url).pathname);
    if (!session || !mediaStream || mediaStream.streamToken !== session.streamToken) return new Response("Forbidden", { status: 403 });
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    server.accept();
    this.twilio = server;
    this.controller = new InquiryRealtimeController({
      request: session.request,
      connectedAtMs: Date.now(),
      ...(session.realtimeSnapshot ? { snapshot: session.realtimeSnapshot } : {}),
    });
    server.addEventListener("message", (event) => this.ctx.waitUntil(this.onTwilioMessage(String(event.data), session)));
    server.addEventListener("close", () => this.finish(session, terminalReasonForSocketClose("twilio")));
    server.addEventListener("error", () => this.finish(session, "provider_failure"));
    this.ctx.waitUntil(this.connectOpenAI(session).catch(() => this.finish(session, "provider_failure")));
    this.scheduleTimeoutCheck(session);
    return new Response(null, { status: 101, webSocket: client });
  }

  private async connectOpenAI(session: StoredSession): Promise<void> {
    const response = await fetch(`https://api.openai.com/v1/realtime?model=${encodeURIComponent(this.env.OPENAI_REALTIME_MODEL)}`, {
      headers: { authorization: `Bearer ${this.env.OPENAI_API_KEY}`, upgrade: "websocket", "OpenAI-Safety-Identifier": await this.safetyId(session.request.ownerId) },
    });
    const socket = response.webSocket;
    if (response.status !== 101 || !socket) throw new Error(`OpenAI Realtime upgrade failed (${response.status})`);
    socket.accept();
    this.openai = socket;
    socket.addEventListener("message", (event) => this.ctx.waitUntil(this.onOpenAIMessage(String(event.data), session)));
    socket.addEventListener("close", (event) => {
      console.log(JSON.stringify({
        event: "realtime_socket_closed",
        occurredAt: new Date().toISOString(),
        attemptId: session.request.attemptId,
        code: event.code,
        wasClean: event.wasClean,
      }));
      this.finish(session, terminalReasonForSocketClose("openai"));
    });
    socket.addEventListener("error", () => this.finish(session, "provider_failure"));
    await this.maybeConfigureOpenAI(session);
  }

  private async safetyId(ownerId: string): Promise<string> {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerId));
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  private async onTwilioMessage(raw: string, session: StoredSession): Promise<void> {
    if (this.callbackStarted) return;
    let event: {
      event?: string;
      start?: { streamSid?: string };
      media?: { payload?: string };
      mark?: { name?: string };
    };
    try { event = JSON.parse(raw); } catch { return; }
    if (event.event === "start") {
      this.streamSid = event.start?.streamSid;
      await this.maybeConfigureOpenAI(session);
      await this.queueWorkerEvent(session, "connected", { type: "connected", occurredAt: new Date().toISOString() });
      return;
    }
    if (event.event === "media" && event.media?.payload) {
      if (this.openaiSessionConfigured && this.openai) {
        this.openai.send(JSON.stringify({ type: "input_audio_buffer.append", audio: event.media.payload }));
      } else if (this.queuedInputAudio.length < 250) {
        this.queuedInputAudio.push(event.media.payload);
      }
      return;
    }
    if (event.event === "mark" && event.mark?.name) {
      const completionCommands = this.controller?.completionMarkReceived(event.mark.name) ?? [];
      if (completionCommands.length > 0) {
        await this.executeCommands(completionCommands, session);
        await this.persistController(session);
        return;
      }
      const delivered = this.controller?.twilioMarkReceived(event.mark.name, Date.now()) ?? false;
      await this.persistController(session);
      if (delivered) {
        await this.queueWorkerEvent(session, "disclosure", { type: "disclosure_delivered", occurredAt: new Date().toISOString() });
        const firstQuestion = session.request.contract.questions[0];
        if (firstQuestion) {
          await this.queueWorkerEvent(session, `question:${firstQuestion.id}`, {
            type: "question_started",
            questionId: firstQuestion.id,
            occurredAt: new Date().toISOString(),
          });
        }
      }
      return;
    }
    if (event.event === "stop") this.finish(session, "remote_hangup");
  }

  private async maybeConfigureOpenAI(session: StoredSession): Promise<void> {
    if (!this.openai || !this.streamSid || this.openaiSessionConfigured) return;
    this.openai.send(JSON.stringify(buildRealtimeSessionUpdate({
      request: session.request,
      model: this.env.OPENAI_REALTIME_MODEL,
    })));
    this.logRealtimeEvent(session, "realtime_session_update_sent");
    this.openaiSessionConfigured = true;
    for (const audio of this.queuedInputAudio.splice(0)) {
      this.openai.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    }
    await this.persistController(session);
  }

  private async onOpenAIMessage(raw: string, session: StoredSession): Promise<void> {
    if (this.callbackStarted) return;
    let event: {
      type?: string;
      delta?: string;
      transcript?: string;
      item_id?: string;
      item?: { id?: string; type?: string };
      error?: unknown;
    };
    try { event = JSON.parse(raw); } catch { return; }
    const controller = this.controller;
    if (!controller) return;
    let commands: RealtimeCommand[] = [];
    if (event.type === "session.updated") {
      this.logRealtimeEvent(session, "realtime_session_updated");
      commands = controller.sessionConfigured(session.request);
      if (commands.length > 0) this.logRealtimeEvent(session, "realtime_opening_response_requested");
    } else if (event.type === "response.created") {
      controller.responseStarted();
    } else if (event.type === "response.output_item.added" && event.item?.type === "message" && event.item.id) {
      controller.assistantItemAdded(event.item.id);
    } else if (event.type === "input_audio_buffer.speech_started") {
      this.logRealtimeEvent(session, "realtime_recipient_speech_started");
      commands = controller.recipientSpeechStarted(this.streamSid, Date.now());
    } else if (event.type === "input_audio_buffer.speech_stopped") {
      controller.recipientSpeechStopped();
    } else if ((event.type === "response.output_audio.delta" || event.type === "response.audio.delta") && event.delta && this.streamSid) {
      controller.assistantItemAdded(event.item_id ?? "");
      controller.assistantAudioSent(event.delta, Date.now());
      this.twilio?.send(JSON.stringify({ event: "media", streamSid: this.streamSid, media: { payload: event.delta } }));
      if (!this.firstAssistantAudioForwarded) {
        this.firstAssistantAudioForwarded = true;
        this.logRealtimeEvent(session, "realtime_first_audio_forwarded");
      }
    } else if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
      commands = controller.providerTranscript(event.transcript, session.request, Date.now());
    } else if ((event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") && event.transcript) {
      commands = controller.assistantTranscript(event.transcript, session.request, Date.now());
    } else if (event.type === "response.done" || event.type === "response.cancelled" || event.type === "response.failed") {
      commands = controller.responseFinished(session.request, this.streamSid);
    } else if (event.type === "error") {
      this.logRealtimeEvent(session, "realtime_provider_error");
      commands = [{ channel: "control", action: "hangup", reason: "disclosure_failure" }];
    }
    await this.executeCommands(commands, session);
    await this.persistController(session);
  }

  private logRealtimeEvent(session: StoredSession, event: string): void {
    console.log(JSON.stringify({
      event,
      occurredAt: new Date().toISOString(),
      attemptId: session.request.attemptId,
    }));
  }

  private logBackgroundFailure(session: StoredSession, event: string, error: unknown): void {
    console.error(JSON.stringify({
      event,
      occurredAt: new Date().toISOString(),
      attemptId: session.request.attemptId,
      errorName: error instanceof Error ? error.name : "UnknownError",
      errorMessage: error instanceof Error ? error.message.slice(0, 240) : "Unknown background failure",
    }));
  }

  private async executeCommands(commands: RealtimeCommand[], session: StoredSession): Promise<void> {
    for (const command of commands) {
      if (command.channel === "openai") this.openai?.send(JSON.stringify(command.payload));
      else if (command.channel === "twilio") this.twilio?.send(JSON.stringify(command.payload));
      else {
        const terminalReason: InquiryCallResult["terminalReason"] = command.reason === "completed"
          ? "completed"
          : command.reason === "connected_timeout"
            ? "connected_timeout"
            : command.reason === "automated_greeting" || command.reason === "ivr" || command.reason === "initial_recipient_silence_timeout"
              ? "no_answer"
              : "provider_failure";
        this.finish(session, terminalReason);
        return;
      }
    }
  }

  private scheduleTimeoutCheck(session: StoredSession): void {
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.timeoutTimer = setTimeout(() => {
      const controller = this.controller;
      if (!controller || controller.snapshot().phase === "terminal") return;
      const commands = controller.enforceTimeouts({
        nowMs: Date.now(),
        maxConnectedSeconds: session.request.contract.policy.maxConnectedSeconds,
      });
      this.ctx.waitUntil((async () => {
        await this.executeCommands(commands, session);
        await this.persistController(session);
        if (!controller.snapshot().hangupRequested) this.scheduleTimeoutCheck(session);
      })());
    }, 1_000);
  }

  private async persistController(session: StoredSession): Promise<void> {
    if (!this.controller) return;
    const latest = await this.ctx.storage.get<StoredSession>("session");
    if (!latest || latest.request.dispatchIdempotencyKey !== session.request.dispatchIdempotencyKey) return;
    await this.ctx.storage.put("session", {
      ...latest,
      realtimeSnapshot: this.controller.snapshot(),
    } satisfies StoredSession);
  }

  private queueWorkerEvent(
    session: StoredSession,
    logicalKey: string,
    event: Omit<InquiryWorkerEventCallback, "schemaVersion" | "kind" | "taskId" | "attemptId" | "eventId" | "workerSequence" | "executionRevision">,
  ): Promise<string> {
    const operation = this.callbackTail.then(() => this.sendWorkerEvent(session, logicalKey, event));
    this.callbackTail = operation.catch(() => undefined);
    return operation;
  }

  private async sendWorkerEvent(
    session: StoredSession,
    logicalKey: string,
    event: Omit<InquiryWorkerEventCallback, "schemaVersion" | "kind" | "taskId" | "attemptId" | "eventId" | "workerSequence" | "executionRevision">,
  ): Promise<string> {
    const latest = await this.ctx.storage.get<StoredSession>("session");
    if (!latest || latest.request.dispatchIdempotencyKey !== session.request.dispatchIdempotencyKey) {
      throw new Error("Inquiry callback session is unavailable");
    }
    const eventId = `${session.request.attemptId}:${logicalKey}`.slice(0, 200);
    if (latest.deliveredCallbackKeys?.includes(logicalKey)) return eventId;
    if (latest.pendingWorkerEvent) await this.deliverPreparedWorkerEvent(latest);
    const current = await this.ctx.storage.get<StoredSession>("session");
    if (!current) throw new Error("Inquiry callback session disappeared");
    if (current.deliveredCallbackKeys?.includes(logicalKey)) return eventId;
    const workerSequence = current.nextWorkerSequence ?? 1;
    const callback: InquiryWorkerEventCallback = {
      schemaVersion: 1,
      kind: "event",
      taskId: session.request.taskId,
      attemptId: session.request.attemptId,
      eventId,
      workerSequence,
      executionRevision: session.request.confirmedExecutionRevision,
      ...event,
    };
    await this.ctx.storage.put("session", {
      ...current,
      pendingWorkerEvent: { logicalKey, callback },
    } satisfies StoredSession);
    await this.ctx.storage.setAlarm(Date.now() + 15_000);
    await this.deliverPreparedWorkerEvent({ ...current, pendingWorkerEvent: { logicalKey, callback } });
    return eventId;
  }

  private async deliverPreparedWorkerEvent(session: StoredSession): Promise<void> {
    const pending = session.pendingWorkerEvent;
    if (!pending) return;
    await deliverInquiryWorkerCallback({
      callbackUrl: this.env.CALLBACK_URL,
      secret: this.env.CALLBACK_HMAC_SECRET,
      callback: pending.callback,
    });
    const refreshed = await this.ctx.storage.get<StoredSession>("session");
    if (!refreshed) throw new Error("Inquiry callback session disappeared");
    if (refreshed.pendingWorkerEvent?.callback.eventId !== pending.callback.eventId) return;
    await this.ctx.storage.put("session", {
      ...refreshed,
      nextWorkerSequence: pending.callback.workerSequence + 1,
      deliveredCallbackKeys: [...(refreshed.deliveredCallbackKeys ?? []), pending.logicalKey].slice(-64),
      pendingWorkerEvent: undefined,
    } satisfies StoredSession);
  }

  private finish(session: StoredSession, terminalReason: InquiryCallResult["terminalReason"]): void {
    if (this.callbackStarted) return;
    this.callbackStarted = true;
    const terminalAt = new Date().toISOString();
    console.log(JSON.stringify({
      event: "call_finishing",
      occurredAt: terminalAt,
      attemptId: session.request.attemptId,
      terminalReason,
      disclosureDelivered: this.controller?.snapshot().disclosureDelivered ?? false,
      disclosureInterrupted: this.controller?.snapshot().disclosureResponseInterrupted ?? false,
    }));
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.controller?.finish();
    try { this.openai?.close(1000, "call ended"); } catch { /* already closed */ }
    try { this.twilio?.close(1000, "call ended"); } catch { /* already closed */ }
    this.ctx.waitUntil((async () => {
      const latest = await this.ctx.storage.get<StoredSession>("session");
      if (latest) {
        await this.ctx.storage.put("session", {
          ...latest,
          terminalReason,
          resultTerminalAt: latest.resultTerminalAt ?? terminalAt,
        } satisfies StoredSession);
      }
      await this.persistController(session);
      try {
        await this.sendCallback(session);
      } catch (error) {
        this.logBackgroundFailure(session, "initial_result_preparation_failed", error);
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
      }
    })());
  }

  private async sendCallback(session: StoredSession): Promise<void> {
    await this.callbackTail;
    const snapshot = this.controller?.snapshot() ?? session.realtimeSnapshot;
    const providerTurns = (snapshot?.rawTurns ?? [])
      .filter(({ speaker }) => speaker === "provider")
      .map(({ text }) => text);
    const rawTranscript = formatInquiryTranscript(snapshot?.rawTurns ?? []);
    const persisted = await this.ctx.storage.get<StoredSession>("session");
    const terminalAt = persisted?.resultTerminalAt ?? new Date().toISOString();
    if (!persisted?.resultTerminalAt) {
      const current = await this.ctx.storage.get<StoredSession>("session");
      if (!current) throw new Error("Inquiry callback session disappeared");
      await this.ctx.storage.put("session", { ...current, resultTerminalAt: terminalAt } satisfies StoredSession);
    }
    const hasProviderEvidence = shouldAnalyzeProviderTranscript(providerTurns);
    const analyzed = persisted?.analysisPrepared
      ? persisted.preparedExtraction ?? null
      : hasProviderEvidence ? await this.analyzeTranscript(session, rawTranscript, providerTurns) : null;
    if (hasProviderEvidence && !analyzed) {
      await this.sendWorkerEvent(session, "ended", { type: "call_ended", occurredAt: terminalAt });
      throw new Error("Transcript analysis is unavailable; result publication remains pending");
    }
    if (!persisted?.analysisPrepared) {
      const current = await this.ctx.storage.get<StoredSession>("session");
      if (!current) throw new Error("Inquiry callback session disappeared");
      await this.ctx.storage.put("session", {
        ...current,
        analysisPrepared: true,
        preparedExtraction: analyzed,
      } satisfies StoredSession);
    }
    if (analyzed?.recipientRequestedNoFurtherCalls) {
      await this.sendWorkerEvent(session, "recipient-declined", {
        type: "recipient_declined",
        occurredAt: terminalAt,
      });
    }
    const evidenceEventIds: Record<string, string> = {};
    for (const answer of analyzed?.answers ?? []) {
      if (!answer.sourceExcerpt) continue;
      evidenceEventIds[answer.questionId] = await this.sendWorkerEvent(session, `answer:${answer.questionId}`, {
        type: "answer_observed",
        questionId: answer.questionId,
        evidenceExcerpt: answer.sourceExcerpt,
        occurredAt: terminalAt,
      });
    }
    await this.sendWorkerEvent(session, "ended", { type: "call_ended", occurredAt: terminalAt });
    const latest = await this.ctx.storage.get<StoredSession>("session");
    const terminalReason = latest?.terminalReason ?? "remote_hangup";
    const result = buildDecisionReadyResult({
      request: session.request,
      extraction: analyzed,
      evidenceEventIds,
      durationSeconds: snapshot ? connectedDurationSeconds(snapshot.connectedAtMs, terminalAt) : 0,
      disclosureStatus: snapshot?.disclosureDelivered ? "delivered" : terminalReason === "provider_failure" ? "failed" : "not_observed",
      terminalReason,
      terminalAt,
    });
    const providerCost = session.callSid ? await readTwilioReportedCost({
      accountSid: this.env.TWILIO_ACCOUNT_SID,
      apiKey: this.env.TWILIO_API_KEY,
      apiKeySecret: this.env.TWILIO_API_KEY_SECRET,
      callSid: session.callSid,
      currency: session.request.contract.costCeiling.currency,
    }) : null;
    const callback: InquiryWorkerResultCallback = {
      schemaVersion: 1,
      kind: "result",
      taskId: session.request.taskId,
      attemptId: session.request.attemptId,
      resultKey: `${session.request.attemptId}:result`,
      actualCostMinorUnits: providerCost ?? 0,
      costStatus: providerCost === null ? "pending" : "provider_reported",
      result,
    };
    const beforeDelivery = await this.ctx.storage.get<StoredSession>("session");
    if (!beforeDelivery) throw new Error("Inquiry callback session disappeared");
    await this.ctx.storage.put("session", { ...beforeDelivery, pendingResultCallback: callback } satisfies StoredSession);
    await this.ctx.storage.setAlarm(Date.now() + 15_000);
    await this.deliverPreparedResult({ ...beforeDelivery, pendingResultCallback: callback });
  }

  private async deliverPreparedResult(session: StoredSession): Promise<void> {
    const callback = session.pendingResultCallback;
    if (!callback) return;
    await deliverInquiryWorkerCallback({
      callbackUrl: this.env.CALLBACK_URL,
      secret: this.env.CALLBACK_HMAC_SECRET,
      callback,
    });
    this.controller?.clearRawTurns();
    const completed = await this.ctx.storage.get<StoredSession>("session");
    if (!completed) return;
    const pendingCostReconciliation = callback.costStatus === "pending"
      ? { resultKey: callback.resultKey, attempts: 0 }
      : undefined;
    await this.ctx.storage.put("session", {
      ...completed,
      completionDelivered: true,
      pendingResultCallback: undefined,
      pendingCostReconciliation,
      realtimeSnapshot: scrubStoredRealtimeSnapshot(this.controller?.snapshot() ?? completed.realtimeSnapshot),
    } satisfies StoredSession);
    if (pendingCostReconciliation) await this.ctx.storage.setAlarm(Date.now() + 30_000);
    else await this.ctx.storage.deleteAlarm();
  }

  private async reconcilePendingCost(session: StoredSession): Promise<void> {
    const pending = session.pendingCostReconciliation;
    if (!pending || !session.callSid) return;
    const providerCost = await readTwilioReportedCost({
      accountSid: this.env.TWILIO_ACCOUNT_SID,
      apiKey: this.env.TWILIO_API_KEY,
      apiKeySecret: this.env.TWILIO_API_KEY_SECRET,
      callSid: session.callSid,
      currency: session.request.contract.costCeiling.currency,
    });
    if (providerCost === null) {
      const attempts = pending.attempts + 1;
      await this.ctx.storage.put("session", {
        ...session,
        pendingCostReconciliation: { ...pending, attempts },
      } satisfies StoredSession);
      const delay = Math.min(6 * 60 * 60 * 1_000, 30_000 * (2 ** Math.min(attempts, 9)));
      await this.ctx.storage.setAlarm(Date.now() + delay);
      return;
    }
    const callback: InquiryWorkerCostCallback = {
      schemaVersion: 1,
      kind: "cost",
      taskId: session.request.taskId,
      attemptId: session.request.attemptId,
      resultKey: pending.resultKey,
      settlementKey: `${session.request.attemptId}:cost`,
      actualCostMinorUnits: providerCost,
    };
    try {
      await deliverInquiryWorkerCallback({
        callbackUrl: this.env.CALLBACK_URL,
        secret: this.env.CALLBACK_HMAC_SECRET,
        callback,
      });
      const latest = await this.ctx.storage.get<StoredSession>("session");
      if (latest) await this.ctx.storage.put("session", { ...latest, pendingCostReconciliation: undefined } satisfies StoredSession);
      await this.ctx.storage.deleteAlarm();
    } catch {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    }
  }

  private async analyzeTranscript(
    session: StoredSession,
    rawTranscript: string,
    providerTurns: readonly string[],
  ): Promise<InquiryExtraction | null> {
    return await analyzeInquiryTranscript({
      apiKey: this.env.OPENAI_API_KEY,
      model: this.env.OPENAI_SUMMARY_MODEL,
      request: session.request,
      rawTranscript,
      providerTurns,
      safetyIdentifier: await this.safetyId(session.request.ownerId),
    });
  }
}
