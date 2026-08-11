import { describe, expect, it } from "vitest";

import {
  decideNotificationDelivery,
  DEFAULT_QUIET_HOURS,
} from "../src/domain/notifications.js";

describe("notification quiet hours", () => {
  const quietHours = { ...DEFAULT_QUIET_HOURS, timeZone: "Asia/Bangkok" };

  it("queues a routine notification until the next local 08:00", () => {
    expect(
      decideNotificationDelivery({
        now: new Date("2026-08-11T17:30:00.000Z"), // 00:30 Bangkok
        quietHours,
      }),
    ).toEqual({
      kind: "queue_until",
      deliverAt: "2026-08-12T08:00:00[Asia/Bangkok]",
    });
  });

  it("allows an active call awaiting a decision to interrupt quiet hours", () => {
    expect(
      decideNotificationDelivery({
        now: new Date("2026-08-11T17:30:00.000Z"),
        quietHours,
        overrideReason: "active_call_waiting_for_user",
      }),
    ).toEqual({ kind: "send_now", reason: "active_call_waiting_for_user" });
  });

  it("sends routine notifications immediately outside quiet hours", () => {
    expect(
      decideNotificationDelivery({
        now: new Date("2026-08-11T04:30:00.000Z"), // 11:30 Bangkok
        quietHours,
      }),
    ).toEqual({ kind: "send_now", reason: "outside_quiet_hours" });
  });
});
