import { useEffect, useState, type FormEvent, type MouseEventHandler } from "react";

import type { InquiryCallContract } from "../../../shared/inquiryContracts.js";
import type { InquiryTaskSnapshot } from "../../../shared/inquiryState.js";
import { CrossIcon, DestinationIcon, LockIcon } from "./Icons.js";

type CallBriefProps = {
  confirmationDisabled?: boolean;
  onConfirm?: MouseEventHandler<HTMLButtonElement>;
  onUpdate: (contract: InquiryCallContract) => Promise<void>;
  snapshot: InquiryTaskSnapshot;
};

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag.split("-")[0] ?? tag) ?? tag;
  } catch {
    return tag;
  }
}

function maskPhoneNumber(value: string): string {
  if (value.length <= 7) return value;
  return `${value.slice(0, Math.min(3, value.length - 4))} ••• ••• ${value.slice(-3)}`;
}

function formatMinorUnits(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(value / 100);
  } catch {
    return `${currency} ${(value / 100).toFixed(2)}`;
  }
}

function formatProviderMoney(value: string, currency: string): string {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return `${currency} ${value}`;
  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 4,
    }).format(amount);
  } catch {
    return `${currency} ${value}`;
  }
}

function parseShareableFacts(value: string): InquiryCallContract["context"]["shareableFacts"] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const separator = line.indexOf(":");
      const label = separator > 0 ? line.slice(0, separator).trim() : `Fact ${index + 1}`;
      const factValue = separator > 0 ? line.slice(separator + 1).trim() : line;
      return { id: `shareable-${index + 1}`, label, value: factValue };
    })
    .filter(({ value: factValue }) => factValue.length > 0);
}

export function CallBrief({
  confirmationDisabled = false,
  onConfirm,
  onUpdate,
  snapshot,
}: CallBriefProps) {
  const { contract, revision } = snapshot;
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [objective, setObjective] = useState(contract.objective);
  const [questions, setQuestions] = useState(contract.questions.map(({ prompt }) => prompt).join("\n"));
  const [privateBackground, setPrivateBackground] = useState(contract.context.privateBackground ?? "");
  const [shareableFacts, setShareableFacts] = useState(
    contract.context.shareableFacts.map(({ label, value }) => `${label}: ${value}`).join("\n"),
  );

  useEffect(() => {
    setObjective(contract.objective);
    setQuestions(contract.questions.map(({ prompt }) => prompt).join("\n"));
    setPrivateBackground(contract.context.privateBackground ?? "");
    setShareableFacts(contract.context.shareableFacts.map(({ label, value }) => `${label}: ${value}`).join("\n"));
    setEditing(false);
    setSaving(false);
    setSaveError(null);
  }, [contract, revision]);

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const questionPrompts = questions.split("\n").map((value) => value.trim()).filter(Boolean);
    if (!objective.trim() || questionPrompts.length === 0) return;
    setSaving(true);
    setSaveError(null);
    try {
      await onUpdate({
        ...contract,
        objective: objective.trim(),
        questions: questionPrompts.map((prompt, index) => ({
          id: contract.questions[index]?.id ?? `question-${index + 1}`,
          prompt,
          required: contract.questions[index]?.required ?? true,
        })),
        context: {
          ...(privateBackground.trim() ? { privateBackground: privateBackground.trim() } : {}),
          shareableFacts: parseShareableFacts(shareableFacts),
        },
      });
    } catch {
      setSaveError("CallBridge could not save these changes. Review the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className="brief" aria-label="Call brief">
        <div className="destination-row">
          <span className="hotel-icon"><DestinationIcon /></span>
          <div className="destination-name">
            <strong>{contract.destination.displayName}</strong>
            <span>{maskPhoneNumber(contract.destination.e164PhoneNumber)} · {languageName(contract.languages.call)}</span>
          </div>
          <span className="verified"><span className="status-dot" />Destination verified</span>
        </div>
        <div className="brief-body">
          <div className="brief-row">
            <div className="brief-label">Objective</div>
            <div className="brief-content">{contract.objective}</div>
          </div>
          <div className="brief-row">
            <div className="brief-label">Questions</div>
            <div className="assistant-questions" aria-label="Questions CallBridge will ask">
              <div className="assistant-question-cue"><span className="assistant-orb">CB</span><span>CallBridge will ask</span></div>
              <ol className="question-list">
                {contract.questions.map((question, index) => (
                  <li key={question.id}><span className="question-number">{index + 1}</span><span>{question.prompt}</span></li>
                ))}
              </ol>
            </div>
          </div>
          {(contract.context.privateBackground || contract.context.shareableFacts.length > 0) ? (
            <div className="brief-row">
              <div className="brief-label">Context</div>
              <div className="context-summary">
                {contract.context.privateBackground ? <p><strong>Private background</strong><span>{contract.context.privateBackground}</span></p> : null}
                {contract.context.shareableFacts.length > 0 ? (
                  <p><strong>May share when useful</strong><span>{contract.context.shareableFacts.map(({ label, value }) => `${label}: ${value}`).join(" · ")}</span></p>
                ) : null}
              </div>
            </div>
          ) : null}
          <div className="brief-row">
            <div className="brief-label">Authority</div>
            <ul className="brief-list authority">
              <li><CrossIcon />No booking, reservation changes, cancellation, or payment.</li>
              <li><CrossIcon />No fee acceptance, terms, or other commitment.</li>
            </ul>
          </div>
          <div className="brief-row">
            <div className="brief-label">Spending limit</div>
            <div className="rate-summary">
              {snapshot.pricing.status === "ready" ? (
                <>
                  <strong>{formatProviderMoney(snapshot.pricing.quote.pstn.currentPricePerMinute, snapshot.pricing.quote.pstn.currency)} / minute PSTN</strong>
                  <span>
                    Estimated PSTN maximum {formatProviderMoney(snapshot.pricing.quote.pstn.estimatedMaximumCharge, snapshot.pricing.quote.pstn.currency)}
                    {snapshot.pricing.quote.quote.accountSpecific ? " · account-specific rate" : " · public retail rate"}
                  </span>
                  <small>Excludes Media Streams, OpenAI audio, taxes, and carrier surcharges.</small>
                </>
              ) : <strong>Checking the current destination rate…</strong>}
              <span>{formatMinorUnits(contract.costCeiling.maxTotalMinorUnits, contract.costCeiling.currency)} platform maximum · one attempt · up to {Math.ceil(contract.policy.maxConnectedSeconds / 60)} connected minutes</span>
              <small>Confirmation requires a fresh quote. Unused reserved credits are released after final cost settlement.</small>
            </div>
          </div>
          <div className="disclosure">“{contract.disclosure.text}”</div>
          {editing ? (
            <form className="brief-editor" onSubmit={(event) => void save(event)}>
              <div className="editor-heading"><strong>Edit this exact draft</strong><span>Saving creates a new revision and resets confirmation.</span></div>
              <label>Objective<textarea value={objective} onChange={(event) => setObjective(event.target.value)} rows={3} /></label>
              <label>Questions to ask<span className="field-hint">One question per line</span><textarea value={questions} onChange={(event) => setQuestions(event.target.value)} rows={5} /></label>
              <label>Private background<span className="field-hint">Used for reasoning; never said aloud</span><textarea value={privateBackground} onChange={(event) => setPrivateBackground(event.target.value)} rows={3} /></label>
              <label>Facts the agent may share<span className="field-hint">One “Label: value” per line</span><textarea value={shareableFacts} onChange={(event) => setShareableFacts(event.target.value)} rows={3} /></label>
              <div className="editor-actions">
                <button className="button secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
                <button className="button primary" type="submit" disabled={saving || !objective.trim() || !questions.trim()}>{saving ? "Saving…" : "Save changes"}</button>
              </div>
              {saveError ? <p className="editor-error" role="alert">{saveError}</p> : null}
            </form>
          ) : null}
        </div>
        <div className="brief-footer">
          <div className="approval-copy"><strong>Only you can place this call</strong><span>Approval applies only to draft v{revision}. Editing the brief resets it.</span></div>
          <div className="brief-actions">
            <button className="button secondary" type="button" aria-expanded={editing} onClick={() => setEditing((value) => !value)}>{editing ? "Close editor" : "Edit brief"}</button>
            <button className="button primary" type="button" disabled={confirmationDisabled || editing} onClick={onConfirm}>Confirm call</button>
          </div>
        </div>
      </section>
      <p className="webpage-only"><LockIcon />Confirmation is a webpage-only action and is not exposed through WebMCP.</p>
    </>
  );
}
