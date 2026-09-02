import { describe, expect, it } from "vitest";

import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../../shared/inquiryFixtures.js";
import {
  InquiryRealtimeController,
  buildInquiryInstructions,
  buildOpeningResponse,
  buildRealtimeSessionUpdate,
  classifyAutomatedTurn,
  type InquiryDispatchRequest,
  type InquiryRealtimeSnapshot,
} from "../src/inquiryRealtime.js";

const request: InquiryDispatchRequest = {
  taskId: "task_1",
  attemptId: "attempt_1",
  ownerId: "user_1",
  confirmedRevision: 3,
  confirmedExecutionRevision: "inquiry-v1:sha256:fixture",
  dispatchIdempotencyKey: "dispatch_1",
  contract: HOTEL_INQUIRY_GOLDEN_FIXTURE,
};

const romanianRequest: InquiryDispatchRequest = {
  ...request,
  taskId: "task_ro",
  attemptId: "attempt_ro",
  dispatchIdempotencyKey: "dispatch_ro",
  contract: {
    ...HOTEL_INQUIRY_GOLDEN_FIXTURE,
    destination: {
      ...HOTEL_INQUIRY_GOLDEN_FIXTURE.destination,
      displayName: "Romanian canary recipient",
      e164PhoneNumber: "+66831092872",
      countryCode: "TH",
    },
    objective: "Obține informații despre patru aspecte ale conversației de test.",
    questions: [
      { id: "available", prompt: "Este un moment potrivit pentru conversație?", required: true },
      { id: "audio-clear", prompt: "Mă auziți clar?", required: true },
      { id: "language", prompt: "În ce limbă preferați să continuăm?", required: true },
      { id: "anything-else", prompt: "Este altceva relevant pentru această solicitare?", required: true },
    ],
    languages: { call: "ro-RO", result: "en" },
    disclosure: {
      ...HOTEL_INQUIRY_GOLDEN_FIXTURE.disclosure,
      id: "callbridge-disclosure-ro-v1",
      locale: "ro-RO",
      text: "Sunt un asistent AI care sună în numele unui utilizator. Conversația este transcrisă, dar sunetul nu este înregistrat.",
    },
  },
};

function deliverOpening(controller: InquiryRealtimeController, input = request): void {
  controller.sessionConfigured(input);
  controller.assistantTranscript(
    `${input.contract.disclosure.text} Sun pentru a obține câteva informații.`,
    input,
    2_000,
  );
  const commands = controller.responseFinished(input, "MZ_1");
  const name = (commands[0] as { payload?: { mark?: { name?: string } } } | undefined)?.payload?.mark?.name;
  expect(name).toBeTruthy();
  expect(controller.twilioMarkReceived(name!, 2_100)).toBe(true);
}

describe("general inquiry Realtime policy", () => {
  it("uses the generalized contract and keeps the exact disclosure first", () => {
    const instructions = buildInquiryInstructions(request);
    const opening = buildOpeningResponse(request);
    expect(instructions).toContain(HOTEL_INQUIRY_GOLDEN_FIXTURE.objective);
    expect(instructions).toContain("[latest-check-in-time]");
    expect(instructions).toContain("Never book, change or cancel anything");
    expect(JSON.stringify(opening)).toContain(HOTEL_INQUIRY_GOLDEN_FIXTURE.disclosure.text);
    expect(instructions).not.toContain("Ask only these approved questions, in order: 午前");
  });

  it("keeps native speech-to-speech while withholding automatic responses for deterministic classification", () => {
    const update = buildRealtimeSessionUpdate({ request, model: "gpt-realtime-2.1-mini" });
    expect(update).toMatchObject({
      type: "session.update",
      session: {
        model: "gpt-realtime-2.1-mini",
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcmu" },
            transcription: {
              model: "gpt-4o-transcribe",
              language: "ja",
              prompt: expect.any(String),
            },
            noise_reduction: { type: "near_field" },
            turn_detection: {
              type: "server_vad",
              create_response: false,
              interrupt_response: true,
            },
          },
          output: { format: { type: "audio/pcmu" } },
        },
        tools: [],
        tool_choice: "none",
      },
    });
  });

  it("classifies keypad menus before voicemail phrases", () => {
    expect(classifyAutomatedTurn(
      "Thank you for calling. To leave a voicemail press 3, or press 0 for reception.",
      { automatedGreetingCount: 0, ivrPromptCount: 0 },
    )).toMatchObject({ disposition: "ivr", ivrPromptCount: 2 });
    expect(classifyAutomatedTurn(
      "Your call has been forwarded to voicemail. Please leave your message after the tone.",
      { automatedGreetingCount: 0, ivrPromptCount: 0 },
    )).toMatchObject({ disposition: "voicemail", automatedGreetingCount: 2 });
  });

  it("withholds speech on one weak automation marker and closes on the second", () => {
    const first = classifyAutomatedTurn("Thank you for calling Example Company.", {
      automatedGreetingCount: 0,
      ivrPromptCount: 0,
    });
    expect(first.disposition).toBe("suspected_automation");
    const second = classifyAutomatedTurn("Our normal business hours are nine to five.", first);
    expect(second.disposition).toBe("voicemail");
  });
});

describe("general inquiry Realtime controller", () => {
  it("starts the exact disclosure once Realtime confirms the session, without waiting for recipient speech", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    expect(controller.sessionConfigured(request)).toEqual([
      expect.objectContaining({ channel: "openai", payload: expect.objectContaining({ type: "response.create" }) }),
    ]);
    expect(controller.sessionConfigured(request)).toEqual([]);
    expect(controller.snapshot()).toMatchObject({
      phase: "waiting_for_recipient",
      disclosureDelivered: false,
      responseActive: true,
      initialOpeningRequested: true,
      awaitingRecipientSinceMs: null,
    });
  });

  it("does not queue a duplicate opening when recipient speech wins the session-ready race", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    expect(controller.providerTranscript("Hello?", request, 1_010)).toEqual([
      expect.objectContaining({ channel: "openai", payload: expect.objectContaining({ type: "response.create" }) }),
    ]);
    expect(controller.sessionConfigured(request)).toEqual([]);
    expect(controller.snapshot()).toMatchObject({
      initialOpeningRequested: true,
      pendingOpeningResponse: false,
      responseActive: true,
    });
    expect(controller.responseFinished(request)).toEqual([]);
  });

  it("clears queued Twilio audio and truncates the actually heard assistant item on barge-in", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    controller.responseStarted();
    controller.assistantItemAdded("item_1");
    controller.assistantAudioSent(btoa("x".repeat(8_000)), 2_000);
    const commands = controller.recipientSpeechStarted("MZ_1", 2_600);
    expect(commands).toEqual([
      { channel: "twilio", payload: { event: "clear", streamSid: "MZ_1" } },
      {
        channel: "openai",
        payload: {
          type: "conversation.item.truncate",
          item_id: "item_1",
          content_index: 0,
          audio_end_ms: 600,
        },
      },
    ]);
    expect(controller.snapshot()).toMatchObject({
      pendingOpeningResponse: true,
      assistantAudioSentMs: 0,
      assistantAudioStartedAtMs: null,
    });
  });

  it("never queues a general response ahead of interrupted disclosure recovery", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    controller.providerTranscript("Hello?", request);
    controller.recipientSpeechStarted("MZ_1", 1_500);
    expect(controller.providerTranscript("Yes, who is this?", request)).toEqual([]);
    expect(controller.snapshot()).toMatchObject({
      responseActive: true,
      pendingOpeningResponse: true,
      pendingGeneralResponse: false,
    });
    const recovery = controller.responseFinished(request);
    expect(recovery).toEqual([
      expect.objectContaining({ channel: "openai", payload: expect.objectContaining({ type: "response.create" }) }),
    ]);
    expect(controller.twilioMarkReceived("disclosure:attempt_1:1", 1_600)).toBe(false);
    expect(controller.snapshot().disclosureDelivered).toBe(false);
  });

  it("fails closed if the first completed assistant turn did not start with the approved disclosure", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    expect(controller.assistantTranscript("Hello, I am calling about a hotel.", request, 2_000)).toEqual([
      { channel: "control", action: "hangup", reason: "disclosure_failure" },
    ]);
  });

  it("replays an interrupted approved disclosure prefix instead of hanging up", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    controller.sessionConfigured(request);
    controller.responseStarted();
    controller.assistantItemAdded("item_1");
    controller.assistantAudioSent(btoa("x".repeat(8_000)), 1_100);
    controller.recipientSpeechStarted("MZ_1", 1_500);

    const partialDisclosure = request.contract.disclosure.text.slice(0, 42).trim();
    expect(controller.assistantTranscript(partialDisclosure, request, 1_510)).toEqual([]);
    expect(controller.snapshot()).toMatchObject({
      disclosureDelivered: false,
      disclosureResponseInterrupted: true,
      pendingOpeningResponse: true,
      hangupRequested: false,
    });
    expect(controller.responseFinished(request, "MZ_1")).toEqual([
      expect.objectContaining({ channel: "openai", payload: expect.objectContaining({ type: "response.create" }) }),
    ]);
  });

  it("still fails closed when an interrupted opening is not an approved disclosure prefix", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    controller.sessionConfigured(request);
    controller.responseStarted();
    controller.recipientSpeechStarted("MZ_1", 1_500);

    expect(controller.assistantTranscript("Hello, I am calling about a hotel.", request, 1_510)).toEqual([
      { channel: "control", action: "hangup", reason: "disclosure_failure" },
    ]);
  });

  it("allows normal classified turns only after disclosure delivery", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    controller.providerTranscript("Hello?", request);
    controller.assistantTranscript(
      `${request.contract.disclosure.text} I am calling to ask about late arrival.`,
      request,
      2_000,
    );
    expect(controller.snapshot().disclosureDelivered).toBe(false);
    expect(controller.responseFinished(request, "MZ_1")).toEqual([
      {
        channel: "twilio",
        payload: {
          event: "mark",
          streamSid: "MZ_1",
          mark: { name: "disclosure:attempt_1:1" },
        },
      },
    ]);
    expect(controller.twilioMarkReceived("disclosure:attempt_1:1", 2_100)).toBe(true);
    expect(controller.providerTranscript("Yes, arrivals after midnight are allowed.", request)).toEqual([
      {
        channel: "openai",
        payload: expect.objectContaining({
          type: "response.create",
          response: expect.objectContaining({
            instructions: expect.stringContaining("What is the latest check-in time?"),
          }),
        }),
      },
    ]);
    expect(controller.snapshot()).toMatchObject({ phase: "active", disclosureDelivered: true });
  });

  it("advances after a substantive transcript even when Romanian yes is misheard as Download", () => {
    const controller = new InquiryRealtimeController({ request: romanianRequest, connectedAtMs: 1_000 });
    deliverOpening(controller, romanianRequest);
    expect(controller.snapshot().questionProgress[0]).toMatchObject({ status: "asked", askCount: 1 });

    const secondQuestion = controller.providerTranscript("Download", romanianRequest, 2_200);
    const secondInstructions = JSON.stringify(secondQuestion);
    expect(secondInstructions).toContain("Mă auziți clar?");
    expect(secondInstructions).not.toContain("Este un moment potrivit pentru conversație?");
    expect(controller.snapshot().activeQuestionId).toBe("audio-clear");
    expect(controller.snapshot().questionProgress.slice(0, 2)).toEqual([
      { questionId: "available", status: "answered", askCount: 1, clarificationCount: 0 },
      { questionId: "audio-clear", status: "asked", askCount: 1, clarificationCount: 0 },
    ]);

    controller.responseFinished(romanianRequest, "MZ_1");
    controller.providerTranscript("Da, foarte clar.", romanianRequest, 2_300);
    controller.responseFinished(romanianRequest, "MZ_1");
    controller.providerTranscript("Română.", romanianRequest, 2_400);
    controller.responseFinished(romanianRequest, "MZ_1");
    const completion = controller.providerTranscript("Nu, nimic altceva.", romanianRequest, 2_500);
    expect(JSON.stringify(completion)).toContain("All approved questions are now answered or unavailable");
    expect(controller.snapshot().questionProgress.every(({ status }) => status === "answered")).toBe(true);

    controller.assistantTranscript("Vă mulțumesc. La revedere.", romanianRequest, 2_600);
    const mark = controller.responseFinished(romanianRequest, "MZ_1");
    const markName = (mark[0] as { payload?: { mark?: { name?: string } } } | undefined)?.payload?.mark?.name;
    expect(markName).toBe("completion:attempt_ro:1");
    expect(controller.completionMarkReceived(markName!)).toEqual([
      { channel: "control", action: "hangup", reason: "completed" },
    ]);
  });

  it("clarifies one question only once, then marks it unavailable and advances", () => {
    const controller = new InquiryRealtimeController({ request: romanianRequest, connectedAtMs: 1_000 });
    deliverOpening(controller, romanianRequest);

    const clarification = controller.providerTranscript("Poftim?", romanianRequest, 2_200);
    expect(JSON.stringify(clarification)).toContain("Rephrase only that question once");
    expect(controller.snapshot().questionProgress[0]).toMatchObject({
      status: "asked",
      askCount: 2,
      clarificationCount: 1,
    });

    controller.responseFinished(romanianRequest, "MZ_1");
    const advance = controller.providerTranscript("Poftim?", romanianRequest, 2_300);
    expect(JSON.stringify(advance)).toContain("Mă auziți clar?");
    expect(JSON.stringify(advance)).not.toContain("Este un moment potrivit pentru conversație?");
    expect(controller.snapshot().questionProgress.slice(0, 2)).toEqual([
      { questionId: "available", status: "unavailable", askCount: 2, clarificationCount: 1 },
      { questionId: "audio-clear", status: "asked", askCount: 1, clarificationCount: 0 },
    ]);
  });

  it("restores older snapshots without dialogue progress fields", () => {
    const current = new InquiryRealtimeController({ request, connectedAtMs: 1_000 }).snapshot();
    const {
      questionProgress: _questionProgress,
      activeQuestionId: _activeQuestionId,
      activeDialoguePlan: _activeDialoguePlan,
      pendingDialoguePlan: _pendingDialoguePlan,
      completionResponseRequested: _completionResponseRequested,
      pendingCompletionMarkName: _pendingCompletionMarkName,
      nextCompletionMarkSequence: _nextCompletionMarkSequence,
      ...legacySnapshot
    } = current;
    const restored = new InquiryRealtimeController({
      request,
      connectedAtMs: 1_000,
      snapshot: legacySnapshot as InquiryRealtimeSnapshot,
    });
    expect(restored.snapshot()).toMatchObject({
      activeQuestionId: null,
      completionResponseRequested: false,
      pendingCompletionMarkName: null,
      nextCompletionMarkSequence: 1,
    });
    expect(restored.snapshot().questionProgress).toHaveLength(request.contract.questions.length);
    expect(restored.snapshot().questionProgress.every(({ status }) => status === "unasked")).toBe(true);
  });

  it("does not let a stale playback mark satisfy a retried disclosure", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    controller.providerTranscript("Hello?", request, 1_100);
    controller.assistantTranscript(request.contract.disclosure.text, request, 1_500);
    expect(controller.responseFinished(request, "MZ_1")).toEqual([
      expect.objectContaining({
        channel: "twilio",
        payload: expect.objectContaining({ mark: { name: "disclosure:attempt_1:1" } }),
      }),
    ]);

    controller.recipientSpeechStarted("MZ_1", 1_600);
    controller.providerTranscript("Sorry, what was that?", request, 1_700);
    controller.responseStarted();
    controller.assistantTranscript(request.contract.disclosure.text, request, 2_000);
    expect(controller.responseFinished(request, "MZ_1")).toEqual([
      expect.objectContaining({
        channel: "twilio",
        payload: expect.objectContaining({ mark: { name: "disclosure:attempt_1:2" } }),
      }),
    ]);
    expect(controller.twilioMarkReceived("disclosure:attempt_1:1", 2_100)).toBe(false);
    expect(controller.twilioMarkReceived("disclosure:attempt_1:2", 2_200)).toBe(true);
  });

  it("ends automated calls without producing assistant audio", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    expect(controller.providerTranscript("Press one for reservations or press two for reception.", request)).toEqual([
      { channel: "control", action: "hangup", reason: "ivr" },
    ]);
    expect(controller.snapshot()).toMatchObject({ phase: "ending", responseActive: false });
  });

  it("enforces contract duration and post-agent silence exactly once", () => {
    const duration = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    expect(duration.enforceTimeouts({
      nowMs: 181_000,
      maxConnectedSeconds: request.contract.policy.maxConnectedSeconds,
    })).toEqual([{ channel: "control", action: "hangup", reason: "connected_timeout" }]);
    expect(duration.enforceTimeouts({
      nowMs: 182_000,
      maxConnectedSeconds: request.contract.policy.maxConnectedSeconds,
    })).toEqual([]);

    const silence = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    silence.assistantTranscript(request.contract.disclosure.text, request, 2_000);
    silence.responseFinished(request, "MZ_1");
    silence.twilioMarkReceived("disclosure:attempt_1:1", 2_000);
    expect(silence.enforceTimeouts({
      nowMs: 22_001,
      maxConnectedSeconds: request.contract.policy.maxConnectedSeconds,
      postAgentSilenceMs: 20_000,
    })).toEqual([{ channel: "control", action: "hangup", reason: "post_agent_silence_timeout" }]);

    const initialSilence = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    expect(initialSilence.enforceTimeouts({
      nowMs: 21_001,
      maxConnectedSeconds: request.contract.policy.maxConnectedSeconds,
      postAgentSilenceMs: 20_000,
    })).toEqual([{ channel: "control", action: "hangup", reason: "initial_recipient_silence_timeout" }]);
  });

  it("bounds and explicitly clears raw transcript turns", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    controller.providerTranscript("Hello?", request);
    controller.assistantTranscript(request.contract.disclosure.text, request, 2_000);
    expect(controller.snapshot().rawTurns).toHaveLength(2);
    controller.clearRawTurns();
    expect(controller.snapshot()).toMatchObject({ rawTurns: [], rawTurnBytes: 0 });
  });
});
