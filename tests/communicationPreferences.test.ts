import { describe, expect, it } from "vitest";

import {
  DEFAULT_COMMUNICATION_PREFERENCES,
  validateCommunicationPreferences,
} from "../src/domain/communicationPreferences.js";

describe("communication preferences", () => {
  it("uses calm default notification hours", () => {
    expect(DEFAULT_COMMUNICATION_PREFERENCES).toEqual({
      timeZone: "UTC",
      quietHours: { startsAt: "22:00", endsAt: "08:00" },
      morningBrief: { enabled: true, deliverAt: "08:00" },
    });
  });

  it("rejects a morning brief placed inside quiet hours", () => {
    expect(() =>
      validateCommunicationPreferences({
        timeZone: "Asia/Bangkok",
        quietHours: { startsAt: "22:00", endsAt: "08:00" },
        morningBrief: { enabled: true, deliverAt: "07:30" },
      }),
    ).toThrow(/Communication preferences are invalid/);
  });

  it("accepts an onboarding preference in the user's time zone", () => {
    expect(
      validateCommunicationPreferences({
        timeZone: "Asia/Bangkok",
        quietHours: { startsAt: "23:00", endsAt: "07:00" },
        morningBrief: { enabled: true, deliverAt: "08:30" },
      }),
    ).toMatchObject({ timeZone: "Asia/Bangkok" });
  });
});
