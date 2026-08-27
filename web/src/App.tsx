import type { MouseEvent } from "react";

import type { InquiryCallContract } from "../../shared/inquiryContracts.js";
import type {
  GetInquiryResultOutput,
  InquiryActivityEvent,
} from "../../shared/inquiryWebMcp.js";
import type { InquiryTaskSnapshot, InquiryTaskStatus } from "../../shared/inquiryState.js";
import { ActivityRail } from "./components/ActivityRail.js";
import { CallBrief } from "./components/CallBrief.js";
import { Header } from "./components/Header.js";
import { ResultSummary } from "./components/ResultSummary.js";

export type ConfirmationUiState =
  | { state: "idle" }
  | { state: "pending"; message: string }
  | { state: "confirmed"; message: string }
  | { state: "error"; message: string };

export type AppProps = {
  activity?: readonly InquiryActivityEvent[];
  confirmation: ConfirmationUiState;
  confirmationReady?: boolean;
  draft: InquiryTaskSnapshot;
  onConfirm: (event: MouseEvent<HTMLButtonElement>) => void;
  onUpdate: (contract: InquiryCallContract) => Promise<void>;
  result?: GetInquiryResultOutput;
  simulation?: boolean;
  status?: InquiryTaskStatus;
  visualFixture?: boolean;
};

function categoryLabel(category: string): string {
  return category.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function languageName(tag: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(tag.split("-")[0] ?? tag) ?? tag;
  } catch {
    return tag;
  }
}

export default function App({
  activity = [],
  confirmation,
  confirmationReady = true,
  draft,
  onConfirm,
  onUpdate,
  result = { status: "not_ready" },
  simulation = false,
  status = draft.status,
  visualFixture = false,
}: AppProps) {
  const confirmationDisabled = !confirmationReady
    || confirmation.state === "pending"
    || confirmation.state === "confirmed"
    || status !== "draft" && status !== "awaiting_confirmation";
  const category = categoryLabel(draft.contract.category);
  const callLanguage = languageName(draft.contract.languages.call);

  return (
    <div className="app-shell">
      {simulation && !visualFixture ? <div className="simulation-banner">Simulation · no phone call can be placed</div> : null}
      <Header />
      <div className="workspace">
        <main className="review-main">
          <div className="review-column">
            <nav className="breadcrumb" aria-label="Breadcrumb"><span>Calls</span><span>/</span><strong>Review</strong></nav>
            <div className="title-line"><h1>{category} inquiry for {draft.contract.destination.displayName}</h1><span className="draft-version">Draft v{draft.revision}</span></div>
            <p className="intro">ChatGPT prepared an information-only call in {callLanguage}. Review the destination, questions, context, authority, and spending limit before it is placed.</p>
            <CallBrief
              confirmationDisabled={confirmationDisabled}
              onConfirm={onConfirm}
              onUpdate={onUpdate}
              snapshot={draft}
            />
            {confirmation.state !== "idle" ? (
              <p className={`confirmation-message ${confirmation.state}`} role="status">{confirmation.message}</p>
            ) : null}
            {result.status === "processing" ? (
              <section className="result-state" role="status"><span>Preparing result</span><strong>Checking the accepted call evidence…</strong></section>
            ) : null}
            {result.status === "failed" ? (
              <section className="result-state error" role="alert"><span>Result unavailable</span><strong>The call evidence could not be projected safely.</strong><small>No answer was invented and automatic retry is disabled.</small></section>
            ) : null}
            {result.status === "ready" ? <ResultSummary currency={draft.contract.costCeiling.currency} questions={draft.contract.questions} output={result} /> : null}
          </div>
        </main>
        <ActivityRail events={activity} snapshot={draft} status={status} />
      </div>
    </div>
  );
}
