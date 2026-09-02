import { useEffect, useRef, useState, type FormEvent } from "react";

import type {
  ArtifactPayload,
  AuthRequiredArtifactPayload,
  ConversationArtifactPayload,
  EvidenceArtifactPayload,
  TaskArtifact,
  UserQuestionArtifactPayload,
} from "../../../shared/taskArtifacts.js";

export type ArtifactRegistryProps = {
  artifacts: readonly TaskArtifact[];
  onAuthorize?: (artifact: TaskArtifact<AuthRequiredArtifactPayload>) => Promise<void> | void;
  onAnswer?: (artifact: TaskArtifact<UserQuestionArtifactPayload>, value: string | string[]) => Promise<void> | void;
};

type TypedArtifact<K extends ArtifactPayload["type"]> = TaskArtifact<Extract<ArtifactPayload, { type: K }>>;

function ArtifactFrame({ artifact, children }: { artifact: TaskArtifact; children: React.ReactNode }) {
  return (
    <article className={`artifact-card artifact-${artifact.type} artifact-${artifact.status}`} data-artifact-id={artifact.artifactId}>
      <div className="artifact-meta">
        <span>{artifact.type.replaceAll("_", " ")}</span>
        <span>{artifact.payload.simulated ? "Controlled fixture" : artifact.source.replaceAll("_", " ")}</span>
      </div>
      {children}
    </article>
  );
}

function ConversationArtifactView({ artifact }: { artifact: TypedArtifact<"conversation"> }) {
  const payload: ConversationArtifactPayload = artifact.payload;
  return (
    <ArtifactFrame artifact={artifact}>
      <div className="artifact-heading">
        <div><span className="artifact-eyebrow">{payload.channel.replaceAll("_", " ")}</span><h2>{payload.title}</h2></div>
        <span className="artifact-status">{artifact.status}</span>
      </div>
      <div className="conversation-messages" aria-label={payload.title}>
        {payload.hasEarlierMessages ? <p className="earlier-messages">Earlier messages are retained in the task history.</p> : null}
        {payload.latestMessages.length ? payload.latestMessages.map((message) => (
          <div className={`conversation-message message-${message.authorRole}`} key={message.messageId}>
            <div><strong>{message.authorDisplayName}</strong><span>{message.state}</span></div>
            <p>{message.text}</p>
          </div>
        )) : <p className="artifact-empty">No messages yet. This container does not imply that a channel message was sent.</p>}
      </div>
    </ArtifactFrame>
  );
}

function AuthRequiredArtifactView({
  artifact,
  onAuthorize,
}: {
  artifact: TypedArtifact<"auth_required">;
  onAuthorize?: ArtifactRegistryProps["onAuthorize"];
}) {
  const [pending, setPending] = useState(false);
  const payload = artifact.payload;
  const canContinue = artifact.status === "active" && payload.state !== "authorized" && Boolean(onAuthorize);
  return (
    <ArtifactFrame artifact={artifact}>
      <div className="artifact-heading">
        <div><span className="artifact-eyebrow">Secure handoff</span><h2>Continue with {payload.providerName}</h2></div>
        <span className="artifact-status">{payload.state.replaceAll("_", " ")}</span>
      </div>
      <p className="artifact-copy">{payload.reason}</p>
      <p className="artifact-security-note">Credentials, one-time codes, cookies, and provider tokens never enter this task artifact.</p>
      {canContinue ? (
        <button
          className="button secondary artifact-action"
          disabled={pending}
          onClick={() => {
            setPending(true);
            void Promise.resolve(onAuthorize?.(artifact)).finally(() => setPending(false));
          }}
          type="button"
        >
          {pending ? "Finishing secure handoff…" : payload.simulated ? "Continue controlled fixture" : "Open secure sign-in"}
        </button>
      ) : null}
    </ArtifactFrame>
  );
}

function UserQuestionArtifactView({
  artifact,
  onAnswer,
}: {
  artifact: TypedArtifact<"user_question">;
  onAnswer?: ArtifactRegistryProps["onAnswer"];
}) {
  const payload = artifact.payload;
  const [text, setText] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const focusRef = useRef<HTMLInputElement | HTMLButtonElement>(null);
  const unresolved = artifact.status === "active" && !payload.response;
  const responseDisplay = payload.response
    ? (Array.isArray(payload.response.value) ? payload.response.value : [payload.response.value])
      .map((value) => payload.options?.find((option) => option.id === value)?.label ?? value)
      .join(", ")
    : null;
  useEffect(() => {
    if (unresolved) focusRef.current?.focus({ preventScroll: true });
  }, [artifact.artifactId, unresolved]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!onAnswer || !unresolved) return;
    const value = payload.responseMode === "text" ? text.trim() : selected;
    if (typeof value === "string" ? !value : !value.length) return;
    setPending(true);
    void Promise.resolve(onAnswer(artifact, value)).finally(() => setPending(false));
  };

  return (
    <ArtifactFrame artifact={artifact}>
      <div className="artifact-heading">
        <div><span className="artifact-eyebrow">Needs your answer</span><h2>{payload.prompt}</h2></div>
        <span className="artifact-status">{artifact.status}</span>
      </div>
      {payload.response ? (
        <div className="artifact-response"><span>Your response</span><strong>{responseDisplay}</strong></div>
      ) : (
        <form className="question-form" onSubmit={submit}>
          {payload.responseMode === "text" ? (
            <input ref={focusRef as React.RefObject<HTMLInputElement>} maxLength={4_000} onChange={(event) => setText(event.target.value)} placeholder="Add the missing context" value={text} />
          ) : (
            <div className="question-options">
              {payload.options?.map((option, index) => {
                const checked = selected.includes(option.id);
                return (
                  <label key={option.id}>
                    <input
                      checked={checked}
                      onChange={() => setSelected((current) => payload.responseMode === "single_choice"
                        ? [option.id]
                        : checked ? current.filter((id) => id !== option.id) : [...current, option.id])}
                      ref={index === 0 ? focusRef as React.RefObject<HTMLInputElement> : undefined}
                      type={payload.responseMode === "single_choice" ? "radio" : "checkbox"}
                    />
                    <span>{option.label}</span>
                  </label>
                );
              })}
            </div>
          )}
          <button className="button primary artifact-action" disabled={pending || !onAnswer} type="submit">{pending ? "Saving…" : "Submit answer"}</button>
        </form>
      )}
    </ArtifactFrame>
  );
}

const evidenceAssets: Record<string, { src: string; alt: string }> = {
  "fixture:evidence:late-arrival-policy": {
    src: "/artifacts/late-arrival-policy.svg",
    alt: "Controlled provider late-arrival policy fixture",
  },
};

function EvidenceArtifactView({ artifact }: { artifact: TypedArtifact<"evidence"> }) {
  const payload: EvidenceArtifactPayload = artifact.payload;
  const asset = evidenceAssets[payload.assetRef];
  const renderable = asset && payload.redactionState !== "blocked";
  return (
    <ArtifactFrame artifact={artifact}>
      <div className="artifact-heading">
        <div><span className="artifact-eyebrow">Approved {payload.kind}</span><h2>{payload.caption}</h2></div>
        <span className="artifact-status">{payload.redactionState.replaceAll("_", " ")}</span>
      </div>
      {renderable ? <img className="evidence-preview" src={asset.src} alt={asset.alt} /> : (
        <div className="artifact-unsupported" role="status">This evidence reference is not approved for display.</div>
      )}
      <p className="artifact-security-note">Provenance: {payload.provenance.replaceAll("_", " ")} · Captured {new Date(payload.capturedAt).toLocaleString()}</p>
    </ArtifactFrame>
  );
}

function UnsupportedArtifactView({ artifact }: { artifact: TaskArtifact }) {
  return (
    <ArtifactFrame artifact={artifact}>
      <div className="artifact-unsupported" role="status">
        <strong>Unsupported artifact</strong>
        <span>This page cannot safely render the artifact type. No payload content was executed.</span>
      </div>
    </ArtifactFrame>
  );
}

const artifactRenderers = {
  conversation: ConversationArtifactView,
  auth_required: AuthRequiredArtifactView,
  user_question: UserQuestionArtifactView,
  evidence: EvidenceArtifactView,
};

export function ArtifactRegistry({ artifacts, onAnswer, onAuthorize }: ArtifactRegistryProps) {
  const ordered = [...artifacts].sort((left, right) => {
    const leftPriority = left.type === "user_question" && left.status === "active" ? 0 : 1;
    const rightPriority = right.type === "user_question" && right.status === "active" ? 0 : 1;
    return leftPriority - rightPriority || left.createdSequence - right.createdSequence;
  });
  if (!ordered.length) return null;
  return (
    <section className="artifact-workspace" aria-labelledby="artifact-workspace-title">
      <div className="artifact-workspace-heading">
        <div><span>Task workspace</span><h2 id="artifact-workspace-title">Live artifacts</h2></div>
        <small>{ordered.length} {ordered.length === 1 ? "artifact" : "artifacts"}</small>
      </div>
      <div className="artifact-list">
        {ordered.map((artifact) => {
          switch (artifact.type) {
            case "conversation": return <ConversationArtifactView artifact={artifact as TypedArtifact<"conversation">} key={artifact.artifactId} />;
            case "auth_required": return <AuthRequiredArtifactView artifact={artifact as TypedArtifact<"auth_required">} key={artifact.artifactId} onAuthorize={onAuthorize} />;
            case "user_question": return <UserQuestionArtifactView artifact={artifact as TypedArtifact<"user_question">} key={artifact.artifactId} onAnswer={onAnswer} />;
            case "evidence": return <EvidenceArtifactView artifact={artifact as TypedArtifact<"evidence">} key={artifact.artifactId} />;
            default: return <UnsupportedArtifactView artifact={artifact} key={artifact.artifactId} />;
          }
        })}
      </div>
    </section>
  );
}

export { artifactRenderers };
