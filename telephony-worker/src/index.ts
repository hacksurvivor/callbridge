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
  parseInquiryExtraction,
  readTwilioReportedCost,
  type InquiryExtraction,
} from "./inquiryResult.js";
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

type Env = {
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

class ProviderRejectedBeforeCreation extends Error {}
class ProviderCreationUncertain extends Error {}

async function createTwilioCall(input: {
  env: Env;
  to: string;
  twiml: string;
}): Promise<string> {
  const endpoint = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(input.env.TWILIO_ACCOUNT_SID)}/Calls.json`;
  const body = new URLSearchParams({ To: input.to, From: input.env.TWILIO_FROM_NUMBER, Twiml: input.twiml });
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
  const data = await response.json<{ sid?: string; message?: string }>();
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

  const origin = new URL(request.url).origin.replace(/^http/, "ws");
  const streamUrl = `${origin}/media-stream?dispatch=${encodeURIComponent(input.dispatchIdempotencyKey)}&token=${encodeURIComponent(configured.streamToken)}`;
  const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Connect><Stream url="${escapeXml(streamUrl)}" /></Connect></Response>`;
  await session.beginCallCreation();
  try {
    const callSid = await createTwilioCall({ env, to: destination, twiml });
    await session.recordCallSid(callSid);
    return json({ creationState: "accepted", externalCallId: callSid, externalSessionId: callSid, quote, dialingPermission }, 201);
  } catch (error) {
    if (error instanceof ProviderRejectedBeforeCreation) {
      await session.recordDefinitelyNotCreated();
      return json({ creationState: "definitely_not_created", error: error.message }, 422);
    }
    return json({ creationState: "creation_uncertain", error: "provider_creation_outcome_requires_reconciliation" }, 502);
  }
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
    if (request.method === "GET" && url.pathname === "/media-stream" && request.headers.get("upgrade")?.toLowerCase() === "websocket") {
      const dispatchId = url.searchParams.get("dispatch");
      if (!dispatchId) return new Response("Missing dispatch", { status: 400 });
      return await env.CALL_SESSIONS.get(env.CALL_SESSIONS.idFromName(dispatchId)).fetch(request);
    }
    return new Response("Not found", { status: 404 });
  },
};

export class CallSession extends DurableObject<Env> {
  private twilio?: WebSocket;
  private openai?: WebSocket;
  private streamSid?: string;
  private controller?: InquiryRealtimeController;
  private openaiSessionConfigured = false;
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
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        return;
      }
    }
    const afterEvent = await this.ctx.storage.get<StoredSession>("session");
    if (afterEvent?.terminalReason && !afterEvent.completionDelivered && !afterEvent.pendingResultCallback) {
      try {
        await this.sendCallback(afterEvent);
      } catch {
        await this.ctx.storage.setAlarm(Date.now() + 60_000);
        return;
      }
    }
    const afterPreparation = await this.ctx.storage.get<StoredSession>("session");
    if (afterPreparation?.pendingResultCallback && !afterPreparation.completionDelivered) {
      try {
        await this.deliverPreparedResult(afterPreparation);
      } catch {
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

  async recordDefinitelyNotCreated(): Promise<void> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    if (!session || session.callSid) throw new Error("Created calls cannot be marked absent");
    await this.ctx.storage.put("session", { ...session, creationState: "definitely_not_created" } satisfies StoredSession);
  }

  async fetch(request: Request): Promise<Response> {
    const session = await this.ctx.storage.get<StoredSession>("session");
    const token = new URL(request.url).searchParams.get("token");
    if (!session || !token || token !== session.streamToken) return new Response("Forbidden", { status: 403 });
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
    server.addEventListener("close", () => this.finish(session, "remote_hangup"));
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
    socket.addEventListener("close", () => this.finish(session, "remote_hangup"));
    socket.addEventListener("error", () => this.finish(session, "provider_failure"));
    await this.maybeConfigureOpenAI(session);
  }

  private async safetyId(ownerId: string): Promise<string> {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerId));
    return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  }

  private async onTwilioMessage(raw: string, session: StoredSession): Promise<void> {
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
    this.openaiSessionConfigured = true;
    for (const audio of this.queuedInputAudio.splice(0)) {
      this.openai.send(JSON.stringify({ type: "input_audio_buffer.append", audio }));
    }
    await this.persistController(session);
  }

  private async onOpenAIMessage(raw: string, session: StoredSession): Promise<void> {
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
    if (event.type === "response.created") {
      controller.responseStarted();
    } else if (event.type === "response.output_item.added" && event.item?.type === "message" && event.item.id) {
      controller.assistantItemAdded(event.item.id);
    } else if (event.type === "input_audio_buffer.speech_started") {
      commands = controller.recipientSpeechStarted(this.streamSid, Date.now());
    } else if (event.type === "input_audio_buffer.speech_stopped") {
      controller.recipientSpeechStopped();
    } else if ((event.type === "response.output_audio.delta" || event.type === "response.audio.delta") && event.delta && this.streamSid) {
      controller.assistantItemAdded(event.item_id ?? "");
      controller.assistantAudioSent(event.delta, Date.now());
      this.twilio?.send(JSON.stringify({ event: "media", streamSid: this.streamSid, media: { payload: event.delta } }));
    } else if (event.type === "conversation.item.input_audio_transcription.completed" && event.transcript) {
      commands = controller.providerTranscript(event.transcript, session.request, Date.now());
    } else if ((event.type === "response.output_audio_transcript.done" || event.type === "response.audio_transcript.done") && event.transcript) {
      commands = controller.assistantTranscript(event.transcript, session.request, Date.now());
    } else if (event.type === "response.done" || event.type === "response.cancelled" || event.type === "response.failed") {
      commands = controller.responseFinished(session.request, this.streamSid);
    } else if (event.type === "error") {
      commands = [{ channel: "control", action: "hangup", reason: "disclosure_failure" }];
    }
    await this.executeCommands(commands, session);
    await this.persistController(session);
  }

  private async executeCommands(commands: RealtimeCommand[], session: StoredSession): Promise<void> {
    for (const command of commands) {
      if (command.channel === "openai") this.openai?.send(JSON.stringify(command.payload));
      else if (command.channel === "twilio") this.twilio?.send(JSON.stringify(command.payload));
      else {
        const terminalReason: InquiryCallResult["terminalReason"] = command.reason === "connected_timeout"
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
    if (this.timeoutTimer) clearTimeout(this.timeoutTimer);
    this.controller?.finish();
    try { this.openai?.close(1000, "call ended"); } catch { /* already closed */ }
    try { this.twilio?.close(1000, "call ended"); } catch { /* already closed */ }
    this.ctx.waitUntil((async () => {
      const latest = await this.ctx.storage.get<StoredSession>("session");
      if (latest) {
        await this.ctx.storage.put("session", { ...latest, terminalReason } satisfies StoredSession);
      }
      await this.persistController(session);
      try {
        await this.sendCallback(session);
      } catch {
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
    const rawTranscript = (snapshot?.rawTurns ?? [])
      .map(({ speaker, text }) => `${speaker === "provider" ? "Provider" : "CallBridge"}: ${text}`)
      .join("\n")
      .slice(0, 80_000);
    const persisted = await this.ctx.storage.get<StoredSession>("session");
    const terminalAt = persisted?.resultTerminalAt ?? new Date().toISOString();
    if (!persisted?.resultTerminalAt) {
      const current = await this.ctx.storage.get<StoredSession>("session");
      if (!current) throw new Error("Inquiry callback session disappeared");
      await this.ctx.storage.put("session", { ...current, resultTerminalAt: terminalAt } satisfies StoredSession);
    }
    const analyzed = persisted?.analysisPrepared
      ? persisted.preparedExtraction ?? null
      : rawTranscript ? await this.analyzeTranscript(session, rawTranscript, providerTurns) : null;
    if (rawTranscript && !analyzed) {
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
      durationSeconds: snapshot ? (Date.now() - snapshot.connectedAtMs) / 1_000 : 0,
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
    const schema = {
      type: "object",
      additionalProperties: false,
      required: ["answers", "possibleCommitmentViolation", "recipientRequestedNoFurtherCalls"],
      properties: {
        answers: {
          type: "array",
          minItems: session.request.contract.questions.length,
          maxItems: session.request.contract.questions.length,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["questionId", "status", "value", "sourceExcerpt"],
            properties: {
              questionId: { type: "string", enum: session.request.contract.questions.map(({ id }) => id) },
              status: { type: "string", enum: ["reported", "not_answered", "ambiguous"] },
              value: { type: ["string", "null"], maxLength: 2_000 },
              sourceExcerpt: { type: ["string", "null"], maxLength: 1_000 },
            },
          },
        },
        possibleCommitmentViolation: { type: "boolean" },
        recipientRequestedNoFurtherCalls: { type: "boolean" },
      },
    };
    try {
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { authorization: `Bearer ${this.env.OPENAI_API_KEY}`, "content-type": "application/json", "OpenAI-Safety-Identifier": await this.safetyId(session.request.ownerId) },
        body: JSON.stringify({
          model: this.env.OPENAI_SUMMARY_MODEL,
          input: [
          { role: "system", content: [{ type: "input_text", text: "Return exactly one answer for every approved question. Extract only facts explicitly stated by the Provider. Never infer availability, price, terms, completion, or success. For reported or ambiguous answers, sourceExcerpt must be an exact contiguous quote copied from a Provider turn in the transcript. Translate value into the target language. For not_answered, value and sourceExcerpt must be null. Mark possibleCommitmentViolation only if CallBridge itself audibly booked, changed, cancelled, paid, accepted a fee or terms, or made another commitment. Set recipientRequestedNoFurtherCalls only when the Provider explicitly asks CallBridge not to call this number again; do not infer it from declining the current inquiry or ending the call." }] },
          { role: "user", content: [{ type: "input_text", text: `Target language: ${session.request.contract.languages.result}\nObjective: ${session.request.contract.objective}\nApproved questions: ${session.request.contract.questions.map(({ id, prompt }) => `[${id}] ${prompt}`).join(" | ")}\nTranscript:\n${rawTranscript}` }] },
        ],
        text: { format: { type: "json_schema", name: "call_result", strict: true, schema } },
        }),
      });
      if (!response.ok) return null;
      const result = await response.json<{ output?: Array<{ content?: Array<{ type?: string; text?: string }> }> }>();
      const text = result.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text;
      if (!text) return null;
      return parseInquiryExtraction(JSON.parse(text), session.request, providerTurns);
    } catch {
      return null;
    }
  }
}
