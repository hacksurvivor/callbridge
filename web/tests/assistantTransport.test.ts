import { describe, expect, it } from "vitest";

import { handleCallBridgeAssistantTransport } from "../src/assistantTransportServer.js";

function transportRequest(body: unknown, method = "POST"): Request {
  return new Request("http://callbridge.test/api/assistant", {
    method,
    headers: { "Content-Type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

function validBody(text = "Please note that Maya may arrive at 01:30.") {
  return {
    state: { messages: [] },
    commands: [{
      type: "add-message",
      message: { role: "user", parts: [{ type: "text", text }] },
      parentId: null,
      sourceId: null,
    }],
    destination: "Sakura Hotel Kyoto",
    draftRevision: 3,
  };
}

function appendedText(stream: string, partIndex: string): string {
  return stream.split("\n")
    .filter((line) => line.startsWith("data: {") && line.includes('"type":"append-text"'))
    .map((line) => JSON.parse(line.slice(6)) as {
      operations: Array<{ path: string[]; value: string }>;
    })
    .flatMap(({ operations }) => operations)
    .filter(({ path }) => path.at(-2) === partIndex && path.at(-1) === "text")
    .map(({ value }) => value)
    .join("");
}

describe("CallBridge Assistant Transport endpoint", () => {
  it("streams state, reasoning, tool progress, and answer text in incremental chunks", async () => {
    const response = await handleCallBridgeAssistantTransport(transportRequest(validBody()), { tokenDelayMs: 0 });
    const stream = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(stream).toContain('"type":"update-state"');
    expect(stream).toContain('"type":"reasoning"');
    expect(stream).toContain('"toolName":"update_call_draft"');
    expect(stream).toContain('"externalAction":false');
    expect(appendedText(stream, "2")).toContain("Prepared this as private context for Sakura Hotel Kyoto");
    expect(stream).toContain("data: [DONE]");
    expect(stream.match(/"type":"append-text"/gu)?.length).toBeGreaterThan(20);
  });

  it("does not expose confirmation or call execution as transport tools", async () => {
    const response = await handleCallBridgeAssistantTransport(transportRequest(validBody()), { tokenDelayMs: 0 });
    const stream = await response.text();

    expect(stream).not.toContain('"toolName":"confirm_call"');
    expect(stream).not.toContain('"toolName":"place_call"');
    expect(stream).not.toContain('"toolName":"retry_call"');
  });

  it("rejects malformed, empty, and oversized message commands", async () => {
    const malformed = await handleCallBridgeAssistantTransport(transportRequest({ commands: [] }));
    const oversized = await handleCallBridgeAssistantTransport(
      transportRequest(validBody("x".repeat(4_001))),
    );

    expect(malformed.status).toBe(422);
    expect(oversized.status).toBe(422);
  });

  it("rejects non-POST requests", async () => {
    const response = await handleCallBridgeAssistantTransport(transportRequest({}, "GET"));
    expect(response.status).toBe(405);
  });
});
