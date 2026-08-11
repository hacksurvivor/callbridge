import { describe, expect, it } from "vitest";

import { buildMorningBrief } from "../src/domain/morningBrief.js";

describe("morning brief", () => {
  const now = new Date("2026-08-11T01:00:00.000Z"); // 08:00 Bangkok

  it("does not generate an empty notification", () => {
    expect(
      buildMorningBrief({
        now,
        since: new Date("2026-08-10T23:00:00.000Z"),
        timeZone: "Asia/Bangkok",
        activity: [],
        commitments: [],
      }),
    ).toBeNull();
  });

  it("includes only fresh updates and today's important commitments", () => {
    expect(
      buildMorningBrief({
        now,
        since: new Date("2026-08-10T23:00:00.000Z"),
        timeZone: "Asia/Bangkok",
        activity: [
          {
            taskId: "task_1",
            taskTitle: "Hotel",
            kind: "contact_answered",
            summary: "The hotel confirmed the 13:00 check-in.",
            source: "agent",
            occurredAt: "2026-08-11T00:30:00.000Z",
          },
        ],
        commitments: [
          {
            taskId: "task_2",
            taskTitle: "Airport transfer",
            important: true,
            occursAt: "2026-08-11T05:00:00.000Z",
            summary: "Pickup is at 12:00.",
          },
          {
            taskId: "task_3",
            taskTitle: "Later booking",
            important: false,
            occursAt: "2026-08-11T05:00:00.000Z",
            summary: "Should not appear.",
          },
        ],
      }),
    ).toMatchObject({
      items: [
        { kind: "update", taskId: "task_1" },
        { kind: "today", taskId: "task_2" },
      ],
    });
  });
});
