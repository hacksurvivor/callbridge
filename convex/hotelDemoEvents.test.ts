// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type AttemptEvent } from "../shared/hotelDemoContracts.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.{ts,js}");
const createCallDraft = makeFunctionReference<"mutation">("hotelDemo:createCallDraft");
const createConfirmationIntent = makeFunctionReference<"mutation">("hotelDemo:createConfirmationIntent");
const confirmAndQueue = makeFunctionReference<"mutation">("hotelDemo:confirmAndQueue");
const acquireDispatchLease = makeFunctionReference<"mutation">("hotelDemo:acquireDispatchLease");
const ingestAttemptEvent = makeFunctionReference<"mutation">("hotelDemoEvents:ingestAttemptEvent");
const getCallStatus = makeFunctionReference<"query">("hotelDemo:getCallStatus");
const getCallResult = makeFunctionReference<"query">("hotelDemo:getCallResult");

const policyEnvironment = {
  CALLBRIDGE_DEMO_RECIPIENT_APPROVED: "true",
  CALLBRIDGE_DEMO_LEGAL_APPROVED: "true",
  CALLBRIDGE_DEMO_DESTINATION_DISPLAY_NAME: "Sakura Hotel Kyoto",
  CALLBRIDGE_DEMO_DESTINATION_PHONE_E164: "+81751234142",
  CALLBRIDGE_DEMO_DESTINATION_MASKED_PHONE: "+81 75 ••• •142",
  CALLBRIDGE_DEMO_DISCLOSURE_JA: "AIアシスタントです。通話は文字起こしされ、録音されません。構造化された結果は24時間保持されます。",
  CALLBRIDGE_DEMO_DISCLOSURE_APPROVED_AT: "2026-08-26T00:00:00.000Z",
} as const;

const originalEnvironment = Object.fromEntries(Object.keys(policyEnvironment).map((name) => [name, process.env[name]]));

beforeEach(() => Object.assign(process.env, policyEnvironment));
afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.useRealTimers();
});

async function activeAttempt() {
  const t = convexTest(schema, modules).withIdentity({ subject: "event_user_1" });
  const created = await t.mutation(createCallDraft, {
    schemaVersion: 1,
    idempotencyKey: `event-create-${crypto.randomUUID()}`,
    questionIds: ["latest-check-in-time", "advance-notice-required"],
  });
  const quotedAt = new Date().toISOString();
  await t.run(async (ctx) => {
    await ctx.db.patch(created.taskId as any, {
      pricingState: "ready",
      pricingRevision: 1,
      pricingDestinationCountry: "Japan",
      pricingDestinationIsoCountry: "JP",
      pricingRateDescription: "Programmable Outbound Minute - Japan",
      pricingCurrentPricePerMinute: "0.0746",
      pricingCurrency: "USD",
      pricingMaximumConnectedSeconds: 180,
      pricingEstimatedMaximumPstnCharge: "0.2238",
      pricingQuotedAt: quotedAt,
      pricingExpiresAt: new Date(Date.now() + 5 * 60 * 1_000).toISOString(),
      pricingSource: "twilio_public_outbound_pricing_csv",
      pricingAccountSpecific: false,
    });
  });
  const intent = await t.mutation(createConfirmationIntent, {
    schemaVersion: 1,
    taskId: created.taskId,
    expectedRevision: 1,
    idempotencyKey: `event-intent-${crypto.randomUUID()}`,
  });
  const confirmed = await t.mutation(confirmAndQueue, {
    schemaVersion: 1,
    taskId: created.taskId,
    expectedRevision: 1,
    confirmationIntentId: intent.intentId,
    idempotencyKey: `event-confirm-${crypto.randomUUID()}`,
  });
  await t.mutation(acquireDispatchLease, { taskId: created.taskId, attemptId: confirmed.attemptId });
  return { t, taskId: created.taskId as string, attemptId: confirmed.attemptId as string };
}

function event(input: {
  taskId: string;
  attemptId: string;
  workerSequence: number;
  observedAt: string;
  body: Pick<AttemptEvent, "type" | "publicPayload">;
}): AttemptEvent {
  return {
    schemaVersion: 1,
    eventId: `${input.attemptId}:${input.workerSequence}:${input.body.type}`,
    taskId: input.taskId,
    attemptId: input.attemptId,
    workerSequence: input.workerSequence,
    observedAt: input.observedAt,
    source: "telephony_worker",
    ...input.body,
  } as AttemptEvent;
}

describe("hotel demo event and result projection", () => {
  it("deduplicates event IDs and exposes only server-sequenced public Activity", async () => {
    const { t, taskId, attemptId } = await activeAttempt();
    const now = new Date().toISOString();
    const connected = event({ taskId, attemptId, workerSequence: 1, observedAt: now, body: { type: "connected", publicPayload: {} } });
    expect(await t.mutation(ingestAttemptEvent, { event: connected, receivedAt: now })).toBe("accepted");
    expect(await t.mutation(ingestAttemptEvent, { event: connected, receivedAt: now })).toBe("duplicate");

    const status = await t.query(getCallStatus, { schemaVersion: 1, taskId, afterActivitySequence: 0 });
    expect(status.events.map(({ activitySequence }: { activitySequence: number }) => activitySequence)).toEqual([1, 2, 3, 4]);
    expect(status.events.at(-1)?.event).toMatchObject({ type: "connected", source: "telephony_worker" });
  });

  it("marks a gap after two seconds and projects a late backfill at a new Activity sequence", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T05:00:00.000Z"));
    const { t, taskId, attemptId } = await activeAttempt();
    const now = new Date().toISOString();
    const sequenceTwo = event({ taskId, attemptId, workerSequence: 2, observedAt: now, body: { type: "disclosure_delivered", publicPayload: { disclosureId: "ai-assistant-ja-v2" } } });
    expect(await t.mutation(ingestAttemptEvent, { event: sequenceTwo, receivedAt: now })).toBe("buffered");
    vi.advanceTimersByTime(2_000);
    await t.finishInProgressScheduledFunctions();
    const sequenceOne = event({ taskId, attemptId, workerSequence: 1, observedAt: now, body: { type: "connected", publicPayload: {} } });
    expect(await t.mutation(ingestAttemptEvent, { event: sequenceOne, receivedAt: now })).toBe("accepted");

    const status = await t.query(getCallStatus, { schemaVersion: 1, taskId, afterActivitySequence: 0 });
    const workerItems = status.events.filter(({ event: item }: { event: AttemptEvent }) => item.source === "telephony_worker");
    expect(workerItems.map(({ event: item }: { event: AttemptEvent }) => item.workerSequence)).toEqual([2, 1]);
    expect(workerItems.map(({ gapBefore }: { gapBefore: boolean }) => gapBefore)).toEqual([true, true]);
  });

  it("projects an evidence-bound partial result and freezes it against late events", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T06:00:00.000Z"));
    const { t, taskId, attemptId } = await activeAttempt();
    const start = new Date().toISOString();
    const bodies: Array<Pick<AttemptEvent, "type" | "publicPayload">> = [
      { type: "connected", publicPayload: {} },
      { type: "disclosure_delivered", publicPayload: { disclosureId: "ai-assistant-ja-v2" } },
      { type: "fact_observed", publicPayload: { questionId: "latest-check-in-time", sourceText: "最終チェックインは午前1時です。", translatedValue: "Latest check-in is 1:00 a.m.", extractionConfidence: 0.96, translationConfidence: 0.94 } },
      { type: "fact_observed", publicPayload: { questionId: "advance-notice-required", sourceText: "連絡してください。", translatedValue: "Please notify the front desk.", extractionConfidence: 0.8, translationConfidence: 0.95 } },
      { type: "ended", publicPayload: { reason: "completed" } },
    ];
    for (const [index, body] of bodies.entries()) {
      const observedAt = new Date(new Date(start).getTime() + index * 1_000).toISOString();
      await t.mutation(ingestAttemptEvent, {
        event: event({ taskId, attemptId, workerSequence: index + 1, observedAt, body }),
        receivedAt: observedAt,
      });
    }
    vi.advanceTimersByTime(5_000);
    await t.finishInProgressScheduledFunctions();
    const result = await t.query(getCallResult, { schemaVersion: 1, taskId });
    expect(result).toMatchObject({
      status: "ready",
      result: {
        outcome: "partial",
        disclosureStatus: "delivered",
        commitmentSafety: "none_observed",
        facts: [
          { questionId: "latest-check-in-time", status: "reported", value: "Latest check-in is 1:00 a.m." },
          { questionId: "advance-notice-required", status: "ambiguous", value: null },
        ],
      },
    });

    const lateAt = new Date(new Date(start).getTime() + 7_000).toISOString();
    const late = event({ taskId, attemptId, workerSequence: 6, observedAt: lateAt, body: { type: "failed", publicPayload: { stage: "callback", code: "LATE_CALLBACK" } } });
    expect(await t.mutation(ingestAttemptEvent, { event: late, receivedAt: lateAt })).toBe("private_only");
    expect(await t.query(getCallResult, { schemaVersion: 1, taskId })).toEqual(result);
  });
});
