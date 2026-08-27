import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const PAIRING_KEY = "callbridge.remote-mac.v1";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

export type PairedMac = {
  hostId: string;
  displayName: string;
  secret: string;
};

export type MacCommandKind = "agent_task" | "status" | "pause_history" | "resume_history" | "summarize_recent";
export type MacCommandState = "pending" | "running" | "cancellation_requested" | "succeeded" | "failed" | "cancelled";

export type MacCommand = {
  commandId: string;
  clientRequestId: string;
  kind: MacCommandKind;
  instruction?: string;
  state: MacCommandState;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  cancellationRequestedAt?: string;
  resultSummary?: string;
  failureReason?: string;
  events?: Array<{ sequence: number; kind: "status" | "output" | "warning" | "result"; message: string; createdAt: string }>;
};

export type MacCommandList = {
  host: { hostId: string; displayName: string; state: "online" | "offline" | "revoked"; lastSeenAt: string };
  commands: MacCommand[];
};

function relayURL(): string {
  const raw = process.env.EXPO_PUBLIC_CONVEX_SITE_URL?.trim();
  if (!raw) throw new Error("The Mac relay is not configured in this build.");
  const parsed = new URL(raw);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") {
    throw new Error("The Mac relay must use HTTPS.");
  }
  return raw.replace(/\/$/, "");
}

export function parseMacPairingToken(raw: string): PairedMac {
  const parsed = new URL(raw.trim());
  const hostId = parsed.searchParams.get("host")?.toLowerCase() ?? "";
  const secret = parsed.searchParams.get("secret") ?? "";
  const displayName = parsed.searchParams.get("name")?.trim() ?? "Mac";
  if (parsed.protocol !== "callbridge:" || parsed.hostname !== "pair" || !UUID_PATTERN.test(hostId) || !SECRET_PATTERN.test(secret)) {
    throw new Error("This pairing token is not valid.");
  }
  if (!displayName || displayName.length > 80) throw new Error("This pairing token has an invalid Mac name.");
  return { hostId, displayName, secret };
}

async function post<T>(pairing: PairedMac, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${relayURL()}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${pairing.secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ hostId: pairing.hostId, ...body }),
  });
  const payload = await response.json() as { ok?: boolean; error?: string } & T;
  if (!response.ok || payload.ok !== true) throw new Error(payload.error ?? "The Mac relay rejected this request.");
  return payload;
}

export const macCompanionGateway = {
  async pair(rawToken: string): Promise<PairedMac> {
    if (Platform.OS !== "ios" || !(await SecureStore.isAvailableAsync())) {
      throw new Error("Mac pairing is available in the iPhone build.");
    }
    const pairing = parseMacPairingToken(rawToken);
    await post(pairing, "/api/remote/commands/list", { limit: 1 });
    await SecureStore.setItemAsync(PAIRING_KEY, JSON.stringify(pairing), {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
    return pairing;
  },

  async loadPairing(): Promise<PairedMac | null> {
    if (Platform.OS !== "ios" || !(await SecureStore.isAvailableAsync())) return null;
    const stored = await SecureStore.getItemAsync(PAIRING_KEY);
    if (!stored) return null;
    try {
      const decoded = JSON.parse(stored) as PairedMac;
      if (!UUID_PATTERN.test(decoded.hostId) || !SECRET_PATTERN.test(decoded.secret) || !decoded.displayName) throw new Error();
      return decoded;
    } catch {
      await SecureStore.deleteItemAsync(PAIRING_KEY);
      return null;
    }
  },

  async forget(): Promise<void> {
    if (Platform.OS !== "ios" || !(await SecureStore.isAvailableAsync())) return;
    await SecureStore.deleteItemAsync(PAIRING_KEY);
  },

  async enqueue(pairing: PairedMac, kind: MacCommandKind, instruction?: string): Promise<string> {
    const clientRequestId = `iphone-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const payload = await post<{ commandId: string }>(pairing, "/api/remote/commands/enqueue", {
      clientRequestId,
      kind,
      ...(kind === "agent_task" ? { instruction: instruction?.trim() } : {}),
    });
    return payload.commandId;
  },

  async list(pairing: PairedMac): Promise<MacCommandList> {
    return await post<MacCommandList>(pairing, "/api/remote/commands/list", { limit: 20 });
  },

  async cancel(pairing: PairedMac, commandId: string): Promise<MacCommandState> {
    const payload = await post<{ state: MacCommandState }>(pairing, "/api/remote/commands/cancel", { commandId });
    return payload.state;
  },
};
