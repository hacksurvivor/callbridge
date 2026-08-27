type FetchLike = typeof fetch;

const DRAFT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["text"],
  properties: { text: { type: "string", minLength: 1, maxLength: 4000 } },
} as const;

function outputText(payload: unknown): string {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const output = Array.isArray(root.output) ? root.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const content = Array.isArray((item as Record<string, unknown>).content)
      ? (item as Record<string, unknown>).content as unknown[]
      : [];
    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const text = (block as Record<string, unknown>).text;
      if (typeof text === "string" && text.trim()) return text;
    }
  }
  return "";
}

export async function prepareMessagingDraftWithOpenAI(input: {
  apiKey: string;
  model: string;
  recipientLabel: string;
  context: string;
  fetchImpl?: FetchLike;
}): Promise<string> {
  const recipientLabel = input.recipientLabel.trim();
  const context = input.context.trim();
  if (!recipientLabel || recipientLabel.length > 200) throw new Error("Recipient label is invalid");
  if (!context || context.length > 12_000) throw new Error("Draft context is invalid");
  if (!input.apiKey.trim() || !input.model.trim()) throw new Error("Messaging draft model is not configured");
  const response = await (input.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${input.apiKey.trim()}`, "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model.trim(),
      input: [
        { role: "system", content: [{ type: "input_text", text: "Prepare a concise, factual message draft. Do not claim it was sent. Do not accept terms, commit money, make a reservation, cancel, or promise any irreversible action. If the context asks for those actions, phrase them as a question or request for information." }] },
        { role: "user", content: [{ type: "input_text", text: `Recipient: ${recipientLabel}\nContext: ${context}` }] },
      ],
      text: { format: { type: "json_schema", name: "message_draft", strict: true, schema: DRAFT_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI messaging draft failed with HTTP ${response.status}`);
  const text = outputText(await response.json());
  if (!text) throw new Error("OpenAI did not return a messaging draft");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const draft = typeof parsed.text === "string" ? parsed.text.trim() : "";
  if (!draft || draft.length > 4000) throw new Error("OpenAI returned an invalid messaging draft");
  return draft;
}
