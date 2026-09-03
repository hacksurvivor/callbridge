import {
  AssistantRuntimeProvider,
  CompositeAttachmentAdapter,
  SimpleImageAttachmentAdapter,
  SimpleTextAttachmentAdapter,
  unstable_createMessageConverter as createMessageConverter,
  useAssistantTransportRuntime,
  type AssistantTransportCommand,
  type AssistantTransportConnectionMetadata,
  type ThreadMessageLike,
} from "@assistant-ui/react";
import { useCallback, useMemo, useRef, useState, type MouseEvent } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";

import type { InquiryCallContract } from "../../shared/inquiryContracts.js";
import type { GetInquiryResultOutput, InquiryActivityEvent } from "../../shared/inquiryWebMcp.js";
import type { InquiryTaskSnapshot, InquiryTaskStatus } from "../../shared/inquiryState.js";
import type { AuthRequiredArtifactPayload, TaskArtifact, UserQuestionArtifactPayload } from "../../shared/taskArtifacts.js";
import {
  CALLBRIDGE_ASSISTANT_API,
  type CallBridgeTransportMessage,
  type CallBridgeTransportState,
} from "./assistantTransport.js";
import { ArtifactRegistry } from "./components/ArtifactRegistry.js";
import { AssistantThread } from "./components/AssistantThread.js";
import { CallBrief } from "./components/CallBrief.js";
import { Header } from "./components/Header.js";
import { ContextPanel, InThreadTimeline, type ContextPanelMode } from "./components/RelayPanels.js";
import { RelaySidebar, taskMediaFromArtifacts } from "./components/RelaySidebar.js";
import { ResultSummary } from "./components/ResultSummary.js";

export type ConfirmationUiState =
  | { state: "idle" }
  | { state: "pending"; message: string }
  | { state: "confirmed"; message: string }
  | { state: "error"; message: string };

export type AppProps = {
  activity?: readonly InquiryActivityEvent[];
  artifacts?: readonly TaskArtifact[];
  confirmation: ConfirmationUiState;
  confirmationReady?: boolean;
  draft: InquiryTaskSnapshot;
  onConfirm: (event: MouseEvent<HTMLButtonElement>) => void;
  onArtifactAuthorize?: (artifact: TaskArtifact<AuthRequiredArtifactPayload>) => Promise<void> | void;
  onArtifactAnswer?: (artifact: TaskArtifact<UserQuestionArtifactPayload>, value: string | string[]) => Promise<void> | void;
  onUpdate: (contract: InquiryCallContract) => Promise<void>;
  refreshHealth?: { state: "current" | "degraded"; lastUpdatedAt: string | null };
  result?: GetInquiryResultOutput;
  simulation?: boolean;
  status?: InquiryTaskStatus;
  visualFixture?: boolean;
};

function categoryLabel(category: string): string {
  return category.replaceAll("_", " ").replace(/^./, (letter) => letter.toUpperCase());
}

function assistantCopy(status: InquiryTaskStatus, destination: string, result: GetInquiryResultOutput): string {
  if (result.status === "ready") return `The evidence-bound result for ${destination} is ready below. I kept facts separate from raw provider data and hidden reasoning.`;
  if (result.status === "processing") return "The call has ended. I’m checking the accepted evidence before presenting a factual result.";
  if (status === "confirmed") return `The approved task for ${destination} is queued for one controlled attempt. Automatic retry remains disabled.`;
  if (status === "in_progress") {
    return `The approved task for ${destination} is in progress. Factual milestones will stream into the timeline as they are recorded.`;
  }
  return `I prepared an information-only call plan for ${destination}. Review the exact questions, shareable facts, authority limits, and price before confirming this revision.`;
}

const transportMessageConverter = createMessageConverter((message: CallBridgeTransportMessage): ThreadMessageLike => ({
  id: message.id,
  role: message.role,
  content: message.content as ThreadMessageLike["content"],
  createdAt: new Date(message.createdAt),
  ...(message.status ? { status: message.status } : {}),
}));

const attachmentAdapter = new CompositeAttachmentAdapter([
  new SimpleImageAttachmentAdapter(),
  new SimpleTextAttachmentAdapter(),
]);

function commandText(command: AssistantTransportCommand): string {
  if (command.type !== "add-message" || command.message.role !== "user") return "";
  return command.message.parts
    .filter((part): part is Extract<(typeof command.message.parts)[number], { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function transportConverter(
  state: CallBridgeTransportState,
  connection: AssistantTransportConnectionMetadata,
) {
  const optimisticMessages: CallBridgeTransportMessage[] = connection.pendingCommands.flatMap((command, index) => {
    const text = commandText(command);
    if (!text) return [];
    return [{
      id: `transport:optimistic:${index}:${text}`,
      role: "user" as const,
      content: [{ type: "text" as const, text }],
      createdAt: new Date(0).toISOString(),
    }];
  });
  return {
    messages: transportMessageConverter.toThreadMessages(
      [...state.messages, ...optimisticMessages],
      connection.isSending,
    ),
    isRunning: connection.isSending,
  };
}

export default function App({
  activity = [], artifacts = [], confirmation, confirmationReady = true, draft, onConfirm,
  onArtifactAuthorize, onArtifactAnswer, onUpdate,
  refreshHealth = { state: "current", lastUpdatedAt: null }, result = { status: "not_ready" },
  simulation = false, status = draft.status,
}: AppProps) {
  const [contextPanel, setContextPanel] = useState<ContextPanelMode | null>(null);
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [transportSaveError, setTransportSaveError] = useState<string | null>(null);
  const pendingRevisionNotesRef = useRef<string[]>([]);
  const latestDraftRef = useRef(draft);
  const onUpdateRef = useRef(onUpdate);
  latestDraftRef.current = draft;
  onUpdateRef.current = onUpdate;
  const media = useMemo(() => taskMediaFromArtifacts(artifacts), [artifacts]);
  const destination = draft.contract.destination.displayName;
  const category = categoryLabel(draft.contract.category);
  const isStreaming = confirmation.state === "pending" || result.status === "processing";
  const confirmationDisabled = !confirmationReady || confirmation.state === "pending" || confirmation.state === "confirmed"
    || status !== "draft" && status !== "awaiting_confirmation";

  const initialTransportState = useMemo<CallBridgeTransportState>(() => ({
    messages: [{
      id: `${draft.taskId}:request`,
      role: "user",
      createdAt: draft.createdAt,
      content: [{ type: "text", text: draft.contract.objective }],
    }, {
      id: `${draft.taskId}:assistant:${draft.revision}:${status}:${result.status}`,
      role: "assistant",
      createdAt: draft.updatedAt,
      content: [
        { type: "reasoning", text: "Checked the exact revision, destination, questions, context channels, authority limits, and confirmation boundary.", status: isStreaming ? { type: "running" } : { type: "complete" } },
        {
          type: "tool-call",
          toolCallId: `read-call-draft-${draft.revision}`,
          toolName: "read_call_draft",
          args: { revision: draft.revision },
          ...(!isStreaming ? { result: { status, revision: draft.revision } } : {}),
        },
        { type: "text", text: assistantCopy(status, destination, result), status: isStreaming ? { type: "running" } : { type: "complete" } },
        ...(draft.contract.destination.website ? [{
          type: "source" as const,
          sourceType: "url" as const,
          id: `${draft.taskId}:destination-source`,
          url: draft.contract.destination.website,
          title: draft.contract.destination.displayName,
          status: { type: "complete" as const },
        }] : []),
      ],
      status: isStreaming ? { type: "running" } : { type: "complete", reason: "stop" },
    }],
  }), [destination, draft.contract.objective, draft.createdAt, draft.revision, draft.taskId, draft.updatedAt, isStreaming, result, status]);

  const transportStateRef = useRef<{ taskId: string; state: CallBridgeTransportState }>({
    taskId: draft.taskId,
    state: initialTransportState,
  });
  if (transportStateRef.current.taskId !== draft.taskId) {
    transportStateRef.current = { taskId: draft.taskId, state: initialTransportState };
  } else {
    const conversationMessages = transportStateRef.current.state.messages.filter((message) => (
      message.id !== `${draft.taskId}:request`
      && !message.id.startsWith(`${draft.taskId}:assistant:`)
    ));
    transportStateRef.current.state = {
      ...transportStateRef.current.state,
      messages: [...initialTransportState.messages, ...conversationMessages],
    };
  }
  const persistentTransportConverter = useCallback((
    state: CallBridgeTransportState,
    connection: AssistantTransportConnectionMetadata,
  ) => {
    transportStateRef.current.state = state;
    return transportConverter(state, connection);
  }, []);

  const runtime = useAssistantTransportRuntime<CallBridgeTransportState>({
    initialState: transportStateRef.current.state,
    api: CALLBRIDGE_ASSISTANT_API,
    protocol: "assistant-transport",
    headers: { "Content-Type": "application/json" },
    converter: persistentTransportConverter,
    adapters: { attachments: attachmentAdapter },
    prepareSendCommandsRequest: (body) => {
      const revisionNotes = body.commands.map(commandText).filter(Boolean);
      pendingRevisionNotesRef.current = revisionNotes;
      setTransportSaveError(null);
      return {
        ...body,
        destination,
        draftRevision: draft.revision,
      };
    },
    onFinish: () => {
      const revisionNotes = pendingRevisionNotesRef.current;
      pendingRevisionNotesRef.current = [];
      if (revisionNotes.length === 0) return;
      const latestDraft = latestDraftRef.current;
      const currentPrivate = latestDraft.contract.context.privateBackground?.trim();
      void onUpdateRef.current({
        ...latestDraft.contract,
        context: {
          ...latestDraft.contract.context,
          privateBackground: [
            currentPrivate,
            ...revisionNotes.map((text) => `Revision note: ${text}`),
          ].filter(Boolean).join("\n"),
        },
      }).catch(() => {
        setTransportSaveError("The streamed reply finished, but the draft revision could not be saved. Nothing was shared and no call was placed.");
      });
    },
    onError: (error, { updateState }) => {
      pendingRevisionNotesRef.current = [];
      const createdAt = new Date().toISOString();
      updateState((current) => ({
        ...current,
        lastError: error.message,
        messages: [...current.messages, {
          id: `transport:error:${createdAt}`,
          role: "assistant",
          createdAt,
          content: [{ type: "text", text: "I couldn’t save that revision. Nothing was shared and no call was placed. Please try again." }],
          status: { type: "incomplete", reason: "error" },
        }],
      }));
    },
  });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <TooltipProvider delayDuration={250}>
      <div className="app-shell chatgpt-app">
        {simulation ? <div className="simulation-banner">Simulation · no phone call can be placed</div> : null}
        <div className={`relay-workspace ${contextPanel ? "has-context-panel" : ""}`}>
          {navigationOpen ? <button className="navigation-scrim mobile-only" aria-label="Close conversations" onClick={() => setNavigationOpen(false)} type="button" /> : null}
          <RelaySidebar currentTitle={`${category} for ${destination}`} media={media} mobileOpen={navigationOpen} onClose={() => setNavigationOpen(false)} onOpenGallery={() => setContextPanel("gallery")} />
          <section className="chat-surface">
            <h1 className="sr-only">{category} for {destination}</h1>
            <Header
              onOpenActivity={() => setContextPanel("activity")}
              onOpenGallery={() => setContextPanel("gallery")}
              onOpenNavigation={() => setNavigationOpen(true)}
            />
            <main className="conversation-main">
              <AssistantThread>
                <InThreadTimeline events={activity} snapshot={draft} status={status} onOpenActivity={() => setContextPanel("activity")} />
                <ArtifactRegistry artifacts={artifacts} {...(onArtifactAnswer ? { onAnswer: onArtifactAnswer } : {})} {...(onArtifactAuthorize ? { onAuthorize: onArtifactAuthorize } : {})} />
                <CallBrief
                  approvalState={confirmation.state === "pending" ? "running" : confirmation.state === "confirmed" ? "done" : "request"}
                  confirmationDisabled={confirmationDisabled}
                  onConfirm={onConfirm}
                  onUpdate={onUpdate}
                  snapshot={draft}
                  status={status}
                />
                {transportSaveError ? <p className="confirmation-message error" role="alert">{transportSaveError}</p> : null}
                {confirmation.state !== "idle" && (confirmation.state !== "confirmed" || status === "confirmed") ? <p className={`confirmation-message ${confirmation.state}`} role="status">{confirmation.message}</p> : null}
                {refreshHealth.state === "degraded" ? <section className="result-state error" role="alert"><span>Live updates paused</span><strong>CallBridge could not refresh the task twice in a row.</strong><small>{refreshHealth.lastUpdatedAt ? `Last factual update ${new Date(refreshHealth.lastUpdatedAt).toLocaleTimeString()}. Reload to reconnect.` : "Reload this page to reconnect. No result has been invented."}</small></section> : null}
                {result.status === "processing" ? <section className="result-state" role="status"><span className="stream-pulse" /><strong>Checking accepted call evidence…</strong></section> : null}
                {result.status === "failed" ? <section className="result-state error" role="alert"><span>Result unavailable</span><strong>The call evidence could not be projected safely.</strong><small>No answer was invented and automatic retry is disabled.</small></section> : null}
                {result.status === "ready" ? <ResultSummary questions={draft.contract.questions} output={result} /> : null}
              </AssistantThread>
            </main>
          </section>
          <ContextPanel
            events={activity}
            media={media}
            mode={contextPanel ?? "activity"}
            onChangeMode={setContextPanel}
            onClose={() => setContextPanel(null)}
            open={Boolean(contextPanel)}
            snapshot={draft}
            status={status}
          />
        </div>
      </div>
      </TooltipProvider>
    </AssistantRuntimeProvider>
  );
}
