type TransportPartStatus = { type: "running" } | { type: "complete" };

export type CallBridgeTransportPart =
  | { type: "text"; text: string; status?: TransportPartStatus }
  | { type: "reasoning"; text: string; status?: TransportPartStatus }
  | { type: "image"; image: string }
  | { type: "source"; sourceType: "url"; id: string; url: string; title?: string; status: { type: "complete" } }
  | {
      type: "tool-call";
      toolCallId: string;
      toolName: string;
      args: Record<string, string | number | boolean>;
      result?: Record<string, string | number | boolean>;
    };

export type CallBridgeTransportMessage = {
  id: string;
  role: "user" | "assistant";
  content: CallBridgeTransportPart[];
  createdAt: string;
  status?: { type: "running" } | { type: "complete"; reason: "stop" } | { type: "incomplete"; reason: "error" };
};

export type CallBridgeTransportState = {
  messages: CallBridgeTransportMessage[];
  lastError?: string;
};

export const CALLBRIDGE_ASSISTANT_API = "/api/assistant";
