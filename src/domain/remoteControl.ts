export const REMOTE_COMMAND_KINDS = [
  "agent_task",
  "status",
  "pause_history",
  "resume_history",
  "summarize_recent",
] as const;

export type RemoteCommandKind = (typeof REMOTE_COMMAND_KINDS)[number];

export const REMOTE_INSTRUCTION_MAX_LENGTH = 4_000;
export const REMOTE_RESULT_MAX_LENGTH = 8_000;
export const REMOTE_EVENT_MAX_LENGTH = 1_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[0-9a-f]{64}$/i;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{8,120}$/;

export function validateRemoteHostId(value: string): string {
  const normalized = value.trim();
  if (!UUID_PATTERN.test(normalized)) throw new Error("Remote host id must be a UUID");
  return normalized.toLowerCase();
}

export function validateRemoteSecretHash(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA256_PATTERN.test(normalized)) throw new Error("Remote host secret hash is invalid");
  return normalized;
}

export function validateRemoteDisplayName(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) throw new Error("Remote host name is invalid");
  return normalized;
}

export function validateRemoteClientRequestId(value: string): string {
  const normalized = value.trim();
  if (!REQUEST_ID_PATTERN.test(normalized)) throw new Error("Remote request id is invalid");
  return normalized;
}

export function validateRemoteCommandKind(value: string): RemoteCommandKind {
  if (!REMOTE_COMMAND_KINDS.includes(value as RemoteCommandKind)) {
    throw new Error("Remote command kind is invalid");
  }
  return value as RemoteCommandKind;
}

export function normalizeRemoteInstruction(kind: RemoteCommandKind, value?: string): string | undefined {
  if (kind !== "agent_task") return undefined;
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error("An agent task requires an instruction");
  if (normalized.length > REMOTE_INSTRUCTION_MAX_LENGTH) throw new Error("Remote instruction is too long");
  return normalized;
}

export function normalizeRemoteOutput(value: string, maximumLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("Remote output cannot be empty");
  if (normalized.length > maximumLength) return normalized.slice(0, maximumLength);
  return normalized;
}

export function constantTimeEqualHex(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  let mismatch = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    mismatch |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return mismatch === 0;
}
