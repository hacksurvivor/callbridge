import { describe, expect, it, vi } from "vitest";

import {
  runMorningBriefDelivery,
  type MorningBriefDeliveryStore,
  type StoredMorningBriefPreparation,
} from "../src/application/morningBriefDeliveryService.js";
import {
  prepareMorningBriefDelivery,
  type MorningBriefPreparationInput,
} from "../src/domain/morningBriefDelivery.js";
import { NoopMorningBriefDeliveryAdapter } from "../src/integrations/noopMorningBriefDelivery.js";

const enabledPreferences = {
  timeZone: "Asia/Bangkok",
  quietHours: { startsAt: "22:00", endsAt: "08:00" },
  morningBrief: { enabled: true, deliverAt: "08:00" },
};

function candidate(
  overrides: Partial<MorningBriefPreparationInput> = {},
): MorningBriefPreparationInput {
  return {
    ownerId: "user_123",
    now: new Date("2026-08-11T01:00:00.000Z"),
    since: new Date("2026-08-10T20:00:00.000Z"),
    preferences: enabledPreferences,
    activity: [
      {
        taskId: "task_123",
        taskTitle: "Hotel",
        kind: "contact_answered",
        summary: "The hotel confirmed the 13:00 check-in.",
        actionLabel: "Private internal label",
        source: "agent",
        occurredAt: "2026-08-11T00:30:00.000Z",
      },
    ],
    commitments: [],
    ...overrides,
  };
}

class InMemoryMorningBriefStore implements MorningBriefDeliveryStore {
  private readonly deliveries = new Map<
    string,
    Extract<StoredMorningBriefPreparation, { kind: "prepared" }> & { completed: boolean }
  >();

  async prepareOnce(input: MorningBriefPreparationInput): Promise<StoredMorningBriefPreparation> {
    const decision = prepareMorningBriefDelivery(input);
    if (decision.kind === "skipped") return decision;
    const existing = this.deliveries.get(decision.deliveryKey);
    if (existing) return { kind: "duplicate", deliveryId: existing.deliveryId };
    const prepared = {
      kind: "prepared" as const,
      deliveryId: `delivery_${this.deliveries.size + 1}`,
      deliveryKey: decision.deliveryKey,
      ownerId: decision.ownerId,
      payload: decision.payload,
      completed: false,
    };
    this.deliveries.set(decision.deliveryKey, prepared);
    return prepared;
  }

  async recordNoopReceipt(input: {
    deliveryId: string;
    deliveryKey: string;
    ownerId: string;
  }): Promise<"recorded" | "duplicate"> {
    const delivery = this.deliveries.get(input.deliveryKey);
    if (
      !delivery ||
      delivery.deliveryId !== input.deliveryId ||
      delivery.ownerId !== input.ownerId
    ) {
      throw new Error("tenant or delivery mismatch");
    }
    if (delivery.completed) return "duplicate";
    delivery.completed = true;
    return "recorded";
  }
}

describe("morning brief delivery", () => {
  it("claims one tenant-local calendar day before invoking the no-op adapter", async () => {
    const store = new InMemoryMorningBriefStore();
    const adapter = new NoopMorningBriefDeliveryAdapter(
      () => new Date("2026-08-11T01:00:01.000Z"),
    );
    const deliver = vi.spyOn(adapter, "deliver");

    await expect(
      runMorningBriefDelivery({ store, adapter, candidate: candidate() }),
    ).resolves.toMatchObject({
      kind: "completed_noop",
      receipt: { adapter: "noop", externalMessageId: null },
    });
    await expect(
      runMorningBriefDelivery({ store, adapter, candidate: candidate() }),
    ).resolves.toEqual({ kind: "duplicate", deliveryId: "delivery_1" });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("fails closed for absent, disabled, and invalid preferences", () => {
    expect(prepareMorningBriefDelivery(candidate({ preferences: null }))).toEqual({
      kind: "skipped",
      reason: "missing_preferences",
    });
    expect(
      prepareMorningBriefDelivery(
        candidate({
          preferences: {
            ...enabledPreferences,
            morningBrief: { enabled: false, deliverAt: "08:00" },
          },
        }),
      ),
    ).toEqual({ kind: "skipped", reason: "disabled" });
    expect(
      prepareMorningBriefDelivery(
        candidate({ preferences: { ...enabledPreferences, timeZone: "Not/A_Time_Zone" } }),
      ),
    ).toEqual({ kind: "skipped", reason: "invalid_preferences" });
  });

  it("fails closed when a persisted delivery minute falls in quiet hours", () => {
    expect(
      prepareMorningBriefDelivery(
        candidate({
          now: new Date("2026-08-11T00:30:00.000Z"),
          preferences: {
            ...enabledPreferences,
            morningBrief: { enabled: true, deliverAt: "07:30" },
          },
        }),
      ),
    ).toEqual({ kind: "skipped", reason: "quiet_hours" });
  });

  it("does not prepare before or after the configured delivery minute", () => {
    expect(
      prepareMorningBriefDelivery(
        candidate({ now: new Date("2026-08-11T01:01:00.000Z") }),
      ),
    ).toEqual({ kind: "skipped", reason: "not_delivery_time" });
  });

  it("uses a distinct idempotency key for each tenant", () => {
    const first = prepareMorningBriefDelivery(candidate({ ownerId: "user_123" }));
    const second = prepareMorningBriefDelivery(candidate({ ownerId: "user_456" }));
    expect(first).toMatchObject({ deliveryKey: "user_123:2026-08-11" });
    expect(second).toMatchObject({ deliveryKey: "user_456:2026-08-11" });
  });

  it("keys and filters the brief at the configured time-zone date boundary", () => {
    const decision = prepareMorningBriefDelivery(
      candidate({
        now: new Date("2026-08-11T17:00:00.000Z"), // 00:00 on Aug 12 in Bangkok
        since: new Date("2026-08-11T15:00:00.000Z"),
        preferences: {
          timeZone: "Asia/Bangkok",
          quietHours: { startsAt: "01:00", endsAt: "02:00" },
          morningBrief: { enabled: true, deliverAt: "00:00" },
        },
        activity: [],
        commitments: [
          {
            taskId: "task_today",
            taskTitle: "Airport transfer",
            important: true,
            occursAt: "2026-08-11T17:30:00.000Z",
            summary: "Pickup is at 00:30.",
          },
          {
            taskId: "task_yesterday",
            taskTitle: "Late dinner",
            important: true,
            occursAt: "2026-08-11T16:30:00.000Z",
            summary: "Dinner was at 23:30.",
          },
        ],
      }),
    );

    expect(decision).toMatchObject({
      kind: "ready",
      localDate: "2026-08-12",
      deliveryKey: "user_123:2026-08-12",
      payload: {
        localDate: "2026-08-12",
        items: [{ kind: "today", taskId: "task_today" }],
      },
    });
  });

  it("does not prepare an empty brief", () => {
    expect(
      prepareMorningBriefDelivery(candidate({ activity: [], commitments: [] })),
    ).toEqual({ kind: "skipped", reason: "empty_brief" });
  });

  it("keeps adapter payloads to factual summaries and important commitments", () => {
    const decision = prepareMorningBriefDelivery(
      candidate({
        commitments: [
          {
            taskId: "task_important",
            taskTitle: "Transfer",
            important: true,
            occursAt: "2026-08-11T05:00:00.000Z",
            summary: "Pickup is at 12:00.",
          },
          {
            taskId: "task_routine",
            taskTitle: "Routine",
            important: false,
            occursAt: "2026-08-11T06:00:00.000Z",
            summary: "This is not important.",
          },
        ],
      }),
    );
    if (decision.kind !== "ready") throw new Error("Expected a ready delivery");
    expect(decision.payload.items).toEqual([
      {
        kind: "update",
        taskId: "task_123",
        taskTitle: "Hotel",
        summary: "The hotel confirmed the 13:00 check-in.",
        occurredAt: "2026-08-11T00:30:00.000Z",
      },
      {
        kind: "today",
        taskId: "task_important",
        taskTitle: "Transfer",
        summary: "Pickup is at 12:00.",
        occursAt: "2026-08-11T05:00:00.000Z",
      },
    ]);
  });
});
