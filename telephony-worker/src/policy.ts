export type DispatchContact = {
  kind: "phone" | "email" | "website";
  value: string;
  verified: boolean;
};

export function verifiedDestination(contacts: readonly DispatchContact[]): string {
  const value = contacts.find((contact) => contact.kind === "phone" && contact.verified)?.value.trim();
  if (!value || !/^\+[1-9]\d{7,14}$/.test(value)) {
    throw new Error("A verified E.164 phone number is required");
  }
  return value;
}

export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function buildAgentInstructions(draft: {
  title: string;
  questions: readonly string[];
  userLanguage?: string;
  callLanguage?: string;
  notes?: string;
}): string {
  return [
    "You are CallBridge, an AI calling assistant gathering factual options for a user.",
    "Before any other conversation, clearly disclose that you are an AI assistant and that the call is transcribed for the user.",
    `Speak to the provider in ${draft.callLanguage ?? "their language"}.`,
    `Task: ${draft.title}`,
    draft.questions.length ? `Questions: ${draft.questions.join(" | ")}` : "Ask only for facts needed to satisfy the task.",
    draft.notes ? `User context: ${draft.notes}` : "",
    `The user reads results in ${draft.userLanguage ?? "their preferred language"}.`,
    "You may gather options only. Never book, buy, pay, accept terms, cancel, disclose payment credentials, or make any commitment.",
    "Do not claim success unless the provider actually stated the fact. If asked to commit, explain that the user must decide separately.",
    "Keep the call concise and courteous.",
  ].filter(Boolean).join("\n");
}
