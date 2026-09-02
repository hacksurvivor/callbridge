import {
  INQUIRY_FORBIDDEN_ACTIONS,
  INQUIRY_REQUIRED_DISCLOSURE_CLAIMS,
  type InquiryCallContract,
} from "./inquiryContracts.js";

/** The original hotel scenario remains the golden fixture, not the product boundary. */
export const HOTEL_INQUIRY_GOLDEN_FIXTURE = {
  schemaVersion: 1,
  category: "accommodation",
  destination: {
    displayName: "Controlled Hotel Tokyo",
    e164PhoneNumber: "+81312345678",
    countryCode: "JP",
    address: "Tokyo, Japan",
    website: "https://example.com/hotel",
  },
  objective: "Find out whether a guest may arrive after midnight without changing or booking a reservation.",
  questions: [
    { id: "after-midnight-allowed", prompt: "Is arrival after midnight allowed?", required: true },
    { id: "latest-check-in-time", prompt: "What is the latest check-in time?", required: true },
    { id: "advance-notice-required", prompt: "Is advance notice required?", required: true },
    { id: "late-arrival-fee", prompt: "Is there a late-arrival fee?", required: true },
  ],
  languages: { call: "ja-JP", result: "en" },
  context: {
    privateBackground: "The traveler expects to arrive after midnight and only needs factual information.",
    shareableFacts: [
      {
        id: "arrival-window",
        label: "Expected arrival",
        value: "After midnight",
        shareWhen: "Share only if needed to answer the questions.",
      },
    ],
  },
  disclosure: {
    id: "callbridge-disclosure-ja-v1",
    locale: "ja-JP",
    text: "これはユーザーに代わって電話をしているAIアシスタントです。会話は文字起こしされ、音声は録音されません。必要最小限の構造化された証拠のみが一時的に保持されます。",
    requiredClaims: [...INQUIRY_REQUIRED_DISCLOSURE_CLAIMS],
  },
  playbook: {
    id: "hotel-late-arrival",
    revision: 1,
    name: "Hotel late-arrival inquiry",
    source: "system",
    steps: [
      { id: "disclose", instruction: "Deliver the approved AI disclosure before asking questions." },
      { id: "ask", instruction: "Ask the approved questions naturally and clarify ambiguous answers." },
      { id: "close", instruction: "Thank the recipient and end without making a commitment." },
    ],
  },
  costCeiling: { currency: "USD", maxTotalMinorUnits: 500 },
  policy: {
    id: "inquiry-demo-v1",
    authority: "gather_information_only",
    forbiddenActions: [...INQUIRY_FORBIDDEN_ACTIONS],
    maxAttempts: 1,
    automaticRetry: false,
    maxConnectedSeconds: 180,
    audioRecording: false,
  },
} satisfies InquiryCallContract;
