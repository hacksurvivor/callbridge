import type { AuthenticatedActor, CallTaskDraft } from "../src/domain/model.js";

export const actor: AuthenticatedActor = {
  userId: "user_123",
  sessionId: "session_123",
  roles: ["member"],
  permissions: [],
};

export function completeDraft(): CallTaskDraft {
  return {
    category: "accommodation",
    title: "Find a quiet hotel room",
    sources: {
      typedContext: "Please ask about a quiet room.",
      voiceNote: {
        storageKey: "voice/user_123/note.webm",
        transcript: "Need breakfast and late arrival.",
        mediaType: "audio/webm",
      },
      transcript: "Typed transcript correction.",
      sourceUrl: "https://hotel.example/rooms",
      screenshot: {
        storageKey: "screenshots/user_123/room.png",
        mediaType: "image/png",
        extractedText: "Deluxe room",
      },
    },
    target: {
      name: "Hotel Example",
      contacts: [
        { kind: "phone", value: "+1 555 0100", label: "Front desk", verified: true },
        { kind: "website", value: "https://hotel.example", verified: true },
      ],
      address: "1 Example Street",
    },
    details: {
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
      adults: 2,
      children: 1,
      rooms: 1,
      roomPreferences: ["quiet", "non-smoking"],
    },
    dateResolution: {
      source: "explicit",
      checkIn: "2026-09-10",
      checkOut: "2026-09-13",
      resolvedAt: "2026-08-11T00:00:00.000Z",
      referenceTimeZone: "Asia/Bangkok",
      timeZoneSource: "profile",
    },
    questions: ["Is breakfast included?", "Is late check-in possible?"],
    budget: {
      maxMinorUnits: 45_000,
      currency: "USD",
      includesMandatoryFees: true,
    },
    userLanguage: "th-TH",
    callLanguage: "en-US",
    locale: "th-TH",
    notes: "Return options; do not reserve anything.",
    autonomy: {
      fullAccess: false,
      automaticallyTryNextVerifiedNumber: false,
      automaticallyRetryUnavailableNumber: false,
      retryDelayMinutes: 5,
      maxAutomaticRetriesPerNumber: 2,
      mentionPastVisits: false,
      useCompetitorPricing: false,
      nameCompetitorAndExactPrice: false,
    },
    memory: {
      mode: "save_for_30_days",
      retainForDays: 30,
    },
    callWindow: {
      timeZone: "Asia/Bangkok",
      days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"],
      opensAt: "00:00",
      closesAt: "23:59",
    },
    permissions: {
      scope: "gather_options_only",
      mayShareProvidedDetails: true,
      mayBook: false,
      mayPay: false,
      mayAcceptTerms: false,
      mayMakeIrreversibleCommitment: false,
      mayCancel: false,
    },
  };
}
