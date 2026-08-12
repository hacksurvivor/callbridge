export type QuestionKind =
  | "required_fact"
  | "preference"
  | "consequential_choice"
  | "sensitive_disclosure";

export type ReminderPolicy = {
  maxReminders: number;
  afterLimit: "pause" | "continue_option_gathering";
};

export const DEFAULT_REMINDER_POLICIES: Record<QuestionKind, ReminderPolicy> = {
  required_fact: { maxReminders: 2, afterLimit: "pause" },
  preference: { maxReminders: 0, afterLimit: "continue_option_gathering" },
  consequential_choice: { maxReminders: 2, afterLimit: "pause" },
  sensitive_disclosure: { maxReminders: 2, afterLimit: "pause" },
};

export function decideUnansweredQuestion(input: {
  kind: QuestionKind;
  remindersAlreadySent: number;
  whyItMatters: string;
  policy?: ReminderPolicy;
}):
  | { kind: "remind"; explanation: string }
  | { kind: "pause" }
  | { kind: "continue_option_gathering" } {
  const policy = input.policy ?? DEFAULT_REMINDER_POLICIES[input.kind];
  if (input.remindersAlreadySent < policy.maxReminders) {
    return { kind: "remind", explanation: input.whyItMatters };
  }
  return { kind: policy.afterLimit };
}

export function validateReminderPolicy(policy: ReminderPolicy): ReminderPolicy {
  if (!Number.isInteger(policy.maxReminders) || policy.maxReminders < 0 || policy.maxReminders > 10) {
    throw new Error("Reminder count must be an integer from 0 to 10");
  }
  return policy;
}
