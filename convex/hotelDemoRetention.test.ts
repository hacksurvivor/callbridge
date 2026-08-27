// @vitest-environment edge-runtime
/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { makeFunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import schema from "./schema.js";

const modules = import.meta.glob("./**/*.{ts,js}");
const createCallDraft = makeFunctionReference<"mutation">("hotelDemo:createCallDraft");
const runRetention = makeFunctionReference<"action">("hotelDemoRetention:run");
const getReadiness = makeFunctionReference<"query">("hotelDemoRetention:getReadiness");

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

beforeEach(() => {
  Object.assign(process.env, policyEnvironment);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-08-26T00:00:00.000Z"));
});

afterEach(() => {
  vi.useRealTimers();
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function createArgs(idempotencyKey: string) {
  return { schemaVersion: 1, idempotencyKey, questionIds: ["latest-check-in-time"] };
}

describe("hotel demo retention", () => {
  it("blocks new calls while data is overdue and hard-deletes it on recovery", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "retention_user_1" });
    const created = await t.mutation(createCallDraft, createArgs("retention-create-0001"));
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000 + 1);

    await expect(t.mutation(createCallDraft, createArgs("retention-create-0002"))).rejects.toMatchObject({
      data: { code: "DEMO_POLICY_DENIED" },
    });
    expect(await t.action(runRetention, { injectFailure: false })).toEqual({ deleted: 1, overdueCount: 0, healthy: true });
    const remaining = await t.run(async (ctx) => ctx.db.get("hotelDemoTasks", created.taskId));
    expect(remaining).toBeNull();
    await expect(t.mutation(createCallDraft, createArgs("retention-create-0003"))).resolves.toMatchObject({ revision: 1, status: "draft" });
  });

  it("records cleanup failure durably and clears readiness only after a successful retry", async () => {
    const t = convexTest(schema, modules).withIdentity({ subject: "retention_user_2" });
    await t.mutation(createCallDraft, createArgs("retention-failure-0001"));
    vi.advanceTimersByTime(24 * 60 * 60 * 1_000 + 1);

    expect(await t.action(runRetention, { injectFailure: true })).toEqual({ deleted: 0, overdueCount: 1, healthy: false });
    expect(await t.query(getReadiness, {})).toMatchObject({ healthy: false, overdueCount: 1 });
    await expect(t.mutation(createCallDraft, createArgs("retention-failure-0002"))).rejects.toMatchObject({
      data: { code: "DEMO_POLICY_DENIED" },
    });

    expect(await t.action(runRetention, { injectFailure: false })).toEqual({ deleted: 1, overdueCount: 0, healthy: true });
    expect(await t.query(getReadiness, {})).toMatchObject({ healthy: true, overdueCount: 0 });
  });
});
