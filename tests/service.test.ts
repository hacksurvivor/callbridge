import { describe, expect, it, vi } from "vitest";

import { CallTaskService } from "../src/application/callTaskService.js";
import { InMemoryCallTaskRepository } from "../src/application/repository.js";
import type {
  EntitlementProvider,
  IdentityProvider,
  OptionGatheringGateway,
} from "../src/integrations/ports.js";
import { actor, completeDraft } from "./fixtures.js";

function harness(active = true) {
  const identity: IdentityProvider = {
    authenticate: vi.fn(async (credential) => (credential === "valid" ? actor : null)),
  };
  const entitlements: EntitlementProvider = {
    getCallEntitlement: vi.fn(async () => ({ active, plan: active ? "starter" : null, validUntil: null })),
  };
  const calls: OptionGatheringGateway = {
    start: vi.fn(async () => ({ externalSessionId: "future_session_123" })),
  };
  const service = new CallTaskService({
    identity,
    entitlements,
    calls,
    tasks: new InMemoryCallTaskRepository(),
    clock: { now: () => new Date("2026-08-11T12:00:00.000Z") },
    ids: { generate: () => "task_123" },
  });
  return { service, calls };
}

describe("CallTaskService", () => {
  it("fails closed when AuthKit identity is unavailable", async () => {
    const { service } = harness();
    await expect(service.create("invalid", completeDraft())).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
  });

  it("does not invoke the call gateway before explicit confirmation", async () => {
    const { service, calls } = harness();
    const task = await service.create("valid", completeDraft());
    await expect(service.startOptionGathering("valid", task.id)).rejects.toMatchObject({
      code: "INVALID_TRANSITION",
    });
    expect(calls.start).not.toHaveBeenCalled();
  });

  it("does not invoke the call gateway without an active entitlement", async () => {
    const { service, calls } = harness(false);
    const task = await service.create("valid", completeDraft());
    await service.confirm("valid", task.id, task.revision);
    await expect(service.startOptionGathering("valid", task.id)).rejects.toMatchObject({
      code: "ENTITLEMENT_REQUIRED",
    });
    expect(calls.start).not.toHaveBeenCalled();
  });

  it("passes only the confirmed gather-options capability to the future gateway", async () => {
    const { service, calls } = harness();
    const task = await service.create("valid", completeDraft());
    await service.confirm("valid", task.id, task.revision);
    const started = await service.startOptionGathering("valid", task.id);
    expect(started.status).toBe("gathering_options");
    expect(started.execution?.externalSessionId).toBe("future_session_123");
    expect(calls.start).toHaveBeenCalledWith(
      expect.objectContaining({
        runtime: {
          provider: "openai_realtime",
          model: "gpt-realtime-2.1-mini",
        },
        capability: "gather_options_only",
        forbiddenActions: [
          "book",
          "pay",
          "accept_terms",
          "irreversible_commitment",
          "cancel",
        ],
        confirmation: expect.objectContaining({ confirmedRevision: 2 }),
      }),
    );
  });

  it("prepares and confirms cancellation without invoking an external gateway", async () => {
    const { service, calls } = harness();
    const task = await service.create("valid", completeDraft());
    const confirmed = await service.confirm("valid", task.id, task.revision);
    const prepared = await service.prepareCancellation(
      "valid",
      task.id,
      {
        knowledge: "known_fee",
        fee: { minorUnits: 2_500, currency: "USD" },
        checkedAt: "2026-08-11T11:50:00.000Z",
        source: "Confirmed by the venue",
      },
      confirmed.revision,
    );
    const approved = await service.confirmCancellation(
      "valid",
      task.id,
      prepared.revision,
    );
    expect(approved.cancellation?.state).toBe("confirmed");
    expect(approved.status).not.toBe("cancelled");
    expect(calls.start).not.toHaveBeenCalled();
  });
});
