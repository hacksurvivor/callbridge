import type { PublicContactCandidate, SourceProvenance } from "./connectors.js";

type FetchLike = typeof fetch;

type SearchSource = { url: string; title: string };

const CONTACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "value", "sourceUrls"],
        properties: {
          kind: { type: "string", enum: ["phone", "email", "website"] },
          value: { type: "string", minLength: 3, maxLength: 500 },
          sourceUrls: { type: "array", minItems: 1, maxItems: 5, items: { type: "string" } },
        },
      },
    },
  },
} as const;

function responseText(payload: Record<string, unknown>): string {
  const output = Array.isArray(payload.output) ? payload.output : [];
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

function responseSources(payload: Record<string, unknown>): SearchSource[] {
  const result = new Map<string, string>();
  const output = Array.isArray(payload.output) ? payload.output : [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const action = record.action && typeof record.action === "object" ? record.action as Record<string, unknown> : {};
    const sources = Array.isArray(action.sources) ? action.sources : [];
    for (const source of sources) {
      if (!source || typeof source !== "object") continue;
      const sourceRecord = source as Record<string, unknown>;
      const url = typeof sourceRecord.url === "string" ? sourceRecord.url : "";
      const title = typeof sourceRecord.title === "string" ? sourceRecord.title : url;
      if (/^https:\/\//i.test(url)) result.set(url, title);
    }
  }
  return [...result].map(([url, title]) => ({ url, title }));
}

function validValue(kind: PublicContactCandidate["kind"], value: string): boolean {
  if (kind === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (kind === "phone") return /^\+?[0-9][0-9 ()-]{5,30}$/.test(value);
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function parsePublicContactSearchResponse(payload: unknown, retrievedAt: string): PublicContactCandidate[] {
  const root = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
  const text = responseText(root);
  if (!text) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  const candidates = parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).candidates)
    ? (parsed as Record<string, unknown>).candidates as unknown[]
    : [];
  const sources = responseSources(root);
  const sourceMap = new Map(sources.map((source) => [source.url, source.title]));
  return candidates.slice(0, 5).flatMap((candidate): PublicContactCandidate[] => {
    if (!candidate || typeof candidate !== "object") return [];
    const record = candidate as Record<string, unknown>;
    const kind = record.kind;
    const value = typeof record.value === "string" ? record.value.trim() : "";
    if (kind !== "phone" && kind !== "email" && kind !== "website") return [];
    if (!validValue(kind, value)) return [];
    const urls = Array.isArray(record.sourceUrls)
      ? record.sourceUrls.filter((url): url is string => typeof url === "string" && sourceMap.has(url))
      : [];
    const evidence: SourceProvenance[] = [...new Set(urls)].map((sourceUrl) => ({
      sourceUrl,
      retrievedAt,
      label: sourceMap.get(sourceUrl) ?? sourceUrl,
    }));
    if (evidence.length === 0) return [];
    return [{ kind, value, verified: false, evidence }];
  });
}

export async function searchPublicContactsWithOpenAI(input: {
  apiKey: string;
  model: string;
  query: string;
  city?: string;
  country?: string;
  safetyIdentifier: string;
  fetchImpl?: FetchLike;
  now?: string;
}): Promise<PublicContactCandidate[]> {
  if (!input.apiKey.trim()) throw new Error("OpenAI API key is not configured");
  if (!input.model.trim()) throw new Error("Public-contact search model is not configured");
  const query = input.query.trim();
  if (query.length < 3 || query.length > 500) throw new Error("Public-contact search query is invalid");
  const location = [input.city?.trim(), input.country?.trim()].filter(Boolean).join(", ");
  const response = await (input.fetchImpl ?? fetch)("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.apiKey.trim()}`,
      "content-type": "application/json",
      "OpenAI-Safety-Identifier": input.safetyIdentifier,
    },
    body: JSON.stringify({
      model: input.model.trim(),
      reasoning: { effort: "low" },
      tools: [{ type: "web_search", search_context_size: "low" }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      input: [
        "Find public contact details for the exact organization named below.",
        "Prefer its official website and official contact page. Do not infer or invent details.",
        "Return only contacts directly supported by consulted source URLs.",
        `Organization: ${query}`,
        location ? `Location: ${location}` : "",
      ].filter(Boolean).join("\n"),
      text: { format: { type: "json_schema", name: "public_contacts", strict: true, schema: CONTACT_SCHEMA } },
    }),
  });
  if (!response.ok) throw new Error(`OpenAI public-contact search failed with HTTP ${response.status}`);
  return parsePublicContactSearchResponse(await response.json(), input.now ?? new Date().toISOString());
}
