export type ProactiveFinding = {
  summary: string;
  source: string;
  expiresAt?: string;
};

export function validateProactiveFinding(finding: ProactiveFinding): ProactiveFinding {
  if (!finding.summary.trim() || !finding.source.trim()) {
    throw new Error("A proactive finding needs a summary and source");
  }
  if (finding.expiresAt && Number.isNaN(new Date(finding.expiresAt).getTime())) {
    throw new Error("Finding expiry must be a valid instant");
  }
  return finding;
}

export function canActOnFinding(state: "proposed" | "approved" | "dismissed" | "expired"): boolean {
  return state === "approved";
}
