// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  HOTEL_DEMO_SCHEMA_VERSION,
  type CreateCallDraftInput,
  type CreateCallDraftOutput,
  type ReadCallDraftInput,
  type ReadCallDraftOutput,
  type UpdateCallDraftInput,
  type UpdateCallDraftOutput,
} from "../shared/hotelDemoContracts.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.{ts,js}");
const createCallDraft = makeFunctionReference<"mutation", CreateCallDraftInput, CreateCallDraftOutput>("hotelDemo:createCallDraft");
const updateCallDraft = makeFunctionReference<"mutation", UpdateCallDraftInput, UpdateCallDraftOutput>("hotelDemo:updateCallDraft");
const readCallDraft = makeFunctionReference<"query", ReadCallDraftInput, ReadCallDraftOutput>("hotelDemo:readCallDraft");
const createConfirmationIntent = makeFunctionReference<"mutation">("hotelDemo:createConfirmationIntent");
const confirmAndQueue = makeFunctionReference<"mutation">("hotelDemo:confirmAndQueue");
const requestStop = makeFunctionReference<"mutation">("hotelDemo:requestStop");
const acquireDispatchLease = makeFunctionReference<"mutation">("hotelDemo:acquireDispatchLease");

const policyEnvironment = {
  CALLBRIDGE_DEMO_RECIPIENT_APPROVED: "true",
  CALLBRIDGE_DEMO_LEGAL_APPROVED: "true",
  CALLBRIDGE_DEMO_DESTINATION_DISPLAY_NAME: "Sakura Hotel Kyoto",
  CALLBRIDGE_DEMO_DESTINATION_PHONE_E164: "+81751234142",
  CALLBRIDGE_DEMO_DESTINATION_MASKED_PHONE: "+81 75 ••• •142",
  CALLBRIDGE_DEMO_DISCLOSURE_JA: "AIアシスタントです。通話は文字起こしされ、録音されません。構造化された結果は24時間保持されます。",
  CALLBRIDGE_DEMO_DISCLOSURE_APPROVED_AT: "2026-08-26T00:00:00.000Z",
} as const;

const originalEnvironment = Object.fromEntries(
  Object.keys(policyEnvironment).map((name) => [name, process.env[name]]),
);

function enableApprovedPolicy() {
  Object.assign(process.env, policyEnvironment);
}

function authenticatedTest() {
  return convexTest(schema, modules).withIdentity({ subject: "user_test_1" });
}

function createArgs(idempotencyKey = "create-key-0001"): CreateCallDraftInput {
  return {
    schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
    idempotencyKey,
    questionIds: ["latest-check-in-time", "advance-notice-required"],
  };
}

async function seedCurrentQuote(t: ReturnType<typeof authenticatedTest>, taskId: string, revision = 1) {
  const quotedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 5 * 60 * 1_000).toISOString();
  await t.run(async (ctx) => {
    await ctx.db.patch(taskId as any, {
      pricingState: "ready",
      pricingRevision: revision,
      pricingDestinationCountry: "Japan",
      pricingDestinationIsoCountry: "JP",
      pricingRateDescription: "Programmable Outbound Minute - Japan",
      pricingCurrentPricePerMinute: "0.0746",
      pricingCurrency: "USD",
      pricingMaximumConnectedSeconds: 180,
      pricingEstimatedMaximumPstnCharge: "0.2238",
      pricingQuotedAt: quotedAt,
      pricingExpiresAt: expiresAt,
      pricingSource: "twilio_public_outbound_pricing_csv",
      pricingAccountSpecific: false,
    });
  });
}

beforeEach(() => {
  for (const name of Object.keys(policyEnvironment)) delete process.env[name];
});

afterEach(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("hotel demo state machine", () => {
  it("requires an authenticated owner and an explicitly approved demo policy", async () => {
    const unauthenticated = convexTest(schema, modules);
    await expect(unauthenticated.mutation(createCallDraft, createArgs())).rejects.toMatchObject({
      data: { code: "UNAUTHENTICATED" },
    });

    const authenticated = authenticatedTest();
    await expect(authenticated.mutation(createCallDraft, createArgs())).rejects.toMatchObject({
      data: { code: "DEMO_POLICY_DENIED" },
    });
  });

  it("keeps create idempotency truthful after the draft advances", async () => {
    enableApprovedPolicy();
    const t = authenticatedTest();
    const created = await t.mutation(createCallDraft, createArgs());
    const updated = await t.mutation(updateCallDraft, {
      schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
      taskId: created.taskId,
      expectedRevision: created.revision,
      patch: { questionIds: ["after-midnight-allowed", "late-arrival-fee"] },
    });
    const repeated = await t.mutation(createCallDraft, createArgs());

    expect(updated.revision).toBe(2);
    expect(repeated.taskId).toBe(created.taskId);
    expect(repeated.revision).toBe(2);
    expect(repeated.draft.revision).toBe(2);
    expect(repeated.draft.questionIds).toEqual(["after-midnight-allowed", "late-arrival-fee"]);
  });

  it("rejects stale revisions and does not advance an identical update", async () => {
    enableApprovedPolicy();
    const t = authenticatedTest();
    const created = await t.mutation(createCallDraft, createArgs());
    const identical = await t.mutation(updateCallDraft, {
      schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
      taskId: created.taskId,
      expectedRevision: 1,
      patch: { questionIds: [...created.draft.questionIds] },
    });
    expect(identical).toMatchObject({ revision: 1, confirmationReset: false });

    await expect(t.mutation(updateCallDraft, {
      schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
      taskId: created.taskId,
      expectedRevision: 2,
      patch: { questionIds: ["after-midnight-allowed"] },
    })).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });
  });

  it("consumes one exact-revision human intent into exactly one queued attempt", async () => {
    enableApprovedPolicy();
    const t = authenticatedTest();
    const created = await t.mutation(createCallDraft, createArgs());
    await expect(t.mutation(createConfirmationIntent, {
      schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
      taskId: created.taskId,
      expectedRevision: created.revision,
      idempotencyKey: "intent-needs-rate-0001",
    })).rejects.toMatchObject({ data: { code: "PRICE_QUOTE_REQUIRED" } });
    await seedCurrentQuote(t, created.taskId, created.revision);
    const intent = await t.mutation(createConfirmationIntent, {
      schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
      taskId: created.taskId,
      expectedRevision: created.revision,
      idempotencyKey: "intent-key-0001",
    });
    const confirmationArgs = {
      schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
      taskId: created.taskId,
      expectedRevision: created.revision,
      confirmationIntentId: intent.intentId,
      idempotencyKey: "confirm-key-0001",
    };
    const first = await t.mutation(confirmAndQueue, confirmationArgs);
    const repeated = await t.mutation(confirmAndQueue, confirmationArgs);
    const stored = await t.run(async (ctx) => ctx.db.query("hotelDemoAttempts").collect());
    const refreshed = await t.query(readCallDraft, {
      schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
      taskId: created.taskId,
    });

    expect(first).toEqual(repeated);
    expect(first).toMatchObject({ taskStatus: "confirmed", attemptStatus: "queued", revision: 1 });
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ attemptNumber: 1, status: "queued", confirmedRevision: 1 });
    expect(refreshed.draft.confirmation.state).toBe("confirmed");
  });

  it("expires an unconsumed intent back to draft without creating an attempt", async () => {
    enableApprovedPolicy();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T04:00:00.000Z"));
    try {
      const t = authenticatedTest();
      const created = await t.mutation(createCallDraft, createArgs("create-expiry-0001"));
      await seedCurrentQuote(t, created.taskId, created.revision);
      await t.mutation(createConfirmationIntent, {
        schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
        taskId: created.taskId,
        expectedRevision: created.revision,
        idempotencyKey: "intent-expiry-0001",
      });
      await t.finishAllScheduledFunctions(() => vi.advanceTimersByTime(5 * 60 * 1_000));
      const refreshed = await t.query(readCallDraft, {
        schemaVersion: HOTEL_DEMO_SCHEMA_VERSION,
        taskId: created.taskId,
      });
      const attempts = await t.run(async (ctx) => ctx.db.query("hotelDemoAttempts").collect());

      expect(refreshed.status).toBe("draft");
      expect(refreshed.draft.confirmation).toEqual({ state: "expired", intentId: null, expiresAt: null });
      expect(attempts).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("lets queued cancellation win before a dispatch lease", async () => {
    enableApprovedPolicy();
    const t = authenticatedTest();
    const created = await t.mutation(createCallDraft, createArgs("create-cancel-0001"));
    await seedCurrentQuote(t, created.taskId, created.revision);
    const intent = await t.mutation(createConfirmationIntent, {
      schemaVersion: 1,
      taskId: created.taskId,
      expectedRevision: 1,
      idempotencyKey: "intent-cancel-0001",
    });
    const confirmed = await t.mutation(confirmAndQueue, {
      schemaVersion: 1,
      taskId: created.taskId,
      expectedRevision: 1,
      confirmationIntentId: intent.intentId,
      idempotencyKey: "confirm-cancel-0001",
    });
    const stopArgs = {
      schemaVersion: 1,
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      expectedRevision: 1,
      idempotencyKey: "stop-cancel-0001",
    };
    const stopped = await t.mutation(requestStop, stopArgs);
    const repeated = await t.mutation(requestStop, stopArgs);

    expect(stopped).toEqual({ taskStatus: "stopped", attemptStatus: "cancelled" });
    expect(repeated).toEqual(stopped);
    await expect(t.mutation(acquireDispatchLease, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
    })).rejects.toMatchObject({ data: { code: "INVALID_TRANSITION" } });
  });

  it("lets the dispatch lease win before an active end request", async () => {
    enableApprovedPolicy();
    const t = authenticatedTest();
    const created = await t.mutation(createCallDraft, createArgs("create-end-0001"));
    await seedCurrentQuote(t, created.taskId, created.revision);
    const intent = await t.mutation(createConfirmationIntent, {
      schemaVersion: 1,
      taskId: created.taskId,
      expectedRevision: 1,
      idempotencyKey: "intent-end-0001",
    });
    const confirmed = await t.mutation(confirmAndQueue, {
      schemaVersion: 1,
      taskId: created.taskId,
      expectedRevision: 1,
      confirmationIntentId: intent.intentId,
      idempotencyKey: "confirm-end-0001",
    });
    const lease = await t.mutation(acquireDispatchLease, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
    });
    const stopped = await t.mutation(requestStop, {
      schemaVersion: 1,
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      expectedRevision: 1,
      idempotencyKey: "stop-end-0001",
    });

    expect(lease).toMatchObject({ taskId: created.taskId, attemptId: confirmed.attemptId, confirmedRevision: 1 });
    expect(stopped).toEqual({ taskStatus: "stopped", attemptStatus: "ending" });
    const events = await t.run(async (ctx) => ctx.db.query("hotelDemoActivityEvents").collect());
    expect(events.filter(({ event }) => event.type === "end_requested")).toHaveLength(1);
  });
});
