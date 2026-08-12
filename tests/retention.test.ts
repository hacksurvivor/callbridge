import { describe, expect, it } from "vitest";
import { isRetentionExpired, retentionDeleteAt } from "../src/domain/retention.js";

describe("task retention", () => {
  it("keeps saved context until 30 days after the trip end", () => {
    expect(retentionDeleteAt({ mode: "save_for_30_days", endDate: "2026-08-10", completedAt: new Date("2026-08-10T12:00:00Z") }).toISOString()).toBe("2026-09-09T00:00:00.000Z");
  });
  it("purges no-save context immediately and supports a bounded extension", () => {
    const completedAt = new Date("2026-08-10T12:00:00Z");
    expect(isRetentionExpired({ mode: "no_save", completedAt, now: completedAt })).toBe(true);
    expect(retentionDeleteAt({ mode: "save_for_30_days", completedAt, extensionDays: 30 }).toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });
});
