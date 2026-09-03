import {
  AssistantStream,
  AssistantTransportEncoder,
  createAssistantStream,
  type AssistantStreamController,
  type AssistantTransportStateOperation,
} from "assistant-stream";
import type { ReadonlyJSONValue } from "assistant-stream/utils";

import type { CallBridgeTransportMessage, CallBridgeTransportState } from "./assistantTransport.js";

type AddMessageCommand = {
  type: "add-message";
  message: {
    role: "user" | "assistant";
    parts: Array<{ type: "text"; text: string } | { type: "image"; image: string }>;
  };
};

type TransportRequest = {
  state: CallBridgeTransportState;
  commands: AddMessageCommand[];
  destination?: string;
  draftRevision?: number;
};

type HandlerOptions = {
  tokenDelayMs?: number;
};

const MAX_COMMANDS = 8;
const MAX_MESSAGE_CHARACTERS = 4_000;
const MAX_STATE_MESSAGES = 80;

function jsonResponse(status: number, error: string): Response {
  return Response.json({ error }, { status });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTransportMessage(value: unknown): value is CallBridgeTransportMessage {
  if (!isRecord(value)) return false;
  return typeof value.id === "string"
    && (value.role === "user" || value.role === "assistant")
    && Array.isArray(value.content)
    && typeof value.createdAt === "string";
}

function readTextParts(value: unknown): string {
  if (!isRecord(value) || !Array.isArray(value.parts)) return "";
  return value.parts
    .filter((part): part is { type: "text"; text: string } => (
      isRecord(part) && part.type === "text" && typeof part.text === "string"
    ))
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function parseTransportRequest(value: unknown): TransportRequest | null {
  if (!isRecord(value) || !Array.isArray(value.commands)) return null;
  if (value.commands.length === 0 || value.commands.length > MAX_COMMANDS) return null;

  const commands: AddMessageCommand[] = [];
  for (const command of value.commands) {
    if (!isRecord(command) || command.type !== "add-message" || !isRecord(command.message)) continue;
    const text = readTextParts(command.message);
    if (!text || text.length > MAX_MESSAGE_CHARACTERS) return null;
    commands.push({
      type: "add-message",
      message: { role: command.message.role === "assistant" ? "assistant" : "user", parts: [{ type: "text", text }] },
    });
  }
  if (commands.length === 0) return null;

  const sourceState = isRecord(value.state) && Array.isArray(value.state.messages)
    ? value.state.messages.filter(isTransportMessage).slice(-MAX_STATE_MESSAGES)
    : [];

  return {
    state: { messages: sourceState },
    commands,
    ...(typeof value.destination === "string" ? { destination: value.destination.slice(0, 160) } : {}),
    ...(typeof value.draftRevision === "number" && Number.isInteger(value.draftRevision)
      ? { draftRevision: value.draftRevision }
      : {}),
  };
}

function updateState(controller: AssistantStreamController, operations: AssistantTransportStateOperation[]): void {
  controller.enqueue({ type: "update-state", path: [], operations });
}

function streamingTokens(text: string): string[] {
  return text.match(/[\p{L}\p{N}]+|[^\p{L}\p{N}\s]+|\s+/gu) ?? [text];
}

function pause(milliseconds: number): Promise<void> {
  return milliseconds > 0 ? new Promise((resolve) => setTimeout(resolve, milliseconds)) : Promise.resolve();
}

async function appendTokens(
  controller: AssistantStreamController,
  path: string[],
  text: string,
  tokenDelayMs: number,
): Promise<void> {
  for (const token of streamingTokens(text)) {
    updateState(controller, [{ type: "append-text", path, value: token }]);
    await pause(tokenDelayMs);
  }
}

function userMessage(command: AddMessageCommand, index: number, createdAt: string): CallBridgeTransportMessage {
  return {
    id: `transport:user:${createdAt}:${index}`,
    role: command.message.role,
    content: command.message.parts.map((part) => part.type === "text"
      ? { type: "text" as const, text: part.text }
      : { type: "image" as const, image: part.image }),
    createdAt,
  };
}

function assistantReply(destination: string | undefined): string {
  const target = destination ? ` for ${destination}` : "";
  return `Prepared this as private context${target}. Nothing was shared and no call was placed. The updated call plan is ready for review.`;
}

function streamTransportState(input: TransportRequest, tokenDelayMs: number): Response {
  const createdAt = new Date().toISOString();
  const messages = [
    ...input.state.messages,
    ...input.commands.map((command, index) => userMessage(command, index, createdAt)),
  ].slice(-MAX_STATE_MESSAGES);
  const assistantIndex = messages.length;
  const assistantMessage: CallBridgeTransportMessage = {
    id: `transport:assistant:${createdAt}`,
    role: "assistant",
    createdAt,
    status: { type: "running" },
    content: [{ type: "reasoning", text: "", status: { type: "running" } }],
  };

  const stream = createAssistantStream(async (controller) => {
    updateState(controller, [{ type: "set", path: [], value: { messages } as ReadonlyJSONValue }]);
    updateState(controller, [{ type: "set", path: ["messages", String(assistantIndex)], value: assistantMessage as ReadonlyJSONValue }]);

    await appendTokens(
      controller,
      ["messages", String(assistantIndex), "content", "0", "text"],
      "Checked the request against the current draft and kept it inside the private revision path.",
      tokenDelayMs,
    );
    updateState(controller, [{
      type: "set",
      path: ["messages", String(assistantIndex), "content", "0", "status"],
      value: { type: "complete" },
    }]);

    const toolCall = {
      type: "tool-call" as const,
      toolCallId: `update-call-draft-${createdAt}`,
      toolName: "update_call_draft",
      args: {
        field: "privateBackground",
        ...(input.draftRevision !== undefined ? { expectedRevision: input.draftRevision } : {}),
      },
    };
    updateState(controller, [{
      type: "set",
      path: ["messages", String(assistantIndex), "content", "1"],
      value: toolCall,
    }]);
    await pause(tokenDelayMs * 2);
    updateState(controller, [{
      type: "set",
      path: ["messages", String(assistantIndex), "content", "1", "result"],
      value: { status: "prepared", visibility: "private", externalAction: false },
    }]);

    updateState(controller, [{
      type: "set",
      path: ["messages", String(assistantIndex), "content", "2"],
      value: { type: "text", text: "", status: { type: "running" } },
    }]);
    await appendTokens(
      controller,
      ["messages", String(assistantIndex), "content", "2", "text"],
      assistantReply(input.destination),
      tokenDelayMs,
    );
    updateState(controller, [
      {
        type: "set",
        path: ["messages", String(assistantIndex), "content", "2", "status"],
        value: { type: "complete" },
      },
      {
        type: "set",
        path: ["messages", String(assistantIndex), "status"],
        value: { type: "complete", reason: "stop" },
      },
    ]);
  });

  return AssistantStream.toResponse(stream, new AssistantTransportEncoder());
}

export async function handleCallBridgeAssistantTransport(
  request: Request,
  options: HandlerOptions = {},
): Promise<Response> {
  if (request.method !== "POST") return jsonResponse(405, "Method not allowed");
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, "Request body must be valid JSON");
  }
  const input = parseTransportRequest(body);
  if (!input) return jsonResponse(422, "A valid add-message command is required");
  return streamTransportState(input, options.tokenDelayMs ?? 14);
}
