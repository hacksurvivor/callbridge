// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { describe, expect, it } from "vitest";

import type { InquiryCallContract } from "../shared/inquiryContracts.js";
import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../shared/inquiryFixtures.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.{ts,js}");
const createDraft = makeFunctionReference<"mutation">("inquiries:createDraft");
const createConfirmationIntent = makeFunctionReference<"mutation">("inquiries:createConfirmationIntent");
const beginPricingQuote = makeFunctionReference<"mutation">("inquiryPricing:beginPricingQuote");
const storePricingQuote = makeFunctionReference<"mutation">("inquiryPricing:storePricingQuote");
const confirmAndQueue = makeFunctionReference<"mutation">("inquiries:confirmAndQueue");
const grantCredits = makeFunctionReference<"mutation">("inquiries:grantCredits");
const getCreditBalance = makeFunctionReference<"query">("inquiries:getCreditBalance");
const listEvents = makeFunctionReference<"query">("inquiries:listEvents");
const recordWorkerEvent = makeFunctionReference<"mutation">("inquiries:recordWorkerEvent");
const claimDispatch = makeFunctionReference<"mutation">("inquiryDispatch:claimDispatch");
const recordDispatchAccepted = makeFunctionReference<"mutation">("inquiryDispatch:recordDispatchAccepted");
const recordDispatchDefinitelyNotCreated = makeFunctionReference<"mutation">("inquiryDispatch:recordDispatchDefinitelyNotCreated");
const recordDispatchCreationUncertain = makeFunctionReference<"mutation">("inquiryDispatch:recordDispatchCreationUncertain");
const reconcileDispatchOutcome = makeFunctionReference<"mutation">("inquiryDispatch:reconcileDispatchOutcome");
const expireDispatchLease = makeFunctionReference<"mutation">("inquiryDispatch:expireDispatchLease");

function authenticated() {
  return convexTest(schema, modules).withIdentity({ subject: "dispatch_user_1" });
}

function inquiryContract(): InquiryCallContract {
  const { playbook: _playbook, ...contract } = structuredClone(HOTEL_INQUIRY_GOLDEN_FIXTURE);
  return contract;
}

async function confirmedAttempt(
  t: ReturnType<typeof authenticated>,
  suffix: string,
) {
  await t.mutation(grantCredits, {
    ownerId: "dispatch_user_1",
    currency: "USD",
    amountMinorUnits: 1_000,
    idempotencyKey: `credits-${suffix}`,
  });
  const created = await t.mutation(createDraft, {
    idempotencyKey: `create-${suffix}`,
    contract: inquiryContract(),
  });
  const quotedAt = new Date().toISOString();
  const pricingRequest = await t.mutation(beginPricingQuote, {
    taskId: created.taskId,
    ownerId: "dispatch_user_1",
    expectedRevision: created.revision,
    expectedExecutionRevision: created.executionRevision,
  });
  await t.mutation(storePricingQuote, {
    taskId: created.taskId,
    ownerId: "dispatch_user_1",
    requestId: pricingRequest.requestId,
    quote: {
      quoteId: crypto.randomUUID(),
      revision: created.revision,
      executionRevision: created.executionRevision,
      provider: "twilio",
      destination: { isoCountry: "JP", country: "Japan", maskedPhone: "+817…4142" },
      policy: { allowed: true, riskTier: "low_risk_only", provisioning: "just_in_time" },
      pstn: {
        rateDescription: "Programmable outbound minute",
        currentPricePerMinute: "0.0746",
        currency: "USD",
        maximumConnectedSeconds: 180,
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
  const intent = await t.mutation(createConfirmationIntent, {
    taskId: created.taskId,
    expectedRevision: created.revision,
    expectedExecutionRevision: created.executionRevision,
    idempotencyKey: `intent-${suffix}`,
  });
  const confirmed = await t.mutation(confirmAndQueue, {
    taskId: created.taskId,
    expectedRevision: created.revision,
    expectedExecutionRevision: created.executionRevision,
    confirmationIntentId: intent.intentId,
    idempotencyKey: `confirm-${suffix}`,
  });
  return { ...created, ...confirmed };
}

async function claim(
  t: ReturnType<typeof authenticated>,
  created: { taskId: string; attemptId: string; executionRevision: string },
  key: string,
) {
  return await t.mutation(claimDispatch, {
    taskId: created.taskId,
    attemptId: created.attemptId,
    expectedExecutionRevision: created.executionRevision,
    claimIdempotencyKey: key,
  });
}

describe("general inquiry dispatch orchestration", () => {
  it("issues one stable lease and never hands the attempt to a second claimant", async () => {
    const t = authenticated();
    const created = await confirmedAttempt(t, "claim-once-0001");
    await expect(t.mutation(claimDispatch, {
      taskId: created.taskId,
      attemptId: created.attemptId,
      expectedExecutionRevision: "sha256:stale-execution-revision",
      claimIdempotencyKey: "claim-stale-revision",
    })).rejects.toMatchObject({ data: { code: "EXECUTION_REVISION_MISMATCH" } });
    const contenders = await Promise.allSettled([
      claim(t, created, "claim-once-worker-a"),
      claim(t, created, "claim-once-worker-b"),
    ]);
    const winner = contenders.find((result) => result.status === "fulfilled");
    const loser = contenders.find((result) => result.status === "rejected");
    expect(winner?.status).toBe("fulfilled");
    expect(loser?.status).toBe("rejected");
    if (winner?.status !== "fulfilled" || loser?.status !== "rejected") throw new Error("Expected exactly one dispatch claimant");
    expect(loser.reason).toMatchObject({
      data: { code: "DISPATCH_ALREADY_CLAIMED", dispatchState: "leased" },
    });
    const first = winner.value;
    const winningKey = contenders[0]?.status === "fulfilled" ? "claim-once-worker-a" : "claim-once-worker-b";
    const repeated = await claim(t, created, winningKey);
    expect(repeated).toEqual(first);

    const stored = await t.run(async (ctx) => ctx.db.query("inquiryAttempts").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      attemptNumber: 1,
      status: "queued",
      dispatchState: "leased",
      dispatchClaimKey: winningKey,
      dispatchIdempotencyKey: first.dispatchIdempotencyKey,
    });
  });

  it("marks dialing only after the provider returns one concrete call id", async () => {
    const t = authenticated();
    const created = await confirmedAttempt(t, "accepted-0001");
    const lease = await claim(t, created, "claim-accepted-worker");
    const acceptedArgs = {
      taskId: created.taskId,
      attemptId: created.attemptId,
      leaseToken: lease.leaseToken,
      externalCallId: "provider-call-accepted-0001",
      occurredAt: "2026-08-26T14:00:00.000Z",
    };
    await expect(t.mutation(recordDispatchAccepted, {
      ...acceptedArgs,
      leaseToken: "wrong-lease-token",
    })).rejects.toMatchObject({ data: { code: "DISPATCH_LEASE_MISMATCH" } });
    await expect(t.mutation(recordDispatchAccepted, acceptedArgs)).resolves.toEqual({
      state: "accepted",
      duplicate: false,
    });
    await expect(t.mutation(recordDispatchAccepted, acceptedArgs)).resolves.toEqual({
      state: "accepted",
      duplicate: true,
    });
    await expect(t.mutation(recordDispatchAccepted, {
      ...acceptedArgs,
      externalCallId: "provider-call-conflict-0002",
    })).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_CONFLICT" } });

    await expect(t.mutation(recordWorkerEvent, {
      taskId: created.taskId,
      attemptId: created.attemptId,
      eventId: "worker-connected-accepted-0001",
      workerSequence: 1,
      type: "connected",
      occurredAt: "2026-08-26T14:00:02.000Z",
      executionRevision: created.executionRevision,
    })).resolves.toMatchObject({ duplicate: false });

    const state = await t.run(async (ctx) => ({
      task: await ctx.db.get("inquiryTasks", created.taskId as never),
      attempt: await ctx.db.get("inquiryAttempts", created.attemptId as never),
    }));
    expect(state.task).toMatchObject({ status: "in_progress" });
    expect(state.attempt).toMatchObject({
      status: "connected",
      dispatchState: "accepted",
      externalCallId: acceptedArgs.externalCallId,
      nextWorkerSequence: 2,
    });
    const events = await t.query(listEvents, { taskId: created.taskId });
    expect(events.slice(-2).map(({ type }: { type: string }) => type)).toEqual(["dialing", "connected"]);
  });

  it("releases the reservation only when the provider definitely created no call", async () => {
    const t = authenticated();
    const created = await confirmedAttempt(t, "definite-failure-0001");
    const lease = await claim(t, created, "claim-definite-failure");
    const failureArgs = {
      taskId: created.taskId,
      attemptId: created.attemptId,
      leaseToken: lease.leaseToken,
      failureCode: "DESTINATION_REJECTED_BEFORE_CREATE",
      occurredAt: "2026-08-26T14:10:00.000Z",
    };
    await expect(t.mutation(recordDispatchDefinitelyNotCreated, failureArgs)).resolves.toEqual({
      state: "definitely_not_created",
      duplicate: false,
    });
    await expect(t.mutation(recordDispatchDefinitelyNotCreated, failureArgs)).resolves.toEqual({
      state: "definitely_not_created",
      duplicate: true,
    });
    await expect(claim(t, created, "claim-after-definite-failure")).rejects.toMatchObject({
      data: { code: "DISPATCH_ALREADY_CLAIMED", dispatchState: "definitely_not_created" },
    });

    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toEqual({
      currency: "USD",
      balanceMinorUnits: 1_000,
      reservedMinorUnits: 0,
      availableMinorUnits: 1_000,
    });
    const stored = await t.run(async (ctx) => ({
      attempts: await ctx.db.query("inquiryAttempts").collect(),
      reservations: await ctx.db.query("inquiryCreditReservations").collect(),
      releases: (await ctx.db.query("inquiryCreditLedger").collect()).filter(({ kind }) => kind === "release"),
    }));
    expect(stored.attempts).toHaveLength(1);
    expect(stored.attempts[0]).toMatchObject({
      status: "failed",
      dispatchState: "definitely_not_created",
      terminalReason: "provider_rejected_before_creation",
    });
    expect(stored.reservations[0]).toMatchObject({ state: "released", actualMinorUnits: 0 });
    expect(stored.releases).toHaveLength(1);
  });

  it("atomically refuses the lease when the recipient opted out after confirmation", async () => {
    const t = authenticated();
    const created = await confirmedAttempt(t, "optout-before-claim-0001");
    await t.run(async (ctx) => {
      await ctx.db.insert("inquiryRecipientOptOuts", {
        destinationE164: inquiryContract().destination.e164PhoneNumber,
        taskId: created.taskId as never,
        attemptId: created.attemptId as never,
        source: "operator",
        reason: "Recipient requested no further automated calls.",
        optedOutAt: "2026-08-26T14:05:00.000Z",
      });
    });

    await expect(claim(t, created, "claim-after-recipient-optout")).resolves.toEqual({ allowed: false });
    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toMatchObject({
      reservedMinorUnits: 0,
      availableMinorUnits: 1_000,
    });
    const stored = await t.run(async (ctx) => ({
      attempt: await ctx.db.get("inquiryAttempts", created.attemptId as never),
      task: await ctx.db.get("inquiryTasks", created.taskId as never),
      releases: (await ctx.db.query("inquiryCreditLedger").collect()).filter(({ kind }) => kind === "release"),
    }));
    expect(stored.attempt).toMatchObject({
      status: "failed",
      dispatchState: "definitely_not_created",
      dispatchFailureCode: "RECIPIENT_OPTED_OUT",
      terminalReason: "recipient_opted_out",
    });
    expect(stored.task).toMatchObject({ status: "failed", resultState: "failed" });
    expect(stored.releases).toHaveLength(1);
  });

  it("fails closed on an uncertain provider response and requires explicit reconciliation", async () => {
    const t = authenticated();
    const created = await confirmedAttempt(t, "uncertain-found-0001");
    const lease = await claim(t, created, "claim-uncertain-found");
    const uncertainArgs = {
      taskId: created.taskId,
      attemptId: created.attemptId,
      leaseToken: lease.leaseToken,
      failureCode: "PROVIDER_RESPONSE_TIMEOUT",
      occurredAt: "2026-08-26T14:20:00.000Z",
    };
    await expect(t.mutation(recordDispatchCreationUncertain, uncertainArgs)).resolves.toEqual({
      state: "creation_uncertain",
      duplicate: false,
    });
    await expect(t.mutation(recordDispatchCreationUncertain, uncertainArgs)).resolves.toEqual({
      state: "creation_uncertain",
      duplicate: true,
    });
    await expect(t.mutation(recordDispatchCreationUncertain, {
      ...uncertainArgs,
      failureCode: "DIFFERENT_TIMEOUT_CLASSIFICATION",
    })).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_CONFLICT" } });
    await expect(claim(t, created, "claim-after-timeout")).rejects.toMatchObject({
      data: { code: "DISPATCH_ALREADY_CLAIMED", dispatchState: "creation_uncertain" },
    });
    await expect(t.mutation(recordDispatchAccepted, {
      taskId: created.taskId,
      attemptId: created.attemptId,
      leaseToken: lease.leaseToken,
      externalCallId: "provider-call-late-direct-0001",
      occurredAt: "2026-08-26T14:20:01.000Z",
    })).rejects.toMatchObject({ data: { code: "INVALID_TRANSITION" } });
    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toMatchObject({
      reservedMinorUnits: 500,
    });

    const resolution = {
      taskId: created.taskId,
      attemptId: created.attemptId,
      resolutionKey: "reconcile-found-0001",
      outcome: "found" as const,
      externalCallId: "provider-call-reconciled-0001",
      occurredAt: "2026-08-26T14:21:00.000Z",
    };
    await expect(t.mutation(reconcileDispatchOutcome, resolution)).resolves.toEqual({
      state: "accepted",
      duplicate: false,
    });
    await expect(t.mutation(reconcileDispatchOutcome, resolution)).resolves.toEqual({
      state: "accepted",
      duplicate: true,
    });
    await expect(t.mutation(reconcileDispatchOutcome, {
      ...resolution,
      resolutionKey: "different-reconciliation-key",
    })).rejects.toMatchObject({ data: { code: "IDEMPOTENCY_CONFLICT" } });
    const stored = await t.run(async (ctx) => ctx.db.query("inquiryAttempts").collect());
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      attemptNumber: 1,
      dispatchState: "accepted",
      status: "dialing",
      externalCallId: resolution.externalCallId,
    });
  });

  it("reconciles provider absence without requeueing or reserving money twice", async () => {
    const t = authenticated();
    const created = await confirmedAttempt(t, "uncertain-absent-0001");
    const lease = await claim(t, created, "claim-uncertain-absent");
    await t.mutation(recordDispatchCreationUncertain, {
      taskId: created.taskId,
      attemptId: created.attemptId,
      leaseToken: lease.leaseToken,
      failureCode: "CONNECTION_RESET_AFTER_SEND",
      occurredAt: "2026-08-26T14:30:00.000Z",
    });
    const resolution = {
      taskId: created.taskId,
      attemptId: created.attemptId,
      resolutionKey: "reconcile-absent-0001",
      outcome: "definitely_absent" as const,
      occurredAt: "2026-08-26T14:31:00.000Z",
    };
    await expect(t.mutation(reconcileDispatchOutcome, resolution)).resolves.toEqual({
      state: "definitely_not_created",
      duplicate: false,
    });
    await expect(t.mutation(reconcileDispatchOutcome, resolution)).resolves.toEqual({
      state: "definitely_not_created",
      duplicate: true,
    });
    await expect(t.query(getCreditBalance, { currency: "USD" })).resolves.toMatchObject({
      balanceMinorUnits: 1_000,
      reservedMinorUnits: 0,
    });
    const stored = await t.run(async (ctx) => ({
      attempts: await ctx.db.query("inquiryAttempts").collect(),
      releases: (await ctx.db.query("inquiryCreditLedger").collect()).filter(({ kind }) => kind === "release"),
    }));
    expect(stored.attempts).toHaveLength(1);
    expect(stored.attempts[0]).toMatchObject({ dispatchState: "definitely_not_created", status: "failed" });
    expect(stored.releases).toHaveLength(1);
  });

  it("turns an expired unresolved lease into uncertainty instead of retryable work", async () => {
    const t = authenticated();
    const created = await confirmedAttempt(t, "lease-expiry-0001");
    const lease = await claim(t, created, "claim-lease-expiry");
    await t.run(async (ctx) => {
      await ctx.db.patch("inquiryAttempts", created.attemptId as never, {
        dispatchLeaseExpiresAt: "2026-01-01T00:00:00.000Z",
      });
    });
    await t.mutation(expireDispatchLease, {
      attemptId: created.attemptId,
      leaseToken: lease.leaseToken,
    });
    const stored = await t.run(async (ctx) => ctx.db.get("inquiryAttempts", created.attemptId as never));
    expect(stored).toMatchObject({
      dispatchState: "creation_uncertain",
      status: "failed",
      dispatchFailureCode: "LEASE_EXPIRED_WITHOUT_REPORTED_OUTCOME",
    });
    await expect(claim(t, created, "claim-after-expired-lease")).rejects.toMatchObject({
      data: { code: "DISPATCH_ALREADY_CLAIMED", dispatchState: "creation_uncertain" },
    });
  });

  it("never binds one provider call id to two inquiry attempts", async () => {
    const t = authenticated();
    const first = await confirmedAttempt(t, "external-id-first-0001");
    const firstLease = await claim(t, first, "claim-external-id-first");
    await t.mutation(recordDispatchAccepted, {
      taskId: first.taskId,
      attemptId: first.attemptId,
      leaseToken: firstLease.leaseToken,
      externalCallId: "provider-call-shared-0001",
      occurredAt: "2026-08-26T14:40:00.000Z",
    });
    await t.run(async (ctx) => ctx.db.patch("inquiryAttempts", first.attemptId, { status: "ended" }));

    const second = await confirmedAttempt(t, "external-id-second-0001");
    const secondLease = await claim(t, second, "claim-external-id-second");
    await expect(t.mutation(recordDispatchAccepted, {
      taskId: second.taskId,
      attemptId: second.attemptId,
      leaseToken: secondLease.leaseToken,
      externalCallId: "provider-call-shared-0001",
      occurredAt: "2026-08-26T14:41:00.000Z",
    })).rejects.toMatchObject({ data: { code: "EXTERNAL_CALL_ID_CONFLICT" } });

    const attempts = await t.run(async (ctx) => ctx.db.query("inquiryAttempts").collect());
    expect(attempts).toHaveLength(2);
    expect(attempts.filter(({ dispatchState }) => dispatchState === "accepted")).toHaveLength(1);
    expect(attempts.filter(({ dispatchState }) => dispatchState === "leased")).toHaveLength(1);
  });
});
