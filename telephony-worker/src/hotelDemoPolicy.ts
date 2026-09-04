import {
  HOTEL_DEMO_DISCLOSURE_ID,
  HOTEL_DEMO_FORBIDDEN_ACTIONS,
  HOTEL_DEMO_POLICY_VERSION,
  HOTEL_DEMO_QUESTION_IDS,
  HOTEL_DEMO_SCHEMA_VERSION,
  type HotelDemoQuestionId,
} from "./hotelDemoContracts.js";

export type HotelDemoDispatchRequest = {
  schemaVersion: typeof HOTEL_DEMO_SCHEMA_VERSION;
  policyVersion: typeof HOTEL_DEMO_POLICY_VERSION;
  taskId: string;
  attemptId: string;
  ownerId: string;
  confirmedRevision: number;
  destination: { displayName: string; phoneE164: string };
  questionIds: HotelDemoQuestionId[];
  disclosure: { id: typeof HOTEL_DEMO_DISCLOSURE_ID; text: string };
  authority: "gather_facts_only";
  forbiddenActions: typeof HOTEL_DEMO_FORBIDDEN_ACTIONS;
  maxAttempts: 1;
  maxConnectedSeconds: 180;
  automaticRetry: false;
  audioRecording: false;
};

const questionPrompts: Record<HotelDemoQuestionId, string> = {
  "after-midnight-allowed": "午前0時を過ぎて到着してもよいですか。",
  "latest-check-in-time": "最終チェックイン時刻は何時ですか。",
  "advance-notice-required": "遅れて到着する場合、事前にフロントへ連絡する必要がありますか。",
  "late-arrival-fee": "遅い到着について、ホテルが案内している追加料金はありますか。",
};

export function validateHotelDemoDispatch(input: HotelDemoDispatchRequest): HotelDemoDispatchRequest {
  if (input.schemaVersion !== 1 || input.policyVersion !== HOTEL_DEMO_POLICY_VERSION) throw new Error("Unsupported hotel demo contract");
  if (!input.taskId || !input.attemptId || !input.ownerId || !Number.isInteger(input.confirmedRevision) || input.confirmedRevision < 1) throw new Error("Invalid dispatch identity");
  if (!/^\+[1-9]\d{7,14}$/.test(input.destination.phoneE164)) throw new Error("Controlled destination must be E.164");
  if (!input.destination.displayName.trim()) throw new Error("Controlled destination name is required");
  if (input.disclosure.id !== HOTEL_DEMO_DISCLOSURE_ID || !input.disclosure.text.trim()) throw new Error("Approved disclosure is required");
  if (input.authority !== "gather_facts_only" || input.maxAttempts !== 1 || input.maxConnectedSeconds !== 180 || input.automaticRetry || input.audioRecording) {
    throw new Error("Hotel demo authority is invalid");
  }
  if (input.questionIds.length < 1 || input.questionIds.length > 4 || new Set(input.questionIds).size !== input.questionIds.length) throw new Error("Hotel demo questions are invalid");
  if (!input.questionIds.every((questionId) => (HOTEL_DEMO_QUESTION_IDS as readonly string[]).includes(questionId))) throw new Error("Hotel demo question is not allowed");
  if (input.forbiddenActions.length !== HOTEL_DEMO_FORBIDDEN_ACTIONS.length || !HOTEL_DEMO_FORBIDDEN_ACTIONS.every((action, index) => input.forbiddenActions[index] === action)) {
    throw new Error("Hotel demo forbidden action set drifted");
  }
  return input;
}

export function buildHotelDemoInstructions(input: HotelDemoDispatchRequest): string {
  validateHotelDemoDispatch(input);
  return [
    `FIRST UTTERANCE, verbatim in Japanese: ${input.disclosure.text}`,
    "Do not ask a question or exchange pleasantries before that exact disclosure has been spoken.",
    `You are Concierge, an AI assistant calling ${input.destination.displayName} in Japanese to gather facts only.`,
    `Ask only these approved questions, in order: ${input.questionIds.map((questionId) => questionPrompts[questionId]).join(" | ")}`,
    "Never book, change or cancel a reservation; never pay; never accept a fee or terms; never make a commitment.",
    "If asked to take a prohibited action, say you are authorized only to gather information, decline, and return to the approved questions or end the call.",
    "Do not infer an answer. Record only what the hotel representative actually states.",
    "Keep the call concise and courteous.",
  ].join("\n");
}
