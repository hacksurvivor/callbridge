import { useEffect, useState } from "react";
import { Sources } from "@/components/assistant-ui/elements/sources.aui";
import { Timeline, type TimelineEvent } from "@/components/assistant-ui/elements/timeline";

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
  const completed = [true, hasResearch, approved, terminal].filter(Boolean).length;
  const label = terminal
    ? snapshot.status === "completed" ? "Call complete" : snapshot.status === "partial" ? "Partial result" : "Call ended"
    : snapshot.status === "in_progress" ? "Call in progress"
      : approved ? "Call approved"
        : "Plan ready";
  return (
    <button className="compact-task-progress" type="button" onClick={onOpenActivity} aria-label={`${label}. Open task activity`}>
      <span className="compact-task-state">{terminal ? <CheckIcon /> : <span className="stream-pulse" />}</span>
      <span className="compact-task-copy"><strong>{label}</strong><small>{completed} of 4 steps</small></span>
      <span className="compact-task-action">View</span>
    </button>
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
  const timelineEvents: TimelineEvent[] = visibleEvents.map((event, index) => {
    const copy = activityEventCopy(event, snapshot);
    return {
      id: event.eventId,
      when: terminal || index < visibleEvents.length - 1 ? "past" : "now",
      time: eventTime(event.occurredAt),
      title: copy.title,
      detail: copy.detail,
    };
  });
  if (!terminal) timelineEvents.push({
    id: "pending-call-result",
    when: "future",
    time: "Next",
    title: "Call and report back",
    detail: "Waiting for the approved task.",
  });
  return (
    <>
      <section className="context-section">
        <h3>Task activity</h3>
        <Timeline events={timelineEvents} visibleCount={timelineEvents.length} className="mt-5 max-w-none border-0 p-0" />
        {snapshot.contract.destination.website ? <div className="activity-source"><span>Source</span><Sources type="source" sourceType="url" id="destination-source" url={snapshot.contract.destination.website} title={snapshot.contract.destination.displayName} status={{ type: "complete" }} /></div> : null}
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

      <div className="context-panel-footer"><button className="stop-task-button" type="button" disabled title={terminal ? "This task has ended" : status === "confirmed" ? "The approved call is queued" : status === "in_progress" ? "The call is in progress" : "No call is currently running"}><StopIcon />{terminal ? "Task ended" : status === "confirmed" ? "Call queued" : status === "in_progress" ? "Call in progress" : "No call running"}</button></div>
    </>
  );
}

function GalleryContent({ media }: { media: readonly TaskMedia[] }) {
  const [selected, setSelected] = useState<TaskMedia | null>(null);
  useEffect(() => {
    if (!selected) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setSelected(null); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [selected]);
  return (
    <>
      <section className="context-section context-gallery">
        <h3>Files & images</h3>
        <p>Images CallBridge can display for this task.</p>
        {media.length ? (
          <div className="gallery-grid">
            {media.map((item) => (
              <button key={item.artifactId} className="gallery-item" type="button" onClick={() => setSelected(item)}>
                <img src={item.src} alt="" />
                <span>{item.caption}</span>
              </button>
            ))}
          </div>
        ) : <p className="gallery-empty">No display-approved pictures or evidence are attached yet.</p>}
      </section>
      {selected ? (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={selected.caption} onClick={() => setSelected(null)}>
          <button className="image-lightbox-close" type="button" aria-label="Close image" onClick={() => setSelected(null)}><CloseIcon /></button>
          <figure onClick={(event) => event.stopPropagation()}>
            <img src={selected.src} alt={selected.alt} />
            <figcaption>{selected.caption}</figcaption>
          </figure>
        </div>
      ) : null}
    </>
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
