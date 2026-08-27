import { describe, expect, it } from "vitest";

import { parsePublicContactSearchResponse, searchPublicContactsWithOpenAI } from "../src/integrations/openAiPublicContactSearch.js";

const payload = {
  output: [
    { type: "web_search_call", action: { sources: [{ url: "https://hotel.example/contact", title: "Hotel contact" }] } },
    { type: "message", content: [{ type: "output_text", text: JSON.stringify({ candidates: [
      { kind: "phone", value: "+66 2 123 4567", sourceUrls: ["https://hotel.example/contact"] },
      { kind: "email", value: "invented@example.com", sourceUrls: ["https://not-consulted.example"] },
    ] }) }] },
  ],
};

describe("public contact web search", () => {
  it("keeps only validated contacts backed by consulted sources", () => {
    expect(parsePublicContactSearchResponse(payload, "2026-08-13T00:00:00.000Z")).toEqual([{
      kind: "phone",
      value: "+66 2 123 4567",
      verified: false,
      evidence: [{
        sourceUrl: "https://hotel.example/contact",
        retrievedAt: "2026-08-13T00:00:00.000Z",
        label: "Hotel contact",
      }],
    }]);
  });

  it("uses Responses web_search and source inclusion", async () => {
    let body = "";
    const fetchImpl: typeof fetch = async (_url, request) => {
      body = String(request?.body ?? "");
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    };
    const result = await searchPublicContactsWithOpenAI({
      apiKey: "key",
      model: "gpt-5.4-mini",
      query: "Example Hotel",
      city: "Bangkok",
      safetyIdentifier: "user-1",
      fetchImpl,
      now: "2026-08-13T00:00:00.000Z",
    });
    expect(body).toContain('"type":"web_search"');
    expect(body).toContain('"web_search_call.action.sources"');
    expect(result).toHaveLength(1);
  });
});
