import { DurableObject } from "cloudflare:workers";

import { escapeXml } from "./policy.js";

export const DEMO_HOTEL_FACT_SHEET_REVISION = "aurora_demo_hotel_v1" as const;
export const DEMO_HOTEL_UNKNOWN_RESPONSE = "I don't have verified information about that in this controlled demo.";

const GREETING = "Aurora Demo Hotel automated desk. This is a controlled test line. How can I help?";
const DISCLOSURE_ACK = "Thank you for the disclosure. I understand this is an AI assistant calling for a user.";

const FACTS = [
  {
    id: "late_arrival",
    phrases: ["after midnight", "late arrival", "arrive late", "midnight", "late check in", "late check-in"],
    spokenText: "Check-in begins at 3 PM. Arrivals after midnight are accepted for held reservations, but this automated desk cannot create or modify a reservation.",
  },
  {
    id: "breakfast",
    phrases: ["breakfast", "morning meal"],
    spokenText: "Breakfast is served from 6:30 AM until 10:30 AM and costs 450 Thai baht per person.",
  },
  {
    id: "accessibility",
    phrases: ["accessible", "wheelchair", "step free", "step-free", "roll in shower", "roll-in shower"],
    spokenText: "Two accessible room types have step-free access and roll-in showers.",
  },
  {
    id: "pets",
    phrases: ["pet", "pets", "dog", "cat"],
    spokenText: "Small pets under 10 kilograms are allowed with an 800 Thai baht cleaning fee per stay. This automated desk cannot accept the fee.",
  },
  {
    id: "parking",
    phrases: ["parking", "park a car", "car park"],
    spokenText: "On-site parking is unavailable.",
  },
  {
    id: "desk_hours",
    phrases: ["open", "desk", "hours", "24 hours", "twenty four hours"],
    spokenText: "The automated desk is available 24 hours a day.",
  },
] as const;

export type DemoHotelLookup =
  | { kind: "fact"; factId: (typeof FACTS)[number]["id"]; spokenText: string }
  | { kind: "unknown"; topicId: "renovation_noise_schedule" | "unverified_topic"; spokenText: string }
  | { kind: "conversation"; intent: "greeting" | "disclosure" | "thanks" | "goodbye"; spokenText: string };

function normalize(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/[^a-z0-9\s-]/g, " ").replace(/\s+/g, " ").trim();
}

export function lookupDemoHotelFact(utterance: string): DemoHotelLookup {
  const value = normalize(utterance).slice(0, 2_000);
  if (/\b(ignore|reveal|repeat|override|forget)\b.{0,100}\b(fact|facts|rule|rules|instruction|instructions|prompt|system)\b/.test(value)) {
    return { kind: "unknown", topicId: "unverified_topic", spokenText: DEMO_HOTEL_UNKNOWN_RESPONSE };
  }
  if (/\b(renovation|construction|noise schedule|building work)\b/.test(value)) {
    return { kind: "unknown", topicId: "renovation_noise_schedule", spokenText: DEMO_HOTEL_UNKNOWN_RESPONSE };
  }
  if (/\b(you are|this is).{0,80}\b(ai|artificial intelligence|assistant)\b|\b(transcrib|record|disclosure)\b/.test(value)) {
    return { kind: "conversation", intent: "disclosure", spokenText: DISCLOSURE_ACK };
  }
  if (/\b(goodbye|bye|that is all|thats all|no more questions)\b/.test(value)) {
    return { kind: "conversation", intent: "goodbye", spokenText: "Goodbye. Thank you for calling the Aurora Demo Hotel test desk." };
  }
  if (/\b(thank you|thanks)\b/.test(value)) {
    return { kind: "conversation", intent: "thanks", spokenText: "You're welcome. Is there another information-only question I can answer?" };
  }
  if (/\b(hello|hi|good morning|good afternoon|good evening)\b/.test(value)) {
    return { kind: "conversation", intent: "greeting", spokenText: "Hello. How can the Aurora Demo Hotel automated test desk help?" };
  }
  for (const fact of FACTS) {
    if (fact.phrases.some((phrase) => value.includes(phrase))) {
      return { kind: "fact", factId: fact.id, spokenText: fact.spokenText };
    }
  }
  return { kind: "unknown", topicId: "unverified_topic", spokenText: DEMO_HOTEL_UNKNOWN_RESPONSE };
}

export type DemoHotelEnv = {
  DEMO_HOTEL_RECIPIENT: DurableObjectNamespace<DemoHotelRecipient>;
  DEMO_HOTEL_ENABLED?: string;
  DEMO_HOTEL_NUMBER?: string;
  DEMO_HOTEL_EXPECTED_FROM?: string;
  DEMO_HOTEL_DAILY_ATTEMPT_LIMIT?: string;
  DEMO_HOTEL_MAX_CONNECTED_SECONDS?: string;
  DEMO_HOTEL_MAX_DAILY_COST_MINOR_UNITS?: string;
  DEMO_HOTEL_MAX_RESERVED_COST_PER_CALL_MINOR_UNITS?: string;
  DEMO_HOTEL_FACT_SHEET_REVISION?: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN?: string;
  TWILIO_CONTROL_API_KEY: string;
  TWILIO_CONTROL_API_KEY_SECRET: string;
};

type Admission = {
  taskId: string;
  attemptId: string;
  expectedFrom: string;
  expectedTo: string;
  expiresAtMs: number;
  reservedCostMinorUnits: number;
};

type ActiveSession = {
  callSid: string;
  nonceHash: string;
  startedAtMs: number;
  deadlineAtMs: number;
  factIds: string[];
  turns: number;
};

type RecipientState = {
  utcDay: string;
  attempts: number;
  reservedCostMinorUnits: number;
  pending?: Admission;
  active?: ActiveSession;
  lastTerminalReason?: string;
};

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

async function readJson<T extends object>(requestOrResponse: Request | Response): Promise<Partial<T>> {
  try {
    return await requestOrResponse.json<T>();
  } catch {
    return {};
  }
}

function integer(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function utcDay(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

function validE164(value: string | undefined): value is string {
  return Boolean(value && /^\+[1-9]\d{6,14}$/.test(value));
}

function configured(env: DemoHotelEnv): boolean {
  return (
    env.DEMO_HOTEL_ENABLED === "true"
    && validE164(env.DEMO_HOTEL_NUMBER)
    && validE164(env.DEMO_HOTEL_EXPECTED_FROM)
    && Boolean(env.TWILIO_AUTH_TOKEN && env.TWILIO_ACCOUNT_SID && env.TWILIO_CONTROL_API_KEY && env.TWILIO_CONTROL_API_KEY_SECRET)
    && (env.DEMO_HOTEL_FACT_SHEET_REVISION ?? DEMO_HOTEL_FACT_SHEET_REVISION) === DEMO_HOTEL_FACT_SHEET_REVISION
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Twilio signs the exact webhook URL followed by alphabetically sorted form pairs. */
export async function validTwilioFormSignature(input: {
  url: string;
  form: URLSearchParams;
  authToken: string;
  signature: string;
}): Promise<boolean> {
  let payload = input.url;
  const keys = Array.from(new Set(input.form.keys())).sort();
  for (const key of keys) {
    const values = input.form.getAll(key).sort();
    for (const value of values) payload += `${key}${value}`;
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(input.authToken),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const expected = bytesToBase64(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload))));
  if (expected.length !== input.signature.length) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) mismatch |= expected.charCodeAt(index) ^ input.signature.charCodeAt(index);
  return mismatch === 0;
}

function rejectTwiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Reject reason="rejected" /></Response>', {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function hangupTwiml(): Response {
  return new Response('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>', {
    status: 200,
    headers: { "content-type": "text/xml; charset=utf-8" },
  });
}

function newNonce(): string {
  return crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
}

function gatherActionUrl(publicOrigin: string, callSid: string, nonce: string): string {
  const action = new URL("/demo-hotel/voice", publicOrigin);
  action.searchParams.set("callSid", callSid);
  action.searchParams.set("nonce", nonce);
  return action.toString();
}

export function buildDemoHotelSpeechLoopTwiml(input: {
  spokenText: string;
  publicOrigin?: string;
  callSid?: string;
  nonce?: string;
  hangup?: boolean;
}): string {
  const say = `<Say>${escapeXml(input.spokenText)}</Say>`;
  if (input.hangup) return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Hangup /></Response>`;
  if (!input.publicOrigin || !input.callSid || !input.nonce) throw new Error("gather_callback_required");
  const action = gatherActionUrl(input.publicOrigin, input.callSid, input.nonce);
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Gather input="speech" language="en-US" method="POST" action="${escapeXml(action)}" actionOnEmptyResult="true" speechTimeout="auto" timeout="5" /></Response>`;
}

export async function handleDemoHotelVoiceWebhook(request: Request, env: DemoHotelEnv): Promise<Response> {
  if (!env.TWILIO_AUTH_TOKEN) return new Response("Forbidden", { status: 403 });
  const signature = request.headers.get("x-twilio-signature") ?? "";
  const raw = await request.text();
  const form = new URLSearchParams(raw);
  if (!signature || !await validTwilioFormSignature({ url: request.url, form, authToken: env.TWILIO_AUTH_TOKEN, signature })) {
    return new Response("Forbidden", { status: 403 });
  }
  const callSid = form.get("CallSid")?.trim() ?? "";
  const url = new URL(request.url);
  const callbackCallSid = url.searchParams.get("callSid")?.trim() ?? "";
  const callbackNonce = url.searchParams.get("nonce")?.trim() ?? "";
  if (callbackCallSid || callbackNonce) {
    if (
      !/^CA[0-9a-f]{32}$/i.test(callSid)
      || callbackCallSid !== callSid
      || !/^[A-Za-z0-9_-]{20,200}$/.test(callbackNonce)
    ) return hangupTwiml();
    const origin = url.origin;
    return await env.DEMO_HOTEL_RECIPIENT.get(env.DEMO_HOTEL_RECIPIENT.idFromName("aurora-demo-hotel-v1")).fetch(
      new Request(`${origin}/gather/${encodeURIComponent(callSid)}/${encodeURIComponent(callbackNonce)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ speechResult: form.get("SpeechResult")?.trim() ?? "", publicOrigin: origin }),
      }),
    );
  }
  const from = form.get("From")?.trim() ?? "";
  const to = form.get("To")?.trim() ?? "";
  if (!/^CA[0-9a-f]{32}$/i.test(callSid) || !validE164(from) || !validE164(to)) return rejectTwiml();
  const origin = new URL(request.url).origin;
  return await env.DEMO_HOTEL_RECIPIENT.get(env.DEMO_HOTEL_RECIPIENT.idFromName("aurora-demo-hotel-v1")).fetch(
    new Request(`${origin}/voice`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ callSid, from, to, publicOrigin: origin }),
    }),
  );
}

export function demoHotelSessionPath(pathname: string): { callSid: string; nonce: string } | null {
  const match = pathname.match(/^\/demo-hotel\/session\/(CA[0-9a-f]{32})\/([A-Za-z0-9_-]{20,200})$/i);
  return match ? { callSid: match[1]!, nonce: match[2]! } : null;
}

export async function reserveDemoHotelAdmission(input: {
  env: DemoHotelEnv;
  taskId: string;
  attemptId: string;
  expectedTo: string;
}): Promise<{ accepted: true } | { accepted: false; error: string }> {
  const object = input.env.DEMO_HOTEL_RECIPIENT.get(input.env.DEMO_HOTEL_RECIPIENT.idFromName("aurora-demo-hotel-v1"));
  const response = await object.fetch(new Request("https://internal/admission", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      taskId: input.taskId,
      attemptId: input.attemptId,
      expectedFrom: input.env.DEMO_HOTEL_EXPECTED_FROM,
      expectedTo: input.expectedTo,
    }),
  }));
  const result = await readJson<{ accepted: boolean; error: string }>(response);
  return response.ok && result.accepted
    ? { accepted: true }
    : { accepted: false, error: result.error ?? "demo_recipient_unavailable" };
}

export async function cancelDemoHotelAdmission(env: DemoHotelEnv, taskId: string, attemptId: string): Promise<void> {
  const object = env.DEMO_HOTEL_RECIPIENT.get(env.DEMO_HOTEL_RECIPIENT.idFromName("aurora-demo-hotel-v1"));
  await object.fetch(new Request("https://internal/admission/cancel", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ taskId, attemptId }),
  }));
}

export async function demoHotelHealth(env: DemoHotelEnv): Promise<Response> {
  const object = env.DEMO_HOTEL_RECIPIENT.get(env.DEMO_HOTEL_RECIPIENT.idFromName("aurora-demo-hotel-v1"));
  return await object.fetch(new Request("https://internal/health"));
}

export class DemoHotelRecipient extends DurableObject<DemoHotelEnv> {
  private async readState(): Promise<RecipientState> {
    const now = Date.now();
    const stored = await this.ctx.storage.get<RecipientState>("state");
    if (!stored) return { utcDay: utcDay(now), attempts: 0, reservedCostMinorUnits: 0 };
    let next = stored;
    if (stored.pending && stored.pending.expiresAtMs <= now) {
      next = {
        ...next,
        reservedCostMinorUnits: Math.max(0, next.reservedCostMinorUnits - stored.pending.reservedCostMinorUnits),
        pending: undefined,
        lastTerminalReason: "admission_expired",
      };
    }
    if (next.utcDay !== utcDay(now) && !next.pending && !next.active) {
      next = { utcDay: utcDay(now), attempts: 0, reservedCostMinorUnits: 0, lastTerminalReason: next.lastTerminalReason };
    }
    if (next !== stored) await this.ctx.storage.put("state", next);
    return next;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return this.health();
    if (request.method === "POST" && url.pathname === "/admission") return this.reserve(request);
    if (request.method === "POST" && url.pathname === "/admission/cancel") return this.cancel(request);
    if (request.method === "POST" && url.pathname === "/voice") return this.voice(request);
    const gather = url.pathname.match(/^\/gather\/(CA[0-9a-f]{32})\/([A-Za-z0-9_-]{20,200})$/i);
    if (request.method === "POST" && gather) return this.gather(request, gather[1]!, gather[2]!);
    return new Response("Not found", { status: 404 });
  }

  async alarm(): Promise<void> {
    const state = await this.readState();
    if (!state.active || state.active.deadlineAtMs > Date.now()) return;
    await this.hangup(state.active.callSid);
    await this.finish("connected_timeout");
  }

  private async reserve(request: Request): Promise<Response> {
    if (!configured(this.env)) return json({ accepted: false, error: "demo_recipient_not_ready" }, 503);
    const input = await readJson<Admission>(request);
    const expectedFrom = input.expectedFrom?.trim();
    const expectedTo = input.expectedTo?.trim();
    if (!input.taskId || !input.attemptId || expectedFrom !== this.env.DEMO_HOTEL_EXPECTED_FROM || expectedTo !== this.env.DEMO_HOTEL_NUMBER) {
      return json({ accepted: false, error: "demo_admission_invalid" }, 400);
    }
    const state = await this.readState();
    if (state.active || state.pending) return json({ accepted: false, error: "demo_recipient_busy" }, 409);
    const reserve = integer(this.env.DEMO_HOTEL_MAX_RESERVED_COST_PER_CALL_MINOR_UNITS, 100);
    const dailyBudget = integer(this.env.DEMO_HOTEL_MAX_DAILY_COST_MINOR_UNITS, 2_000);
    if (state.reservedCostMinorUnits + reserve > dailyBudget) return json({ accepted: false, error: "demo_budget_exhausted" }, 429);
    const pending: Admission = {
      taskId: input.taskId,
      attemptId: input.attemptId,
      expectedFrom: expectedFrom!,
      expectedTo: expectedTo!,
      expiresAtMs: Date.now() + 120_000,
      reservedCostMinorUnits: reserve,
    };
    await this.ctx.storage.put("state", {
      ...state,
      pending,
      reservedCostMinorUnits: state.reservedCostMinorUnits + reserve,
    } satisfies RecipientState);
    await this.ctx.storage.setAlarm(pending.expiresAtMs);
    return json({ accepted: true });
  }

  private async cancel(request: Request): Promise<Response> {
    const input = await readJson<{ taskId: string; attemptId: string }>(request);
    const state = await this.readState();
    if (!state.pending || state.pending.taskId !== input.taskId || state.pending.attemptId !== input.attemptId) return json({ cancelled: false });
    await this.ctx.storage.put("state", {
      ...state,
      pending: undefined,
      reservedCostMinorUnits: Math.max(0, state.reservedCostMinorUnits - state.pending.reservedCostMinorUnits),
      lastTerminalReason: "outbound_not_created",
    } satisfies RecipientState);
    await this.ctx.storage.deleteAlarm();
    return json({ cancelled: true });
  }

  private async voice(request: Request): Promise<Response> {
    const input = await readJson<{ callSid: string; from: string; to: string; publicOrigin: string }>(request);
    const state = await this.readState();
    const attempts = state.attempts + 1;
    const withAttempt = { ...state, attempts } satisfies RecipientState;
    await this.ctx.storage.put("state", withAttempt);
    if (!configured(this.env) || attempts > integer(this.env.DEMO_HOTEL_DAILY_ATTEMPT_LIMIT, 20)) return rejectTwiml();
    if (
      !state.pending
      || state.active
      || input.from !== state.pending.expectedFrom
      || input.to !== state.pending.expectedTo
      || input.from !== this.env.DEMO_HOTEL_EXPECTED_FROM
      || input.to !== this.env.DEMO_HOTEL_NUMBER
      || !input.callSid
      || !input.publicOrigin
    ) return rejectTwiml();

    const nonce = newNonce();
    const maxSeconds = integer(this.env.DEMO_HOTEL_MAX_CONNECTED_SECONDS, 180);
    const active: ActiveSession = {
      callSid: input.callSid,
      nonceHash: await sha256(nonce),
      startedAtMs: Date.now(),
      deadlineAtMs: Date.now() + maxSeconds * 1_000,
      factIds: [],
      turns: 0,
    };
    await this.ctx.storage.put("state", { ...withAttempt, pending: undefined, active } satisfies RecipientState);
    await this.ctx.storage.setAlarm(active.deadlineAtMs);
    const twiml = buildDemoHotelSpeechLoopTwiml({
      spokenText: GREETING,
      publicOrigin: input.publicOrigin,
      callSid: input.callSid,
      nonce,
    });
    return new Response(twiml, { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
  }

  private async gather(request: Request, callSid: string, nonce: string): Promise<Response> {
    const state = await this.readState();
    if (!state.active || state.active.callSid !== callSid || await sha256(nonce) !== state.active.nonceHash) {
      return hangupTwiml();
    }
    if (state.active.deadlineAtMs <= Date.now() || state.active.turns >= 24) {
      await this.hangup(callSid);
      await this.finish(state.active.deadlineAtMs <= Date.now() ? "connected_timeout" : "turn_limit");
      return hangupTwiml();
    }
    const input = await readJson<{ speechResult: string; publicOrigin: string }>(request);
    const speechResult = typeof input.speechResult === "string" ? input.speechResult.slice(0, 2_000).trim() : "";
    const answer = speechResult ? lookupDemoHotelFact(speechResult) : null;
    const spokenText = answer?.spokenText ?? "I didn't hear a question. Please try again.";
    const factIds = answer?.kind === "fact" && !state.active.factIds.includes(answer.factId)
      ? [...state.active.factIds, answer.factId]
      : state.active.factIds;
    const isGoodbye = answer?.kind === "conversation" && answer.intent === "goodbye";
    if (isGoodbye) {
      await this.ctx.storage.put("state", { ...state, active: { ...state.active, factIds, turns: state.active.turns + 1 } } satisfies RecipientState);
      await this.finish("completed");
      return new Response(buildDemoHotelSpeechLoopTwiml({ spokenText, hangup: true }), {
        status: 200,
        headers: { "content-type": "text/xml; charset=utf-8" },
      });
    }
    if (!input.publicOrigin) return hangupTwiml();
    const nextNonce = newNonce();
    await this.ctx.storage.put("state", {
      ...state,
      active: { ...state.active, nonceHash: await sha256(nextNonce), factIds, turns: state.active.turns + 1 },
    } satisfies RecipientState);
    return new Response(buildDemoHotelSpeechLoopTwiml({
      spokenText,
      publicOrigin: input.publicOrigin,
      callSid,
      nonce: nextNonce,
    }), { status: 200, headers: { "content-type": "text/xml; charset=utf-8" } });
  }

  private async health(): Promise<Response> {
    const state = await this.readState();
    const dailyLimit = integer(this.env.DEMO_HOTEL_DAILY_ATTEMPT_LIMIT, 20);
    const dailyBudget = integer(this.env.DEMO_HOTEL_MAX_DAILY_COST_MINOR_UNITS, 2_000);
    return json({
      ready: configured(this.env) && !state.active && !state.pending && state.attempts < dailyLimit && state.reservedCostMinorUnits < dailyBudget,
      enabled: this.env.DEMO_HOTEL_ENABLED === "true",
      configurationReady: configured(this.env),
      active: Boolean(state.active),
      pending: Boolean(state.pending),
      remainingAttempts: Math.max(0, dailyLimit - state.attempts),
      remainingBudgetMinorUnits: Math.max(0, dailyBudget - state.reservedCostMinorUnits),
      factSheetRevision: DEMO_HOTEL_FACT_SHEET_REVISION,
      lastTerminalReason: state.lastTerminalReason ?? null,
    });
  }

  private async hangup(callSid: string): Promise<void> {
    if (!this.env.TWILIO_ACCOUNT_SID || !this.env.TWILIO_CONTROL_API_KEY || !this.env.TWILIO_CONTROL_API_KEY_SECRET) return;
    const auth = btoa(`${this.env.TWILIO_CONTROL_API_KEY}:${this.env.TWILIO_CONTROL_API_KEY_SECRET}`);
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(this.env.TWILIO_ACCOUNT_SID)}/Calls/${encodeURIComponent(callSid)}.json`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ Status: "completed" }),
    }).catch(() => undefined);
  }

  private async finish(reason: string): Promise<void> {
    const state = await this.readState();
    if (!state.active) return;
    await this.ctx.storage.put("state", { ...state, active: undefined, lastTerminalReason: reason } satisfies RecipientState);
    await this.ctx.storage.deleteAlarm();
  }
}
