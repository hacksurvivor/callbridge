import {
  HOTEL_DEMO_DISCLOSURE_ID,
  type AttemptEvent,
  type HotelDemoQuestionId,
} from "./hotelDemoContracts.js";

export type RawTurn = { speaker: "provider" | "callbridge"; text: string };
export type HotelDemoSessionSnapshot = {
  taskId: string;
  attemptId: string;
  nextWorkerSequence: number;
  phase: "configured" | "dialing" | "connected" | "ending" | "terminal";
  connectedAt: string | null;
  disclosureDelivered: boolean;
  hangupRequested: boolean;
  rawTurns: RawTurn[];
  rawTurnBytes: number;
};

const MAX_TURN_BYTES = 2 * 1_024;
const MAX_TURNS = 128;
const MAX_TOTAL_TURN_BYTES = 64 * 1_024;

export class HotelDemoSessionState {
  private snapshotValue: HotelDemoSessionSnapshot;

  constructor(input: { taskId: string; attemptId: string; snapshot?: HotelDemoSessionSnapshot }) {
    this.snapshotValue = input.snapshot ?? {
      taskId: input.taskId,
      attemptId: input.attemptId,
      nextWorkerSequence: 1,
      phase: "configured",
      connectedAt: null,
      disclosureDelivered: false,
      hangupRequested: false,
      rawTurns: [],
      rawTurnBytes: 0,
    };
    if (this.snapshotValue.taskId !== input.taskId || this.snapshotValue.attemptId !== input.attemptId) throw new Error("Session snapshot identity mismatch");
  }

  snapshot(): HotelDemoSessionSnapshot {
    return structuredClone(this.snapshotValue);
  }

  private emit(type: AttemptEvent["type"], publicPayload: AttemptEvent["publicPayload"], observedAt: string): AttemptEvent {
    const workerSequence = this.snapshotValue.nextWorkerSequence++;
    return {
      schemaVersion: 1,
      eventId: `${this.snapshotValue.attemptId}:${workerSequence}:${type}`,
      taskId: this.snapshotValue.taskId,
      attemptId: this.snapshotValue.attemptId,
      workerSequence,
      observedAt,
      source: "telephony_worker",
      type,
      publicPayload,
    } as AttemptEvent;
  }

  markDialing(observedAt: string) {
    if (this.snapshotValue.phase !== "configured") throw new Error("Session is not configurable for dialing");
    this.snapshotValue.phase = "dialing";
    return this.emit("dialing", {}, observedAt);
  }

  markDispatchAccepted(observedAt: string) {
    if (this.snapshotValue.phase !== "configured") throw new Error("Session is not configured");
    return this.emit("dispatch_accepted", {}, observedAt);
  }

  markConnected(observedAt: string) {
    if (this.snapshotValue.phase !== "dialing") throw new Error("Session is not dialing");
    this.snapshotValue.phase = "connected";
    this.snapshotValue.connectedAt = observedAt;
    return this.emit("connected", {}, observedAt);
  }

  markDisclosureDelivered(observedAt: string) {
    if (this.snapshotValue.phase !== "connected" || this.snapshotValue.disclosureDelivered) throw new Error("Disclosure cannot be recorded in this state");
    this.snapshotValue.disclosureDelivered = true;
    return this.emit("disclosure_delivered", { disclosureId: HOTEL_DEMO_DISCLOSURE_ID }, observedAt);
  }

  startQuestion(questionId: HotelDemoQuestionId, observedAt: string) {
    if (this.snapshotValue.phase !== "connected" || !this.snapshotValue.disclosureDelivered) throw new Error("Disclosure must be delivered before questions");
    return this.emit("question_started", { questionId }, observedAt);
  }

  recordFact(input: {
    questionId: HotelDemoQuestionId;
    sourceText: string;
    translatedValue: string;
    extractionConfidence: number;
    translationConfidence: number;
  }, observedAt: string) {
    if (this.snapshotValue.phase !== "connected" && this.snapshotValue.phase !== "ending") throw new Error("Facts cannot be recorded in this state");
    return this.emit("fact_observed", input, observedAt);
  }

  recordPolicyViolation(input: {
    category: "unauthorized_commitment" | "forbidden_action_attempt" | "disclosure_failure";
    evidenceExcerpt: string;
  }, observedAt: string) {
    return this.emit("policy_violation_detected", input, observedAt);
  }

  recordFailure(stage: "dispatch" | "dialing" | "connection" | "callback", code: string, observedAt: string) {
    this.snapshotValue.phase = "terminal";
    return this.emit("failed", { stage, code }, observedAt);
  }

  appendRawTurn(turn: RawTurn): boolean {
    if (this.snapshotValue.phase !== "connected") return false;
    const bytes = new TextEncoder().encode(turn.text).byteLength;
    if (!turn.text.trim() || bytes > MAX_TURN_BYTES || this.snapshotValue.rawTurns.length >= MAX_TURNS || this.snapshotValue.rawTurnBytes + bytes > MAX_TOTAL_TURN_BYTES) {
      return false;
    }
    this.snapshotValue.rawTurns.push({ speaker: turn.speaker, text: turn.text });
    this.snapshotValue.rawTurnBytes += bytes;
    return true;
  }

  requestHangup(reason: "user" | "connected_timeout" | "policy", observedAt: string) {
    if (this.snapshotValue.phase === "terminal" || this.snapshotValue.hangupRequested) return null;
    if (this.snapshotValue.phase !== "dialing" && this.snapshotValue.phase !== "connected" && this.snapshotValue.phase !== "ending") return null;
    this.snapshotValue.phase = "ending";
    this.snapshotValue.hangupRequested = true;
    return this.emit("hangup_requested", { reason }, observedAt);
  }

  enforceConnectedTimeout(now: string) {
    if (this.snapshotValue.phase !== "connected" || !this.snapshotValue.connectedAt) return null;
    if (new Date(now).getTime() - new Date(this.snapshotValue.connectedAt).getTime() < 180_000) return null;
    return this.requestHangup("connected_timeout", now);
  }

  finish(reason: "completed" | "user" | "connected_timeout" | "remote_hangup", observedAt: string) {
    if (this.snapshotValue.phase === "terminal") return null;
    this.snapshotValue.phase = "terminal";
    return this.emit("ended", { reason }, observedAt);
  }

  clearRawTurns(): void {
    this.snapshotValue.rawTurns = [];
    this.snapshotValue.rawTurnBytes = 0;
  }
}
