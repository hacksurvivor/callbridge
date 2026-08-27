import type { GetInquiryResultOutput } from "../../../shared/inquiryWebMcp.js";

function formatMinorUnits(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(value / 100);
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}

export function ResultSummary({
  currency,
  questions,
  output,
}: {
  currency: string;
  questions: ReadonlyArray<{ id: string; prompt: string }>;
  output: Extract<GetInquiryResultOutput, { status: "ready" }>;
}) {
  const { result } = output;
  return (
    <section className="result-summary" aria-labelledby="result-title">
      <div className="result-heading">
        <div><span>Call result</span><h2 id="result-title">{result.summary ?? "The call ended without a complete answer."}</h2></div>
        <span className={`result-outcome ${result.outcome}`}>{result.outcome.replace("_", " ")}</span>
      </div>
      <dl className="result-facts">
        {result.answers.map((answer) => (
          <div key={answer.questionId}>
            <dt>{questions.find(({ id }) => id === answer.questionId)?.prompt ?? answer.questionId.replaceAll("-", " ")}</dt>
            <dd>{answer.value ?? (answer.status === "ambiguous" ? "Ambiguous answer" : "Not answered")}</dd>
            {answer.evidence ? <small><span>What was heard</span> “{answer.evidence.sourceExcerpt}”</small> : null}
          </div>
        ))}
      </dl>
      <div className="result-meta">
        <span>{result.durationSeconds}s connected</span>
        <span>{output.costStatus === "provider_reported" ? `${formatMinorUnits(output.actualCostMinorUnits, currency)} provider-reported cost` : "Provider cost pending"}</span>
        <span>Disclosure {result.disclosureStatus.replace("_", " ")}</span>
        <span>{result.commitmentSafety === "none_observed" ? "No commitment detected" : "Possible authority issue"}</span>
        <span>{result.terminalReason.replaceAll("_", " ")}</span>
      </div>
    </section>
  );
}
