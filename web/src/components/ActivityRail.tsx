import type { InquiryActivityEvent } from "../../../shared/inquiryWebMcp.js";
import type { InquiryTaskSnapshot, InquiryTaskStatus } from "../../../shared/inquiryState.js";
import { CheckIcon, ShieldIcon } from "./Icons.js";

export function activityEventCopy(event: InquiryActivityEvent, snapshot: InquiryTaskSnapshot): { title: string; detail: string } {
  const destination = snapshot.contract.destination.displayName;
  const question = event.questionId
    ? snapshot.contract.questions.find(({ id }) => id === event.questionId)?.prompt
    : undefined;
  const copy: Record<InquiryActivityEvent["type"], { title: string; detail: string }> = {
    draft_created: { title: "Created a call draft", detail: `ChatGPT added ${destination}, its destination number, and the call language.` },
    draft_updated: { title: "Updated the call brief", detail: `Draft v${event.revision} contains the latest objective, questions, and context.` },
    confirmation_ready: { title: "Verified the current revision", detail: `Draft v${event.revision} is ready for human review.` },
    confirmation_revoked: { title: "Reset confirmation", detail: "A material edit changed the exact execution revision." },
    confirmed: { title: "Human confirmation recorded", detail: `Draft v${event.revision} was confirmed in the webpage. ChatGPT did not perform this action.` },
    credit_reserved: { title: "Reserved the spending limit", detail: "Concierge reserved platform credits for this single attempt." },
    attempt_queued: { title: "Queued one call attempt", detail: "Automatic retry remains disabled." },
    dispatch_uncertain: { title: "Call creation needs verification", detail: "The provider outcome is uncertain. Concierge will not dial again." },
    dispatch_failed: { title: "Call was not created", detail: "The provider confirmed that no call exists, and no retry was scheduled." },
    dispatch_reconciled: { title: "Verified the provider outcome", detail: "Concierge reconciled the uncertain request before changing call state." },
    dialing: { title: "Dialing", detail: `Concierge is dialing ${destination}.` },
    connected: { title: "Call connected", detail: "The destination answered and the approved disclosure is due first." },
    disclosure_delivered: { title: "AI disclosure delivered", detail: "The disclosure completed before Concierge continued the inquiry." },
    question_started: { title: "Asked an approved question", detail: question ?? "The agent is gathering only the facts in this brief." },
    answer_observed: { title: "Observed an answer", detail: question ? `Evidence captured for “${question}”` : "A bounded evidence item is available for result projection." },
    clarification_required: { title: "Clarifying an answer", detail: "The response was ambiguous, so the agent asked a bounded follow-up." },
    recipient_declined: { title: "Recipient declined", detail: "The agent is ending without making any commitment." },
    end_requested: { title: "End requested", detail: "Concierge asked the worker to end the current attempt." },
    call_ended: { title: "Call ended", detail: "The single attempt reached a terminal state." },
    result_ready: { title: "Result ready", detail: "The evidence-bound result is ready for review." },
  };
  return copy[event.type];
}

export function fallbackActivityEvents(snapshot: InquiryTaskSnapshot): InquiryActivityEvent[] {
  return [
    {
      eventId: "fallback:draft-created",
      sequence: 1,
      type: "draft_created",
      source: "callbridge_server",
      revision: 1,
      executionRevision: snapshot.executionRevision,
      occurredAt: snapshot.createdAt,
    },
    {
      eventId: "fallback:confirmation-ready",
      sequence: 2,
      type: snapshot.status === "draft" ? "draft_updated" : "confirmation_ready",
      source: "callbridge_server",
      revision: snapshot.revision,
      executionRevision: snapshot.executionRevision,
      occurredAt: snapshot.updatedAt,
    },
  ];
}

export function ActivityRail({
  events,
  snapshot,
  status,
}: {
  events: readonly InquiryActivityEvent[];
  snapshot: InquiryTaskSnapshot;
  status: InquiryTaskStatus;
}) {
  const visibleEvents = events.length > 0 ? events : fallbackActivityEvents(snapshot);
  return (
    <aside className="activity-rail" aria-labelledby="activity-title">
      <div className="activity-heading">
        <h2 id="activity-title">Activity</h2>
        <span>{visibleEvents.length} {visibleEvents.length === 1 ? "update" : "updates"}</span>
      </div>
      <ol className="activity-list">
        {visibleEvents.map((event) => {
          const item = activityEventCopy(event, snapshot);
          return (
            <li key={event.eventId}>
              <CheckIcon className="activity-check" />
              <div><h3>{item.title}</h3><p>{item.detail}</p></div>
            </li>
          );
        })}
      </ol>
      <div className="human-control">
        <div className="human-control-title"><ShieldIcon /> <strong>Human control</strong></div>
        <p>ChatGPT may prepare, revise, and inspect this task. It cannot confirm or initiate the call.</p>
      </div>
      <p className="activity-footnote">
        {status === "completed" || status === "partial" || status === "failed" || status === "stopped"
          ? "The factual result remains separate from hidden reasoning, raw transcripts, and provider payloads."
          : "After confirmation, this panel shows factual call progress and the translated result."}
      </p>
    </aside>
  );
}
