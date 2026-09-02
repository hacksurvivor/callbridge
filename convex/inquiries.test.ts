// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import type { InquiryCallContract } from "../shared/inquiryContracts.js";
import { INQUIRY_ACCEPTANCE_SCENARIOS } from "../shared/inquiryAcceptanceFixtures.js";
import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../shared/inquiryFixtures.js";
import type { InquiryCallResult } from "../shared/inquiryState.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.{ts,js}");
const createDraft = makeFunctionReference<"mutation">("inquiries:createDraft");
const readDraft = makeFunctionReference<"query">("inquiries:readDraft");
const updateDraft = makeFunctionReference<"mutation">("inquiries:updateDraft");
const createConfirmationIntent = makeFunctionReference<"mutation">("inquiries:createConfirmationIntent");
const beginPricingQuote = makeFunctionReference<"mutation">("inquiryPricing:beginPricingQuote");
const storePricingQuote = makeFunctionReference<"mutation">("inquiryPricing:storePricingQuote");
const confirmAndQueue = makeFunctionReference<"mutation">("inquiries:confirmAndQueue");
const grantCredits = makeFunctionReference<"mutation">("inquiries:grantCredits");
const getCreditBalance = makeFunctionReference<"query">("inquiries:getCreditBalance");
const savePlaybookDraft = makeFunctionReference<"mutation">("inquiries:savePlaybookDraft");
const approvePlaybook = makeFunctionReference<"mutation">("inquiries:approvePlaybook");
const recordWorkerEvent = makeFunctionReference<"mutation">("inquiries:recordWorkerEvent");
const claimDispatch = makeFunctionReference<"mutation">("inquiryDispatch:claimDispatch");
const recordDispatchAccepted = makeFunctionReference<"mutation">("inquiryDispatch:recordDispatchAccepted");
const recordDispatchDefinitelyNotCreated = makeFunctionReference<"mutation">(
  "inquiryDispatch:recordDispatchDefinitelyNotCreated",
);
const publishResult = makeFunctionReference<"mutation">("inquiries:publishResult");
const settleResultCost = makeFunctionReference<"mutation">("inquiries:settleResultCost");
const getResult = makeFunctionReference<"query">("inquiries:getResult");
const listEvents = makeFunctionReference<"query">("inquiries:listEvents");

function authenticated(subject = "inquiry_user_1") {
  return convexTest(schema, modules).withIdentity({ subject });
}

async function signedWorkerCallback(
  t: ReturnType<typeof authenticated>,
  callback: Record<string, unknown>,
) {
  const secret = "integration-worker-secret";
  process.env.CALLBRIDGE_TELEPHONY_WEBHOOK_SECRET = secret;
  const rawBody = JSON.stringify(callback);
  const timestamp = Math.floor(Date.now() / 1_000).toString();
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${rawBody}`));
  const signature = [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
  const response = await t.fetch("/webhooks/inquiry-worker", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-callbridge-signature": signature,
      "x-callbridge-timestamp": timestamp,
    },
    body: rawBody,
  });
  if (!response.ok) throw new Error(`Signed callback failed at HTTP boundary (${response.status})`);
  const payload = await response.json() as { result: unknown };
  return payload.result;
}

function contractWithoutPlaybook(): InquiryCallContract {
  const { playbook: _playbook, ...contract } = structuredClone(HOTEL_INQUIRY_GOLDEN_FIXTURE);
  return contract;
}

async function giveCredits(
  t: ReturnType<typeof authenticated>,
  ownerId = "inquiry_user_1",
  amountMinorUnits = 1_000,
) {
  return await t.mutation(grantCredits, {
    ownerId,
    currency: "USD",
    amountMinorUnits,
    idempotencyKey: `credits-${ownerId}-${amountMinorUnits}`,
  });
}

async function priceDraft(
  t: ReturnType<typeof authenticated>,
  draft: { taskId: string; revision: number; executionRevision: string; contract: InquiryCallContract },
  ownerId = "inquiry_user_1",
) {
  const quotedAt = new Date().toISOString();
  const pricingRequest = await t.mutation(beginPricingQuote, {
    taskId: draft.taskId,
    ownerId,
    expectedRevision: draft.revision,
    expectedExecutionRevision: draft.executionRevision,
  });
  await t.mutation(storePricingQuote, {
    taskId: draft.taskId,
    ownerId,
    requestId: pricingRequest.requestId,
    quote: {
      quoteId: crypto.randomUUID(),
      revision: draft.revision,
      executionRevision: draft.executionRevision,
      provider: "twilio",
      destination: {
        isoCountry: draft.contract.destination.countryCode,
        country: draft.contract.destination.countryCode,
        maskedPhone: "+81…4142",
      },
      policy: { allowed: true, riskTier: "low_risk_only", provisioning: "just_in_time" },
      pstn: {
        rateDescription: "Programmable outbound minute",
        currentPricePerMinute: "0.0746",
        currency: draft.contract.costCeiling.currency,
        maximumConnectedSeconds: draft.contract.policy.maxConnectedSeconds,
        estimatedMaximumCharge: "0.2238",
      },
      quote: {
        quotedAt,
        expiresAt: new Date(Date.parse(quotedAt) + 5 * 60 * 1_000).toISOString(),
        source: "twilio_public_outbound_pricing_csv",
        accountSpecific: false,
      },
      exclusions: ["twilio_media_streams", "openai_realtime_audio", "taxes_and_carrier_surcharges"],
    },
  });
}

async function createFundedDraft(
  t: ReturnType<typeof authenticated>,
  idempotencyKey = "create-inquiry-0001",
) {
  await giveCredits(t);
  const draft = await t.mutation(createDraft, {
    idempotencyKey,
    contract: contractWithoutPlaybook(),
  });
  await priceDraft(t, draft);
  return draft;
}

async function confirmDraft(
  t: ReturnType<typeof authenticated>,
  created: { taskId: string; revision: number; executionRevision: string },
  suffix = "0001",
) {
  const intent = await t.mutation(createConfirmationIntent, {
    taskId: created.taskId,
    expectedRevision: created.revision,
    expectedExecutionRevision: created.executionRevision,
    idempotencyKey: `intent-inquiry-${suffix}`,
  });
  return await t.mutation(confirmAndQueue, {
    taskId: created.taskId,
    expectedRevision: created.revision,
    expectedExecutionRevision: created.executionRevision,
    confirmationIntentId: intent.intentId,
    idempotencyKey: `confirm-inquiry-${suffix}`,
  });
}

function answeredResult(
  contract: InquiryCallContract,
  executionRevision: string,
): InquiryCallResult {
  return {
    schemaVersion: 1,
    executionRevision: executionRevision as InquiryCallResult["executionRevision"],
    outcome: "answered",
    summary: "The business answered every requested question without making a commitment.",
    answers: contract.questions.map((question, index) => ({
      questionId: question.id,
      status: "reported" as const,
      value: `Answer ${index + 1}`,
      evidence: {
        sourceEventId: `worker-event-${index + 1}`,
        sourceExcerpt: `Evidence ${index + 1}`,
      },
    })),
    unresolvedQuestionIds: [],
    durationSeconds: 91,
    disclosureStatus: "delivered",
    commitmentSafety: "none_observed",
    terminalReason: "completed",
    terminalAt: "2026-08-26T13:30:00.000Z",
  };
}

async function recordAnsweredCall(
  t: ReturnType<typeof authenticated>,
  created: { taskId: string; executionRevision: string; contract: InquiryCallContract },
  attemptId: string,
) {
  const lease = await t.mutation(claimDispatch, {
    taskId: created.taskId,
    attemptId,
    expectedExecutionRevision: created.executionRevision,
    claimIdempotencyKey: `claim-${attemptId}`,
  });
  await t.mutation(recordDispatchAccepted, {
    taskId: created.taskId,
    attemptId,
    leaseToken: lease.leaseToken,
    externalCallId: `call-${attemptId}`,
    occurredAt: "2026-08-26T13:00:00.000Z",
  });
  let workerSequence = 1;
  const record = async (input: {
    eventId: string;
    type: "connected" | "answer_observed" | "call_ended";
    questionId?: string;
    evidenceExcerpt?: string;
  }) => await t.mutation(recordWorkerEvent, {
    taskId: created.taskId,
    attemptId,
    eventId: input.eventId,
    workerSequence: workerSequence++,
    type: input.type,
    ...(input.questionId ? { questionId: input.questionId } : {}),
    ...(input.evidenceExcerpt ? { evidenceExcerpt: input.evidenceExcerpt } : {}),
    occurredAt: `2026-08-26T13:${String(workerSequence).padStart(2, "0")}:00.000Z`,
    executionRevision: created.executionRevision,
  });

  await record({ eventId: "worker-connected-0001", type: "connected" });
  for (const [index, question] of created.contract.questions.entries()) {
    await record({
      eventId: `worker-event-${index + 1}`,
      type: "answer_observed",
      questionId: question.id,
      evidenceExcerpt: `Evidence ${index + 1}`,
    });
  }
  await record({ eventId: "worker-ended-0001", type: "call_ended" });
}

describe("general inquiry Convex state", () => {
  it("requires authentication and isolates every task by owner", async () => {
    const unauthenticated = convexTest(schema, modules);
    await expect(unauthenticated.mutation(createDraft, {
      idempotencyKey: "create-unauthenticated",
      contract: contractWithoutPlaybook(),
    })).rejects.toMatchObject({ data: { code: "UNAUTHENTICATED" } });

    const base = convexTest(schema, modules);
    const owner = base.withIdentity({ subject: "owner_a" });
    const created = await owner.mutation(createDraft, {
      idempotencyKey: "create-owner-a-0001",
      contract: contractWithoutPlaybook(),
    });
    const otherUser = base.withIdentity({ subject: "owner_b" });
    await expect(otherUser.query(readDraft, { taskId: created.taskId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });

  it("keeps create idempotent and revokes confirmation after any material edit", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity({ subject: "inquiry_user_1" });
    const contract = contractWithoutPlaybook();
    const first = await t.mutation(createDraft, {
      idempotencyKey: "create-idempotent-0001",
      contract,
    });
    const repeated = await t.mutation(createDraft, {
      idempotencyKey: "create-idempotent-0001",
      contract,
    });
    expect(repeated).toEqual(first);
    await expect(t.mutation(createDraft, {
      idempotencyKey: "create-idempotent-0001",
      contract: { ...contract, objective: "A conflicting body must not reuse the same key." },
    })).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_CONFLICT" } });

    await giveCredits(t);
    await priceDraft(t, first);
    const intent = await t.mutation(createConfirmationIntent, {
      taskId: first.taskId,
      expectedRevision: first.revision,
      expectedExecutionRevision: first.executionRevision,
      idempotencyKey: "intent-before-edit-0001",
    });
    const editedContract = structuredClone(contract);
    editedContract.context.privateBackground = "The traveler now expects to arrive around 01:30.";
    const edited = await t.mutation(updateDraft, {
      taskId: first.taskId,
      expectedRevision: first.revision,
      contract: editedContract,
    });

    expect(edited.confirmationReset).toBe(true);
    expect(edited.task).toMatchObject({ revision: 2, status: "draft" });
    expect(edited.task.executionRevision).not.toBe(first.executionRevision);
    await expect(t.mutation(createDraft, {
      idempotencyKey: "create-idempotent-0001",
      contract,
    })).resolves.toMatchObject({ revision: 2, executionRevision: edited.task.executionRevision });
    await expect(t.mutation(confirmAndQueue, {
      taskId: first.taskId,
      expectedRevision: first.revision,
      expectedExecutionRevision: first.executionRevision,
      confirmationIntentId: intent.intentId,
      idempotencyKey: "confirm-stale-edit-0001",
    })).rejects.toMatchObject({ data: { code: "INTENT_REVOKED" } });
  });

  it("requires available platform credits before presenting confirmation", async () => {
    const t = authenticated();
    const created = await t.mutation(createDraft, {
      idempotencyKey: "create-no-credit-0001",
      contract: contractWithoutPlaybook(),
    });
    await expect(t.mutation(createConfirmationIntent, {
      taskId: created.taskId,
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
      idempotencyKey: "intent-no-credit-0001",
    })).rejects.toMatchObject({
      data: {
        code: "INSUFFICIENT_CREDITS",
        requiredMinorUnits: 500,
        availableMinorUnits: 0,
      },
    });
  });

  it("requires a fresh provider quote and binds it to the displayed destination", async () => {
    const t = authenticated();
    await giveCredits(t);
    const created = await t.mutation(createDraft, {
      idempotencyKey: "create-pricing-required",
      contract: contractWithoutPlaybook(),
    });
    await expect(t.mutation(createConfirmationIntent, {
      taskId: created.taskId,
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
      idempotencyKey: "intent-pricing-required",
    })).rejects.toMatchObject({ data: { code: "PRICING_REQUIRED" } });

    const mismatched = await t.mutation(createDraft, {
      idempotencyKey: "create-pricing-country-mismatch",
      contract: contractWithoutPlaybook(),
    });
    mismatched.contract.destination.countryCode = "GE";
    await expect(priceDraft(t, mismatched)).rejects.toMatchObject({
      data: { code: "DESTINATION_COUNTRY_MISMATCH" },
    });
    await priceDraft(t, created);
    await expect(t.mutation(createConfirmationIntent, {
      taskId: created.taskId,
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
      idempotencyKey: "intent-pricing-ready",
    })).resolves.toMatchObject({ pricingQuoteId: expect.any(String) });
  });

  it("expires a stale confirmation before refreshing its quote", async () => {
    const t = authenticated();
    await giveCredits(t);
    const created = await t.mutation(createDraft, {
      idempotencyKey: "create-expired-pricing-refresh",
      contract: contractWithoutPlaybook(),
    });
    await priceDraft(t, created);
    const intent = await t.mutation(createConfirmationIntent, {
      taskId: created.taskId,
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
      idempotencyKey: "intent-expired-pricing-refresh",
    });
    await t.run(async (ctx) => {
      await ctx.db.patch("inquiryTasks", created.taskId, {
        confirmationExpiresAt: "2026-01-01T00:00:00.000Z",
        pricingRequestedAt: "2026-01-01T00:00:00.000Z",
      });
    });

    await expect(t.mutation(beginPricingQuote, {
      taskId: created.taskId,
      ownerId: "inquiry_user_1",
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
    })).resolves.toMatchObject({ requestId: expect.any(String) });
    const state = await t.run(async (ctx) => ({
      task: await ctx.db.get("inquiryTasks", created.taskId),
      intent: await ctx.db.get("inquiryConfirmationIntents", intent.intentId as never),
    }));
    expect(state.task).toMatchObject({
      status: "draft",
      confirmationState: "expired",
    });
    expect(state.task).not.toHaveProperty("confirmationIntentId");
    expect(state.task).not.toHaveProperty("pricingQuote");
    expect(state.intent).toMatchObject({ state: "expired" });
  });

  it("rate-limits pricing refreshes per task and across an authenticated account", async () => {
    const t = authenticated();
    const first = await t.mutation(createDraft, {
      idempotencyKey: "create-pricing-throttle-0",
      contract: contractWithoutPlaybook(),
    });
    await t.mutation(beginPricingQuote, {
      taskId: first.taskId,
      ownerId: "inquiry_user_1",
      expectedRevision: first.revision,
      expectedExecutionRevision: first.executionRevision,
    });
    await expect(t.mutation(beginPricingQuote, {
      taskId: first.taskId,
      ownerId: "inquiry_user_1",
      expectedRevision: first.revision,
      expectedExecutionRevision: first.executionRevision,
    })).rejects.toMatchObject({ data: { code: "PRICING_RATE_LIMITED" } });

    for (let index = 1; index < 10; index += 1) {
      const draft = await t.mutation(createDraft, {
        idempotencyKey: `create-pricing-throttle-${index}`,
        contract: contractWithoutPlaybook(),
      });
      await t.mutation(beginPricingQuote, {
        taskId: draft.taskId,
        ownerId: "inquiry_user_1",
        expectedRevision: draft.revision,
        expectedExecutionRevision: draft.executionRevision,
      });
    }
    const overflow = await t.mutation(createDraft, {
      idempotencyKey: "create-pricing-throttle-overflow",
      contract: contractWithoutPlaybook(),
    });
    await expect(t.mutation(beginPricingQuote, {
      taskId: overflow.taskId,
      ownerId: "inquiry_user_1",
      expectedRevision: overflow.revision,
      expectedExecutionRevision: overflow.executionRevision,
    })).rejects.toMatchObject({ data: { code: "PRICING_RATE_LIMITED" } });
  });

  it("does not charge stale quote requests against quota and keeps cooldown after success", async () => {
    const t = authenticated();
    const created = await t.mutation(createDraft, {
      idempotencyKey: "create-pricing-stale-quota",
      contract: contractWithoutPlaybook(),
    });
    await expect(t.mutation(beginPricingQuote, {
      taskId: created.taskId,
      ownerId: "inquiry_user_1",
      expectedRevision: created.revision + 1,
      expectedExecutionRevision: created.executionRevision,
    })).rejects.toMatchObject({ data: { code: "STALE_REVISION" } });
    const afterStale = await t.run(async (ctx) => ctx.db.query("inquiryPricingRequests").collect());
    expect(afterStale).toHaveLength(0);

    await priceDraft(t, created);
    await expect(t.mutation(beginPricingQuote, {
      taskId: created.taskId,
      ownerId: "inquiry_user_1",
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
    })).rejects.toMatchObject({ data: { code: "PRICING_RATE_LIMITED" } });
  });

  it("allows only one active call per user and rate-limits repeated contact to one destination", async () => {
    const t = authenticated();
    await giveCredits(t, "inquiry_user_1", 10_000);
    const first = await t.mutation(createDraft, {
      idempotencyKey: "create-active-limit-1",
      contract: contractWithoutPlaybook(),
    });
    await priceDraft(t, first);
    const firstConfirmed = await confirmDraft(t, first, "active-limit-1");

    const second = await t.mutation(createDraft, {
      idempotencyKey: "create-active-limit-2",
      contract: contractWithoutPlaybook(),
    });
    await priceDraft(t, second);
    await expect(t.mutation(createConfirmationIntent, {
      taskId: second.taskId,
      expectedRevision: second.revision,
      expectedExecutionRevision: second.executionRevision,
      idempotencyKey: "intent-active-limit-2",
    })).rejects.toMatchObject({ data: { code: "ACTIVE_CALL_LIMIT" } });

    await t.run(async (ctx) => ctx.db.patch("inquiryAttempts", firstConfirmed.attemptId, {
      status: "failed",
      dispatchState: "accepted",
    }));
    for (let index = 2; index <= 3; index += 1) {
      const created = index === 2 ? second : await t.mutation(createDraft, {
        idempotencyKey: `create-destination-limit-${index}`,
        contract: contractWithoutPlaybook(),
      });
      if (index !== 2) await priceDraft(t, created);
      const confirmed = await confirmDraft(t, created, `destination-limit-${index}`);
      await t.run(async (ctx) => ctx.db.patch("inquiryAttempts", confirmed.attemptId, {
        status: "failed",
        dispatchState: "accepted",
      }));
    }
    const fourth = await t.mutation(createDraft, {
      idempotencyKey: "create-destination-limit-4",
      contract: contractWithoutPlaybook(),
    });
    await priceDraft(t, fourth);
    await expect(t.mutation(createConfirmationIntent, {
      taskId: fourth.taskId,
      expectedRevision: fourth.revision,
      expectedExecutionRevision: fourth.executionRevision,
      idempotencyKey: "intent-destination-limit-4",
    })).rejects.toMatchObject({ data: { code: "DESTINATION_RATE_LIMITED" } });
  });

  it("does not rate-limit attempts proven definitely not created", async () => {
    const t = authenticated();
    await giveCredits(t);
    for (let index = 1; index <= 3; index += 1) {
      const created = await t.mutation(createDraft, {
        idempotencyKey: `create-definite-absence-${index}`,
        contract: contractWithoutPlaybook(),
      });
      await priceDraft(t, created);
      const confirmed = await confirmDraft(t, created, `definite-absence-${index}`);
      const lease = await t.mutation(claimDispatch, {
        taskId: created.taskId,
        attemptId: confirmed.attemptId,
        expectedExecutionRevision: created.executionRevision,
        claimIdempotencyKey: `claim-definite-absence-${index}`,
      });
      await t.mutation(recordDispatchDefinitelyNotCreated, {
        taskId: created.taskId,
        attemptId: confirmed.attemptId,
        leaseToken: lease.leaseToken,
        failureCode: "TEST_PROVIDER_REJECTED",
        occurredAt: new Date().toISOString(),
      });
    }

    const fourth = await t.mutation(createDraft, {
      idempotencyKey: "create-after-definite-absence",
      contract: contractWithoutPlaybook(),
    });
    await priceDraft(t, fourth);
    await expect(t.mutation(createConfirmationIntent, {
      taskId: fourth.taskId,
      expectedRevision: fourth.revision,
      expectedExecutionRevision: fourth.executionRevision,
      idempotencyKey: "intent-after-definite-absence",
    })).resolves.toMatchObject({ executionRevision: fourth.executionRevision });
  });

  it("requires explicit approval for user-created playbooks and resets it after edits", async () => {
    const t = authenticated();
    const draftPlaybook = await t.mutation(savePlaybookDraft, {
      id: "clinic-admin",
      name: "Clinic administrative inquiry",
      steps: [{ id: "ask-hours", instruction: "Ask which appointment hours are available." }],
    });
    expect(draftPlaybook).toEqual({ id: "clinic-admin", revision: 1, status: "draft" });

    const contract = contractWithoutPlaybook();
    contract.playbook = {
      id: "clinic-admin",
      revision: 1,
      name: "Clinic administrative inquiry",
      source: "user_created",
      steps: [{ id: "ask-hours", instruction: "Ask which appointment hours are available." }],
    };
    const created = await t.mutation(createDraft, {
      idempotencyKey: "create-playbook-0001",
      contract,
    });
    await giveCredits(t);
    await expect(t.mutation(createConfirmationIntent, {
      taskId: created.taskId,
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
      idempotencyKey: "intent-unapproved-playbook",
    })).rejects.toMatchObject({ data: { code: "PLAYBOOK_APPROVAL_REQUIRED" } });

    await t.mutation(approvePlaybook, { id: "clinic-admin", expectedRevision: 1 });
    await priceDraft(t, created);
    await expect(t.mutation(createConfirmationIntent, {
      taskId: created.taskId,
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
      idempotencyKey: "intent-approved-playbook",
    })).resolves.toMatchObject({ executionRevision: created.executionRevision });

    const edited = await t.mutation(savePlaybookDraft, {
      id: "clinic-admin",
      expectedRevision: 1,
      name: "Clinic administrative inquiry",
      steps: [{ id: "ask-hours", instruction: "Ask about weekday and weekend appointment hours." }],
    });
    expect(edited).toEqual({ id: "clinic-admin", revision: 2, status: "draft" });
    const stored = await t.run(async (ctx) => ctx.db.query("inquiryPlaybooks").collect());
    expect(stored[0]).toMatchObject({ status: "draft", revision: 2 });
    expect(stored[0]?.approvedRevision).toBeUndefined();
  });

  it("atomically creates one attempt and one cost reservation for exact confirmation", async () => {
    const t = authenticated();
    const created = await createFundedDraft(t, "create-confirmed-0001");
    const intent = await t.mutation(createConfirmationIntent, {
      taskId: created.taskId,
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
      idempotencyKey: "intent-confirmed-0001",
    });
    const args = {
      taskId: created.taskId,
      expectedRevision: created.revision,
      expectedExecutionRevision: created.executionRevision,
      confirmationIntentId: intent.intentId,
      idempotencyKey: "confirm-confirmed-0001",
    };
    const first = await t.mutation(confirmAndQueue, args);
    const repeated = await t.mutation(confirmAndQueue, args);
    expect(repeated).toEqual(first);

    const state = await t.run(async (ctx) => ({
      attempts: await ctx.db.query("inquiryAttempts").collect(),
      reservations: await ctx.db.query("inquiryCreditReservations").collect(),
      ledger: await ctx.db.query("inquiryCreditLedger").collect(),
    }));
    expect(state.attempts).toHaveLength(1);
    expect(state.attempts[0]).toMatchObject({
      attemptNumber: 1,
      status: "queued",
      confirmedExecutionRevision: created.executionRevision,
    });
    expect(state.reservations).toHaveLength(1);
    expect(state.reservations[0]).toMatchObject({ state: "reserved", reservedMinorUnits: 500 });
    expect(state.ledger.filter(({ kind }) => kind === "reserve")).toHaveLength(1);
    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toEqual({
      currency: "USD",
      balanceMinorUnits: 1_000,
      reservedMinorUnits: 500,
      availableMinorUnits: 500,
    });
  });

  it("deduplicates worker events and rejects gaps in their immutable sequence", async () => {
    const t = authenticated();
    const created = await createFundedDraft(t, "create-worker-sequence");
    const confirmed = await confirmDraft(t, created, "worker-sequence");
    const lease = await t.mutation(claimDispatch, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      expectedExecutionRevision: created.executionRevision,
      claimIdempotencyKey: "claim-worker-sequence",
    });
    await t.mutation(recordDispatchAccepted, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      leaseToken: lease.leaseToken,
      externalCallId: "call-worker-sequence",
      occurredAt: "2026-08-26T13:00:00.000Z",
    });
    const connected = {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      eventId: "worker-sequence-connected",
      workerSequence: 1,
      type: "connected",
      occurredAt: "2026-08-26T13:01:00.000Z",
      executionRevision: created.executionRevision,
    } as const;
    await expect(t.mutation(recordWorkerEvent, connected)).resolves.toMatchObject({ duplicate: false });
    await expect(t.mutation(recordWorkerEvent, connected)).resolves.toMatchObject({ duplicate: true });
    await expect(t.mutation(recordWorkerEvent, {
      ...connected,
      occurredAt: "2026-08-26T13:01:01.000Z",
    })).rejects.toMatchObject({ data: { code: "EVENT_CONFLICT" } });
    await expect(t.mutation(recordWorkerEvent, {
      ...connected,
      eventId: "worker-sequence-gap",
      workerSequence: 3,
      type: "question_started",
      questionId: created.contract.questions[0]!.id,
    })).rejects.toMatchObject({
      data: { code: "WORKER_SEQUENCE_GAP", expectedWorkerSequence: 2 },
    });
  });

  it("turns a recipient decline into a durable platform opt-out before any future dispatch", async () => {
    const t = authenticated();
    const created = await createFundedDraft(t, "create-recipient-optout-1");
    const confirmed = await confirmDraft(t, created, "recipient-optout-1");
    const lease = await t.mutation(claimDispatch, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      expectedExecutionRevision: created.executionRevision,
      claimIdempotencyKey: "claim-recipient-optout-1",
    });
    await t.mutation(recordDispatchAccepted, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      leaseToken: lease.leaseToken,
      externalCallId: "call-recipient-optout-1",
      occurredAt: new Date().toISOString(),
    });
    await t.mutation(recordWorkerEvent, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      eventId: "worker-recipient-optout-connected",
      workerSequence: 1,
      type: "connected",
      occurredAt: new Date().toISOString(),
      executionRevision: created.executionRevision,
    });
    await t.mutation(recordWorkerEvent, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      eventId: "worker-recipient-optout-ended",
      workerSequence: 2,
      type: "call_ended",
      occurredAt: new Date().toISOString(),
      executionRevision: created.executionRevision,
    });
    await t.mutation(recordWorkerEvent, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      eventId: "worker-recipient-optout-declined",
      workerSequence: 3,
      type: "recipient_declined",
      occurredAt: new Date().toISOString(),
      executionRevision: created.executionRevision,
    });

    const repeated = await createFundedDraft(t, "create-recipient-optout-2");
    await expect(t.mutation(createConfirmationIntent, {
      taskId: repeated.taskId,
      expectedRevision: repeated.revision,
      expectedExecutionRevision: repeated.executionRevision,
      idempotencyKey: "intent-recipient-optout-2",
    })).rejects.toMatchObject({ data: { code: "RECIPIENT_OPTED_OUT" } });
  });

  it("prevents two inquiries from reserving the same credits", async () => {
    const t = authenticated();
    await giveCredits(t, "inquiry_user_1", 700);
    const first = await t.mutation(createDraft, {
      idempotencyKey: "create-credit-race-a",
      contract: contractWithoutPlaybook(),
    });
    await priceDraft(t, first);
    await confirmDraft(t, first, "credit-race-a");
    const second = await t.mutation(createDraft, {
      idempotencyKey: "create-credit-race-b",
      contract: contractWithoutPlaybook(),
    });
    await expect(t.mutation(createConfirmationIntent, {
      taskId: second.taskId,
      expectedRevision: second.revision,
      expectedExecutionRevision: second.executionRevision,
      idempotencyKey: "intent-credit-race-b",
    })).rejects.toMatchObject({
      data: { code: "INSUFFICIENT_CREDITS", availableMinorUnits: 200 },
    });
  });

  it("publishes one evidence-backed result and settles only actual call cost", async () => {
    const base = convexTest(schema, modules);
    const t = base.withIdentity({ subject: "inquiry_user_1" });
    const created = await createFundedDraft(t, "create-result-0001");
    const confirmed = await confirmDraft(t, created, "result-0001");
    await recordAnsweredCall(t, created, confirmed.attemptId);
    const result = answeredResult(created.contract, created.executionRevision);
    const args = {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      resultKey: "result-publish-0001",
      actualCostMinorUnits: 123,
      costStatus: "provider_reported" as const,
      result,
    };
    const firstResultId = await t.mutation(publishResult, args);
    const repeatedResultId = await t.mutation(publishResult, args);
    expect(repeatedResultId).toBe(firstResultId);
    await expect(t.mutation(publishResult, {
      ...args,
      actualCostMinorUnits: 124,
    })).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_CONFLICT" } });
    const published = await t.query(getResult, { taskId: created.taskId });
    expect(published).toMatchObject({
      status: "ready",
      result: { outcome: "answered", unresolvedQuestionIds: [] },
      receipt: {
        taskId: created.taskId,
        attemptId: confirmed.attemptId,
        outcome: "answered",
        answeredQuestionIds: created.contract.questions.map((question: { id: string }) => question.id),
        unresolvedQuestionIds: [],
        cost: { currency: "USD", status: "provider_reported", actualMinorUnits: 123 },
      },
    });
    if (published.status !== "ready") throw new Error("Expected a published result receipt.");
    expect(published.receipt.sourceEventIds).toEqual(
      created.contract.questions.map((_: unknown, index: number) => `worker-event-${index + 1}`).sort(),
    );
    expect(JSON.stringify(published.receipt)).not.toMatch(
      /"(?:destinationE164|provider|transcript|audio|privateBackground)"/u,
    );
    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toEqual({
      currency: "USD",
      balanceMinorUnits: 877,
      reservedMinorUnits: 0,
      availableMinorUnits: 877,
    });
    const events = await t.query(listEvents, { taskId: created.taskId });
    expect(events.map(({ sequence }: { sequence: number }) => sequence)).toEqual(
      events.map((_: unknown, index: number) => index + 1),
    );
    expect(events.at(-1)).toMatchObject({ type: "result_ready", executionRevision: created.executionRevision });
    const cursor = events.at(-2)!.sequence;
    const tail = await t.query(listEvents, { taskId: created.taskId, afterSequence: cursor });
    expect(tail.map(({ sequence }: { sequence: number }) => sequence)).toEqual([events.at(-1)!.sequence]);

    const otherUser = base.withIdentity({ subject: "other_result_user" });
    await expect(otherUser.query(getResult, { taskId: created.taskId })).rejects.toMatchObject({
      data: { code: "FORBIDDEN" },
    });
  });

  it("rejects incomplete result projection before settling credits", async () => {
    const t = authenticated();
    const created = await createFundedDraft(t, "create-invalid-result");
    const confirmed = await confirmDraft(t, created, "invalid-result");
    await recordAnsweredCall(t, created, confirmed.attemptId);
    const result = answeredResult(created.contract, created.executionRevision);
    result.answers.pop();
    await expect(t.mutation(publishResult, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      resultKey: "result-invalid-coverage",
      actualCostMinorUnits: 123,
      costStatus: "provider_reported",
      result,
    })).rejects.toMatchObject({ data: { code: "INVALID_RESULT", reason: "question_coverage" } });
    const unverified = answeredResult(created.contract, created.executionRevision);
    unverified.answers[0]!.evidence!.sourceEventId = "worker-event-not-real";
    await expect(t.mutation(publishResult, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      resultKey: "result-unverified-evidence",
      actualCostMinorUnits: 123,
      costStatus: "provider_reported",
      result: unverified,
    })).rejects.toMatchObject({ data: { code: "INVALID_RESULT", reason: "unverified_evidence" } });
    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toMatchObject({
      balanceMinorUnits: 1_000,
      reservedMinorUnits: 500,
    });
  });

  it("keeps the ceiling reserved while provider cost is pending, then settles once", async () => {
    const t = authenticated();
    const created = await createFundedDraft(t, "create-pending-cost");
    const confirmed = await confirmDraft(t, created, "pending-cost");
    await recordAnsweredCall(t, created, confirmed.attemptId);
    await t.mutation(publishResult, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      resultKey: "result-pending-cost",
      actualCostMinorUnits: 0,
      costStatus: "pending",
      result: answeredResult(created.contract, created.executionRevision),
    });
    await expect(t.query(getResult, { taskId: created.taskId })).resolves.toMatchObject({
      status: "ready",
      receipt: { cost: { currency: "USD", status: "pending", actualMinorUnits: null } },
    });
    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toEqual({
      currency: "USD",
      balanceMinorUnits: 1_000,
      reservedMinorUnits: 500,
      availableMinorUnits: 500,
    });
    const before = await t.run(async (ctx) => ctx.db.query("inquiryCreditReservations").collect());
    expect(before[0]).toMatchObject({ state: "reserved", reservedMinorUnits: 500 });

    const settlement = {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      resultKey: "result-pending-cost",
      settlementKey: "pending-cost:settlement",
      actualCostMinorUnits: 145,
    };
    await expect(t.mutation(settleResultCost, settlement)).resolves.toEqual({ duplicate: false });
    await expect(t.mutation(settleResultCost, settlement)).resolves.toEqual({ duplicate: true });
    await expect(t.query(getResult, { taskId: created.taskId })).resolves.toMatchObject({
      status: "ready",
      receipt: { cost: { currency: "USD", status: "provider_reported", actualMinorUnits: 145 } },
    });
    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toEqual({
      currency: "USD",
      balanceMinorUnits: 855,
      reservedMinorUnits: 0,
      availableMinorUnits: 855,
    });
  });

  it("carries a non-hotel clinic inquiry through signed callbacks and cost settlement", async () => {
    const t = authenticated();
    await giveCredits(t);
    const clinic = INQUIRY_ACCEPTANCE_SCENARIOS.find(({ id }) => id === "clinic-thailand")!;
    const created = await t.mutation(createDraft, {
      idempotencyKey: "create-signed-callback",
      contract: structuredClone(clinic.contract),
    });
    await priceDraft(t, created);
    const confirmed = await confirmDraft(t, created, "signed-callback");
    const lease = await t.mutation(claimDispatch, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      expectedExecutionRevision: created.executionRevision,
      claimIdempotencyKey: "claim-signed-callback",
    });
    await t.mutation(recordDispatchAccepted, {
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      leaseToken: lease.leaseToken,
      externalCallId: "call-signed-callback",
      occurredAt: "2026-08-27T05:00:00.000Z",
    });
    let workerSequence = 1;
    const event = async (payload: Record<string, unknown>) => await signedWorkerCallback(t, {
      schemaVersion: 1,
      kind: "event",
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      workerSequence: workerSequence++,
      occurredAt: `2026-08-27T05:${String(workerSequence).padStart(2, "0")}:00.000Z`,
      executionRevision: created.executionRevision,
      ...payload,
    });
    await expect(event({ eventId: "signed-connected", type: "connected" })).resolves.toEqual({ kind: "event", duplicate: false });
    for (const [index, question] of created.contract.questions.entries()) {
      await event({
        eventId: `worker-event-${index + 1}`,
        type: "answer_observed",
        questionId: question.id,
        evidenceExcerpt: `Evidence ${index + 1}`,
      });
    }
    await event({ eventId: "signed-ended", type: "call_ended" });
    await expect(signedWorkerCallback(t, {
      schemaVersion: 1,
      kind: "result",
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      resultKey: "signed-result",
      actualCostMinorUnits: 0,
      costStatus: "pending",
      result: answeredResult(created.contract, created.executionRevision),
    })).resolves.toEqual({ kind: "result", duplicate: false });
    await expect(signedWorkerCallback(t, {
      schemaVersion: 1,
      kind: "cost",
      taskId: created.taskId,
      attemptId: confirmed.attemptId,
      resultKey: "signed-result",
      settlementKey: "signed-result:cost",
      actualCostMinorUnits: 120,
    })).resolves.toEqual({ kind: "cost", duplicate: false });
    await expect(t.query(getResult, { taskId: created.taskId })).resolves.toMatchObject({
      status: "ready",
      result: {
        answers: expect.arrayContaining([
          expect.objectContaining({ questionId: "documents", status: "reported" }),
          expect.objectContaining({ questionId: "walk-in", status: "reported" }),
        ]),
      },
      receipt: {
        callLanguage: clinic.contract.languages.call,
        resultLanguage: clinic.contract.languages.result,
        cost: { currency: "USD", status: "provider_reported", actualMinorUnits: 120 },
      },
    });
  });
});
