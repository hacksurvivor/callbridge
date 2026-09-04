import { useEffect, useState, type FormEvent, type MouseEventHandler } from "react";

import type { InquiryCallContract } from "../../../shared/inquiryContracts.js";
import type { InquiryTaskSnapshot, InquiryTaskStatus } from "../../../shared/inquiryState.js";
import { ApprovalCard, type ApprovalState } from "@/components/assistant-ui/elements/approval-card";
import { CrossIcon, DestinationIcon } from "./Icons.js";

type CallBriefProps = {
  confirmationDisabled?: boolean;
  approvalState?: ApprovalState;
  onConfirm?: MouseEventHandler<HTMLButtonElement>;
  onUpdate: (contract: InquiryCallContract) => Promise<void>;
  snapshot: InquiryTaskSnapshot;
  status?: InquiryTaskStatus;
};

function planStateCopy(status: InquiryTaskStatus): {
  kicker: string;
  title: string;
  footerDetail: (revision: number) => string;
  editable: boolean;
} {
  if (status === "confirmed" || status === "in_progress") {
    return {
      kicker: status === "in_progress" ? "Call in progress" : "Approval recorded",
      title: "Approved call plan",
      footerDetail: (revision) => `Draft v${revision} is locked to one attempt with no automatic retry.`,
      editable: false,
    };
  }
  if (["completed", "partial", "failed", "stopped"].includes(status)) {
    const kicker = status === "completed" ? "Complete" : status === "partial" ? "Partial result" : status === "stopped" ? "Stopped" : "Call ended";
    return {
      kicker,
      title: "Final call plan",
      footerDetail: (revision) => `Draft v${revision} is preserved as the read-only execution record.`,
      editable: false,
    };
  }
  return {
    kicker: "Approval needed",
    title: "Review the call plan",
    footerDetail: () => "Nothing happens until you review and confirm.",
    editable: true,
  };
}

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
  approvalState = "request",
  onConfirm,
  onUpdate,
  snapshot,
  status = snapshot.status,
}: CallBriefProps) {
  const { contract, revision } = snapshot;
  const presentation = planStateCopy(status);
  const controlledDemo = snapshot.recipientKind === "controlled_demo";
  const editable = presentation.editable && !controlledDemo;
  const destinationDetail = controlledDemo
    ? "Private demo line · automated test desk"
    : maskPhoneNumber(contract.destination.e164PhoneNumber);
  const [editing, setEditing] = useState(false);
  const [reviewing, setReviewing] = useState(false);
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
    setReviewing(false);
    setSaving(false);
    setSaveError(null);
  }, [contract, revision]);

  useEffect(() => {
    if (editable) return;
    setEditing(false);
    setReviewing(false);
  }, [editable]);

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
      setSaveError("Concierge could not save these changes. Review the fields and try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <section className={`brief inline-call-plan ${reviewing || editing ? "is-expanded" : ""} ${editing ? "is-editing" : ""}`} aria-label="Exact call plan">
        <div className="call-plan-heading">
          <div><h2>{presentation.editable ? `Ready to call ${contract.destination.displayName}` : `${presentation.title}: ${contract.destination.displayName}`}</h2><p>{contract.questions.length} questions · {languageName(contract.languages.call)} · one call</p></div>
          <span className={`plan-state-label ${presentation.editable ? "is-approval" : ""}`}>{presentation.kicker}</span>
        </div>
        {reviewing && presentation.editable ? (
          <div className="callbridge-approval-wrap" role="region" aria-label="Final confirmation">
            <ApprovalCard
              state={approvalState}
              title={`Place one call to ${contract.destination.displayName}?`}
              subtitle={`Draft v${revision} · ${contract.questions.length} questions · no automatic retry`}
              command={`${destinationDetail} · ${languageName(contract.languages.call)} · information only`}
              denyLabel="Go back"
              allowOnceLabel="Confirm one call"
              onDeny={() => setReviewing(false)}
              {...(!confirmationDisabled && onConfirm ? { onAllowOnce: onConfirm } : {})}
              className="callbridge-approval-card max-w-none"
            />
          </div>
        ) : null}
        {reviewing || editing ? (
          <div className="plan-details">
            <div className="destination-row">
              <span className="hotel-icon"><DestinationIcon /></span>
              <div className="destination-name">
                <strong>{contract.destination.displayName}</strong>
                <span>{destinationDetail} · {languageName(contract.languages.call)}</span>
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
                <div className="assistant-questions" aria-label="Questions Concierge will ask">
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
                    {contract.context.shareableFacts.length > 0 ? <p><strong>May share when useful</strong><span>{contract.context.shareableFacts.map(({ label, value }) => `${label}: ${value}`).join(" · ")}</span></p> : null}
                  </div>
                </div>
              ) : null}
              <div className="brief-row">
                <div className="brief-label">Authority</div>
                <ul className="brief-list authority"><li><CrossIcon />No booking, reservation changes, cancellation, or payment.</li><li><CrossIcon />No fee acceptance, terms, or other commitment.</li></ul>
              </div>
              <div className="brief-row">
                <div className="brief-label">Spending limit</div>
                <div className="rate-summary">
                  {snapshot.pricing.status === "ready" ? <><strong>{formatProviderMoney(snapshot.pricing.quote.pstn.currentPricePerMinute, snapshot.pricing.quote.pstn.currency)} / minute PSTN</strong><span>Estimated PSTN maximum {formatProviderMoney(snapshot.pricing.quote.pstn.estimatedMaximumCharge, snapshot.pricing.quote.pstn.currency)}{snapshot.pricing.quote.quote.accountSpecific ? " · account-specific rate" : " · public retail rate"}</span><small>Excludes Media Streams, OpenAI audio, taxes, and carrier surcharges.</small></> : <strong>Checking the current destination rate…</strong>}
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
                  <div className="editor-actions"><button className="button secondary" type="button" disabled={saving} onClick={() => setEditing(false)}>Cancel</button><button className="button primary" type="submit" disabled={saving || !objective.trim() || !questions.trim()}>{saving ? "Saving…" : "Save changes"}</button></div>
                  {saveError ? <p className="editor-error" role="alert">{saveError}</p> : null}
                </form>
              ) : null}
            </div>
          </div>
        ) : null}
        {!presentation.editable || (!reviewing && !editing) ? (
          <div className="brief-footer">
            {presentation.editable ? <p className="approval-copy">{presentation.footerDetail(revision)}</p> : null}
            <div className="brief-actions">
              {editable ? <button className="button secondary" type="button" onClick={() => { setReviewing(false); setEditing(true); }}>Edit</button> : null}
              <button className={presentation.editable ? "button primary" : "button secondary"} type="button" disabled={presentation.editable && confirmationDisabled} onClick={() => setReviewing((value) => !value)}>{reviewing ? "Close" : presentation.editable ? "Review and confirm" : "View details"}</button>
            </div>
          </div>
        ) : null}
      </section>
    </>
  );
}
