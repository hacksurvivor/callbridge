import { describe, expect, it, vi } from "vitest";

import { HOTEL_DEMO_FORBIDDEN_ACTIONS } from "../src/hotelDemoContracts";
import { deliverHotelDemoEvent } from "../src/hotelDemoEventClient";
import { buildHotelDemoInstructions, validateHotelDemoDispatch, type HotelDemoDispatchRequest } from "../src/hotelDemoPolicy";
import { HotelDemoSessionState } from "../src/hotelDemoSessionState";

const dispatch: HotelDemoDispatchRequest = {
  schemaVersion: 1,
  policyVersion: "hotel-ja-v1",
  taskId: "task_1",
  attemptId: "attempt_1",
  ownerId: "user_1",
  confirmedRevision: 2,
  destination: { displayName: "Sakura Hotel Kyoto", phoneE164: "+81751234142" },
  questionIds: ["latest-check-in-time", "advance-notice-required"],
  disclosure: { id: "ai-assistant-ja-v2", text: "AIアシスタントです。通話は文字起こしされ、録音されません。結果は24時間保持されます。" },
  authority: "gather_facts_only",
  forbiddenActions: HOTEL_DEMO_FORBIDDEN_ACTIONS,
  maxAttempts: 1,
  maxConnectedSeconds: 180,
  automaticRetry: false,
  audioRecording: false,
};

describe("hotel demo worker boundaries", () => {
  it("locks dispatch to the one-attempt facts-only policy and exact first disclosure", () => {
    expect(validateHotelDemoDispatch(dispatch)).toBe(dispatch);
    const instructions = buildHotelDemoInstructions(dispatch);
    expect(instructions.split("\n")[0]).toContain(dispatch.disclosure.text);
    expect(instructions).toContain("Never book, change or cancel");
    expect(() => validateHotelDemoDispatch({ ...dispatch, maxAttempts: 2 as 1 })).toThrow("authority");
  });

  it("restores lifecycle state, requires disclosure before questions, and emits one timeout hangup", () => {
    const state = new HotelDemoSessionState({ taskId: "task_1", attemptId: "attempt_1" });
    state.markDialing("2026-08-26T00:00:00.000Z");
    state.markConnected("2026-08-26T00:00:01.000Z");
    expect(() => state.startQuestion("latest-check-in-time", "2026-08-26T00:00:02.000Z")).toThrow("Disclosure");
    state.markDisclosureDelivered("2026-08-26T00:00:02.000Z");
    state.startQuestion("latest-check-in-time", "2026-08-26T00:00:03.000Z");

    const restored = new HotelDemoSessionState({ taskId: "task_1", attemptId: "attempt_1", snapshot: state.snapshot() });
    expect(restored.enforceConnectedTimeout("2026-08-26T00:03:01.000Z")).toMatchObject({ type: "hangup_requested", publicPayload: { reason: "connected_timeout" } });
    expect(restored.enforceConnectedTimeout("2026-08-26T00:03:02.000Z")).toBeNull();
  });

  it("bounds raw turns and deletes them explicitly after extraction", () => {
    const state = new HotelDemoSessionState({ taskId: "task_1", attemptId: "attempt_1" });
    state.markDialing("2026-08-26T00:00:00.000Z");
    state.markConnected("2026-08-26T00:00:01.000Z");
    expect(state.appendRawTurn({ speaker: "provider", text: "x".repeat(2_049) })).toBe(false);
    expect(state.appendRawTurn({ speaker: "provider", text: "最終チェックインは午前1時です。" })).toBe(true);
    expect(state.snapshot().rawTurns).toHaveLength(1);
    state.clearRawTurns();
    expect(state.snapshot()).toMatchObject({ rawTurns: [], rawTurnBytes: 0 });
  });

  it("retries a signed callback twice and then succeeds", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const wait = vi.fn(async () => {});
    const state = new HotelDemoSessionState({ taskId: "task_1", attemptId: "attempt_1" });
    const event = state.markDialing("2026-08-26T00:00:00.000Z");
    await deliverHotelDemoEvent({
      callbackUrl: "https://example.convex.site/webhooks/hotel-demo-event",
      secret: "callback-secret",
      event,
      fetchImpl,
      nowMs: () => 1_787_724_000_000,
      wait,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenNthCalledWith(1, 250);
    expect(wait).toHaveBeenNthCalledWith(2, 1_000);
  });
});
