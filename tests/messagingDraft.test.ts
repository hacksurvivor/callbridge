import { describe, expect, it } from "vitest";

import { prepareMessagingDraftWithOpenAI } from "../src/integrations/openAiMessagingDraft.js";

describe("draft-only messaging adapter", () => {
  it("creates a structured draft without a delivery endpoint", async () => {
    let url = "";
    let body = "";
    const fetchImpl: typeof fetch = async (input, request) => {
      url = String(input);
      body = String(request?.body ?? "");
      return new Response(JSON.stringify({ output: [{ content: [{ type: "output_text", text: '{"text":"Could you confirm breakfast hours?"}' }] }] }), { status: 200 });
    };
    await expect(prepareMessagingDraftWithOpenAI({
      apiKey: "key",
      model: "gpt-5.4-mini",
      recipientLabel: "Hotel",
      context: "Ask about breakfast hours",
      fetchImpl,
    })).resolves.toBe("Could you confirm breakfast hours?");
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(body).toContain("Do not claim it was sent");
    expect(body).not.toMatch(/messages\/send|send_message/);
  });
});
