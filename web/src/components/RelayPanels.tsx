import type { InquiryActivityEvent } from "../../../shared/inquiryWebMcp.js";
import type { InquiryTaskSnapshot, InquiryTaskStatus } from "../../../shared/inquiryState.js";
import { activityEventCopy, fallbackActivityEvents } from "./ActivityRail.js";
import { ActivityIcon, CheckIcon, CloseIcon, GalleryIcon, LockIcon, ShieldIcon, StopIcon, ToolIcon } from "./Icons.js";
import type { TaskMedia } from "./RelaySidebar.js";

export type ContextPanelMode = "activity" | "gallery";

function eventTime(value: string): string {
  return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function InThreadTimeline({
  events,
  snapshot,
  onOpenActivity,
}: {
  events: readonly InquiryActivityEvent[];
  snapshot: InquiryTaskSnapshot;
  onOpenActivity: () => void;
}) {
  const hasResearch = events.length > 1 || snapshot.pricing.status === "ready";
  const approved = snapshot.confirmation.state === "confirmed";
  const terminal = ["completed", "partial", "failed", "stopped"].includes(snapshot.status);
  return (
    <section className="thread-timeline" aria-label="Task progress">
      <ol>
        <li className="is-complete"><span><CheckIcon /></span><strong>Request</strong></li>
        <li className={hasResearch ? "is-complete" : "is-current"}><span>{hasResearch ? <CheckIcon /> : null}</span><strong>Prepared</strong></li>
        <li className={approved ? "is-complete" : "is-current is-approval"}><span>{approved ? <CheckIcon /> : null}</span><strong>Approval</strong></li>
        <li className={terminal ? "is-complete" : ""}><span>{terminal ? <CheckIcon /> : null}</span><strong>Result</strong></li>
      </ol>
      <button className="timeline-action" type="button" onClick={onOpenActivity}><ActivityIcon />View activity</button>
    </section>
  );
}

function ActivityContent({
  events,
  snapshot,
  status,
}: {
  events: readonly InquiryActivityEvent[];
  snapshot: InquiryTaskSnapshot;
  status: InquiryTaskStatus;
}) {
  const visibleEvents = events.length ? events : fallbackActivityEvents(snapshot);
  const terminal = ["completed", "partial", "failed", "stopped"].includes(status);
  return (
    <>
      <section className="context-section">
        <h3>Task activity</h3>
        <ol className="activity-sheet-list">
          {visibleEvents.map((event) => {
            const copy = activityEventCopy(event, snapshot);
            return (
              <li key={event.eventId}>
                <span className="activity-sheet-node"><CheckIcon /></span>
                <div><strong>{copy.title}</strong><p>{copy.detail}</p><time dateTime={event.occurredAt}>{eventTime(event.occurredAt)}</time></div>
              </li>
            );
          })}
          {!terminal ? <li className="is-pending"><span className="activity-sheet-node" /><div><strong>Call and report back</strong><p>Waiting for the approved task.</p></div></li> : null}
        </ol>
      </section>

      <section className="context-section">
        <div className="context-heading"><ToolIcon /><h3>Tools</h3></div>
        <div className="tool-session-row">
          <span className="tool-state complete"><CheckIcon /></span>
          <div><strong>Read call draft</strong><small>Loaded the current server-owned revision.</small></div>
          <span>Done</span>
        </div>
        <div className="tool-session-row">
          <span className={`tool-state ${snapshot.pricing.status === "ready" ? "complete" : "running"}`}>{snapshot.pricing.status === "ready" ? <CheckIcon /> : <span className="stream-pulse" />}</span>
          <div><strong>Prepare confirmation</strong><small>Checked the destination, quote, and revision.</small></div>
          <span>{snapshot.pricing.status === "ready" ? "Done" : "Running"}</span>
        </div>
        <div className="tool-session-row">
          <span className="tool-state waiting"><LockIcon /></span>
          <div><strong>Human confirmation</strong><small>This protected action is not available to tools.</small></div>
          <span>{snapshot.confirmation.state === "confirmed" ? "Confirmed" : "Waiting"}</span>
        </div>
      </section>

      <section className="context-section share-boundary">
        <div className="context-heading"><ShieldIcon /><h3>What may be shared</h3></div>
        {snapshot.contract.context.shareableFacts.length ? <dl>{snapshot.contract.context.shareableFacts.map((fact) => <div key={fact.id}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl> : <p>No task facts are approved for sharing yet.</p>}
        <small>Private background and internal reasoning are never said aloud.</small>
      </section>

      <div className="context-panel-footer"><button className="stop-task-button" type="button" disabled={!terminal} title={terminal ? "This task has ended" : "No call is currently running"}><StopIcon />{terminal ? "Task ended" : "No call running"}</button></div>
    </>
  );
}

function GalleryContent({ media }: { media: readonly TaskMedia[] }) {
  return (
    <section className="context-section context-gallery">
      <h3>Files & images</h3>
      <p>Everything CallBridge used for this task. Open an item without leaving the conversation.</p>
      {media.length ? (
        <div className="gallery-grid">
          {media.map((item) => <figure key={item.artifactId}><img src={item.src} alt={item.alt} /><figcaption>{item.caption}</figcaption></figure>)}
        </div>
      ) : <p className="gallery-empty">No display-approved pictures or evidence are attached yet.</p>}
    </section>
  );
}

export function ContextPanel({
  events,
  media,
  mode,
  onChangeMode,
  onClose,
  open,
  snapshot,
  status,
}: {
  events: readonly InquiryActivityEvent[];
  media: readonly TaskMedia[];
  mode: ContextPanelMode;
  onChangeMode: (mode: ContextPanelMode) => void;
  onClose: () => void;
  open: boolean;
  snapshot: InquiryTaskSnapshot;
  status: InquiryTaskStatus;
}) {
  if (!open) return null;
  return (
    <>
      <button className="context-scrim mobile-only" aria-label="Close context panel" onClick={onClose} type="button" />
      <aside className="context-panel" aria-label="Task context">
        <div className="context-tabs">
          <button className={mode === "activity" ? "is-active" : ""} type="button" onClick={() => onChangeMode("activity")}><ActivityIcon />Activity</button>
          <button className={mode === "gallery" ? "is-active" : ""} type="button" onClick={() => onChangeMode("gallery")}><GalleryIcon />Images{media.length ? <small>{media.length}</small> : null}</button>
          <button className="icon-button context-close" type="button" onClick={onClose} aria-label="Close context panel"><CloseIcon /></button>
        </div>
        <div className="context-scroll">{mode === "activity" ? <ActivityContent events={events} snapshot={snapshot} status={status} /> : <GalleryContent media={media} />}</div>
      </aside>
    </>
  );
}
