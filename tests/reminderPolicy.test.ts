import { describe, expect, it } from "vitest";

import {
  decideUnansweredQuestion,
  validateReminderPolicy,
} from "../src/domain/reminderPolicy.js";

describe("question-specific reminder policy", () => {
  it("reminds twice then pauses for an essential date", () => {
    const input = { kind: "required_fact" as const, whyItMatters: "Without a date I cannot contact the hotel" };
    expect(decideUnansweredQuestion({ ...input, remindersAlreadySent: 0 })).toEqual({
      kind: "remind",
      explanation: input.whyItMatters,
    });
    expect(decideUnansweredQuestion({ ...input, remindersAlreadySent: 2 })).toEqual({ kind: "pause" });
  });

  it("does not block reversible option gathering for a preference", () => {
    expect(
      decideUnansweredQuestion({
        kind: "preference",
        remindersAlreadySent: 0,
        whyItMatters: "Sea view changes the price",
      }),
    ).toEqual({ kind: "continue_option_gathering" });
  });

  it("allows an explicit custom policy without permitting unbounded reminders", () => {
    expect(validateReminderPolicy({ maxReminders: 3, afterLimit: "pause" })).toEqual({
      maxReminders: 3,
      afterLimit: "pause",
    });
    expect(() => validateReminderPolicy({ maxReminders: 11, afterLimit: "pause" })).toThrow(
      "0 to 10",
    );
  });
});
