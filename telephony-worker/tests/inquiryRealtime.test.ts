import { describe, expect, it } from "vitest";

import { HOTEL_INQUIRY_GOLDEN_FIXTURE } from "../../shared/inquiryFixtures.js";
import {
  InquiryRealtimeController,
  buildInquiryInstructions,
  buildOpeningResponse,
  buildRealtimeSessionUpdate,
  classifyAutomatedTurn,
  type InquiryDispatchRequest,
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
  it("waits for a classified human turn before delivering the disclosure", () => {
    const controller = new InquiryRealtimeController({ request, connectedAtMs: 1_000 });
    expect(controller.providerTranscript("Hello?", request)).toEqual([
      expect.objectContaining({ channel: "openai", payload: expect.objectContaining({ type: "response.create" }) }),
    ]);
    expect(controller.snapshot()).toMatchObject({
      phase: "waiting_for_recipient",
      disclosureDelivered: false,
      responseActive: true,
    });
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
      { channel: "openai", payload: { type: "response.create" } },
    ]);
    expect(controller.snapshot()).toMatchObject({ phase: "active", disclosureDelivered: true });
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
