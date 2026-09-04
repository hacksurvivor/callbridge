import { ConvexProviderWithAuthKit } from "@convex-dev/workos";
import { AuthKitProvider, useAuth } from "@workos-inc/authkit-react";
import { useCallback, useEffect, useMemo, useState, type MouseEvent } from "react";
import { ConvexReactClient, useConvex, useConvexAuth } from "convex/react";

import { INQUIRY_CONTRACT_SCHEMA_VERSION, type InquiryCallContract } from "../../shared/inquiryContracts.js";
import { toInquiryWebMcpError, type GetInquiryResultOutput, type InquiryActivityEvent } from "../../shared/inquiryWebMcp.js";
import type { InquiryTaskSnapshot, InquiryTaskStatus } from "../../shared/inquiryState.js";
import App, { type ConfirmationUiState } from "./App.js";
import { currentAuthReturnPath, validatedAuthReturnPath } from "./authReturn.js";
import { Header } from "./components/Header.js";
import type { RecentTask } from "./components/RelaySidebar.js";
import {
  confirmInquiryTask,
  createConvexInquiryClient,
  listInquiryTasks,
  prepareInquiryConfirmation,
  readTaskIdFromLocation,
  type PreparedConfirmationIntent,
} from "./convex/inquiryClient.js";
import {
  mergeInquiryActivity,
  nextRefreshFailureCount,
  shouldStopInquiryPolling,
} from "./submissionRuntime.js";
import {
  registerCallBridgeWebMcpTools,
} from "./webmcp/registerTools.js";

type Configuration = {
  convexUrl: string;
  workosClientId: string;
  redirectUri: string;
};

function recentTask(snapshot: InquiryTaskSnapshot): RecentTask {
  const updated = new Date(snapshot.updatedAt);
  const today = new Date();
  const sameDay = updated.toDateString() === today.toDateString();
  return {
    taskId: snapshot.taskId,
    title: `${snapshot.contract.destination.displayName} · ${snapshot.contract.objective}`,
    time: sameDay
      ? updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : updated.toLocaleDateString([], { month: "short", day: "numeric" }),
  };
}

function readConfiguration(): Configuration | null {
  const convexUrl = import.meta.env.VITE_CONVEX_URL?.trim();
  const workosClientId = import.meta.env.VITE_WORKOS_CLIENT_ID?.trim();
  const redirectUri = import.meta.env.VITE_WORKOS_REDIRECT_URI?.trim();
  if (!convexUrl || !workosClientId || !redirectUri) return null;
  return { convexUrl, workosClientId, redirectUri };
}

export function AccessState({
  action,
  detail,
  kicker,
  title,
}: {
  action?: { label: string; run: () => void; disabled?: boolean };
  detail?: string;
  kicker: string;
  title: string;
}) {
  return (
    <div className="access-shell">
      <Header />
      <main className="access-main">
        <section className="access-card">
          <p className="access-kicker">{kicker}</p>
          <h1>{title}</h1>
          <p className="access-copy">ChatGPT can prepare and revise a controlled information-gathering call here. Only you can confirm it on this webpage.</p>
          {action ? <button className="button primary" disabled={action.disabled} onClick={action.run} type="button">{action.label}</button> : null}
          {detail ? <p className="access-detail">{detail}</p> : null}
        </section>
      </main>
    </div>
  );
}

export function LiveWorkspace() {
  const convex = useConvex();
  const [draft, setDraft] = useState<InquiryTaskSnapshot | null>(null);
  const [activity, setActivity] = useState<InquiryActivityEvent[]>([]);
  const [liveStatus, setLiveStatus] = useState<InquiryTaskStatus | null>(null);
  const [result, setResult] = useState<GetInquiryResultOutput>({ status: "not_ready" });
  const [restoreState, setRestoreState] = useState<"idle" | "loading" | "failed">(
    () => readTaskIdFromLocation() ? "loading" : "idle",
  );
  const [toolState, setToolState] = useState<"registering" | "ready" | "unsupported" | "failed">("registering");
  const [refreshHealth, setRefreshHealth] = useState<{ state: "current" | "degraded"; lastUpdatedAt: string | null }>({
    state: "current",
    lastUpdatedAt: null,
  });
  const [confirmation, setConfirmation] = useState<ConfirmationUiState>({ state: "idle" });
  const [preparedIntent, setPreparedIntent] = useState<PreparedConfirmationIntent | null>(null);
  const [recentTasks, setRecentTasks] = useState<RecentTask[]>([]);

  const acceptDraft = useCallback((next: InquiryTaskSnapshot) => {
    setDraft(next);
    setLiveStatus(next.status);
    setPreparedIntent(null);
    setConfirmation({ state: "idle" });
    setRecentTasks((current) => [
      recentTask(next),
      ...current.filter(({ taskId }) => taskId !== next.taskId),
    ]);
  }, []);
  const toolClient = useMemo(() => createConvexInquiryClient({ convex, onDraft: acceptDraft }), [acceptDraft, convex]);

  useEffect(() => {
    let active = true;
    void listInquiryTasks(convex).then((tasks) => {
      if (active) setRecentTasks(tasks.map(recentTask));
    }, () => {
      // The active task remains usable when history cannot be refreshed.
    });
    return () => { active = false; };
  }, [convex]);

  useEffect(() => {
    const taskId = readTaskIdFromLocation();
    if (!taskId) return;
    const controller = new AbortController();
    setRestoreState("loading");
    void toolClient.readCallDraft(
      { schemaVersion: INQUIRY_CONTRACT_SCHEMA_VERSION, taskId },
      controller.signal,
    ).then(() => setRestoreState("idle"), () => setRestoreState("failed"));
    return () => controller.abort();
  }, [toolClient]);

  useEffect(() => {
    if (!draft || preparedIntent || draft.status === "confirmed" || draft.confirmation.state === "confirmed") return;
    if (
      draft.confirmation.state === "ready"
      && draft.confirmation.intentId
      && draft.confirmation.expiresAt
      && draft.pricing.status === "ready"
      && new Date(draft.confirmation.expiresAt) > new Date()
    ) {
      setPreparedIntent({
        intentId: draft.confirmation.intentId,
        taskId: draft.taskId,
        revision: draft.revision,
        executionRevision: draft.executionRevision,
        expiresAt: draft.confirmation.expiresAt,
        pricingQuoteId: draft.pricing.quote.quoteId,
      });
      return;
    }
    let active = true;
    setConfirmation({ state: "pending", message: "Checking the destination, current rate, and exact execution revision…" });
    void prepareInquiryConfirmation({ convex, draft }).then(({ draft: refreshed, intent }) => {
      if (!active) return;
      setDraft(refreshed);
      setLiveStatus(refreshed.status);
      setPreparedIntent(intent);
      setConfirmation({ state: "idle" });
    }, (error) => {
      if (active) setConfirmation({ state: "error", message: toInquiryWebMcpError(error).message });
    });
    return () => { active = false; };
  }, [convex, draft, preparedIntent]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setToolState("registering");
    void registerCallBridgeWebMcpTools({
      modelContext: document.modelContext,
      client: toolClient,
      signal: controller.signal,
    }).then((registered) => {
      if (!active) return;
      setToolState(registered.supported
        ? "ready"
        : registered.error.code === "UNSUPPORTED_ENVIRONMENT" ? "unsupported" : "failed");
    }, () => {
      if (active) setToolState("failed");
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [toolClient]);

  useEffect(() => {
    if (!draft) return;
    const controller = new AbortController();
    let active = true;
    let nextSequence = 0;
    let latestStatus: InquiryTaskStatus = draft.status;
    let latestResult: GetInquiryResultOutput = { status: "not_ready" };
    let consecutiveFailures = 0;
    let interval: number | undefined;
    const refresh = async () => {
      const [statusOutcome, resultOutcome] = await Promise.allSettled([
        toolClient.getCallStatus({
          schemaVersion: 1,
          taskId: draft.taskId,
          ...(nextSequence > 0 ? { afterSequence: nextSequence } : {}),
        }, controller.signal),
        toolClient.getCallResult({ schemaVersion: 1, taskId: draft.taskId }, controller.signal),
      ]);
      if (!active) return;

      let successfulReads = 0;
      if (statusOutcome.status === "fulfilled") {
        successfulReads += 1;
        latestStatus = statusOutcome.value.taskStatus;
        setLiveStatus(latestStatus);
        setActivity((current) => mergeInquiryActivity(current, statusOutcome.value.events));
        if (statusOutcome.value.nextSequence !== null) {
          nextSequence = Math.max(nextSequence, statusOutcome.value.nextSequence);
        }
      }
      if (resultOutcome.status === "fulfilled") {
        successfulReads += 1;
        latestResult = resultOutcome.value;
        setResult(latestResult);
      }

      consecutiveFailures = nextRefreshFailureCount(consecutiveFailures, successfulReads);
      if (successfulReads > 0) {
        setRefreshHealth({ state: "current", lastUpdatedAt: new Date().toISOString() });
      } else if (consecutiveFailures >= 2) {
        setRefreshHealth((current) => ({ ...current, state: "degraded" }));
      }

      if (shouldStopInquiryPolling(latestStatus, latestResult) && interval !== undefined) {
        window.clearInterval(interval);
        interval = undefined;
      }
    };
    void refresh();
    interval = window.setInterval(() => void refresh(), 1_500);
    return () => {
      active = false;
      controller.abort();
      if (interval !== undefined) window.clearInterval(interval);
    };
  }, [draft?.taskId, toolClient]);

  const confirm = useCallback((event: MouseEvent<HTMLButtonElement>) => {
    if (!event.nativeEvent.isTrusted || (navigator.userActivation && !navigator.userActivation.isActive)) {
      setConfirmation({ state: "error", message: "Use the visible Confirm call button to approve this exact revision." });
      return;
    }
    if (!draft || !preparedIntent || confirmation.state === "pending" || confirmation.state === "confirmed") return;
    setConfirmation({ state: "pending", message: "Recording your approval for this exact execution revision…" });
    void confirmInquiryTask({ convex, draft, intent: preparedIntent }).then((nextDraft) => {
      setDraft(nextDraft);
      setLiveStatus(nextDraft.status);
      setConfirmation({
        state: "confirmed",
        message: "Confirmed by you. One controlled attempt is queued; automatic retries remain disabled.",
      });
    }, (error) => {
      setPreparedIntent(null);
      setConfirmation({ state: "error", message: toInquiryWebMcpError(error).message });
    });
  }, [confirmation.state, convex, draft, preparedIntent]);

  const update = useCallback(async (contract: InquiryCallContract) => {
    if (!draft) return;
    try {
      await toolClient.updateCallDraft({
        schemaVersion: INQUIRY_CONTRACT_SCHEMA_VERSION,
        taskId: draft.taskId,
        expectedRevision: draft.revision,
        contract,
      }, new AbortController().signal);
    } catch (error) {
      setConfirmation({ state: "error", message: toInquiryWebMcpError(error).message });
      throw error;
    }
  }, [draft, toolClient]);

  const createTask = useCallback(async (objective: string) => {
    if (!draft) throw new Error("A source task is required");
    await toolClient.createCallDraft({
      schemaVersion: INQUIRY_CONTRACT_SCHEMA_VERSION,
      idempotencyKey: `web-new-task-${crypto.randomUUID()}`,
      contract: {
        ...draft.contract,
        objective,
        questions: [{ id: "primary-request", prompt: objective, required: true }],
        context: {
          privateBackground: "Created by the user from the Concierge task composer.",
          shareableFacts: [],
        },
        playbook: undefined,
      },
    }, new AbortController().signal);
  }, [draft, toolClient]);

  const selectTask = useCallback(async (taskId: string) => {
    if (draft?.taskId === taskId) return;
    setActivity([]);
    setResult({ status: "not_ready" });
    setRefreshHealth({ state: "current", lastUpdatedAt: null });
    await toolClient.readCallDraft(
      { schemaVersion: INQUIRY_CONTRACT_SCHEMA_VERSION, taskId },
      new AbortController().signal,
    );
  }, [draft?.taskId, toolClient]);

  if (draft) {
    return (
      <App
        activity={activity}
        confirmation={confirmation}
        confirmationReady={Boolean(preparedIntent)}
        draft={draft}
        onConfirm={confirm}
        onCreateTask={createTask}
        onSelectTask={selectTask}
        onUpdate={update}
        recentTasks={recentTasks}
        refreshHealth={refreshHealth}
        result={result}
        status={liveStatus ?? draft.status}
      />
    );
  }
  if (restoreState === "loading") return <AccessState kicker="Restoring task" title="Loading the current call draft" />;
  if (restoreState === "failed") {
    return <AccessState kicker="Task unavailable" title="Ask ChatGPT to create a new call draft" detail="The URL is only a convenience pointer; server ownership is always rechecked." />;
  }
  if (toolState === "unsupported") {
    return <AccessState kicker="WebMCP unavailable" title="Open Concierge in ChatGPT’s supported browser" detail="No tools were registered in this browser." />;
  }
  if (toolState === "failed") {
    return <AccessState kicker="Connection issue" title="Concierge could not register its tools" detail="Reload this page before asking ChatGPT to try again." />;
  }
  return (
    <AccessState
      kicker={toolState === "ready" ? "Connected to ChatGPT" : "Connecting"}
      title={toolState === "ready" ? "Ask ChatGPT to prepare any inquiry call" : "Registering Concierge tools"}
      {...(toolState === "ready" ? {
        detail: "ChatGPT can prepare, revise, and read this controlled call task. Confirmation remains webpage-only.",
      } : {})}
    />
  );
}

function AuthenticationBoundary() {
  const auth = useAuth();
  const convexAuth = useConvexAuth();
  if (auth.isLoading || convexAuth.isLoading) return <AccessState kicker="Secure session" title="Checking your Concierge session" />;
  if (!auth.user) {
    return (
      <AccessState
        kicker="Private call tasks"
        title="Sign in to continue"
        action={{
          label: "Sign in",
          run: () => void auth.signIn({ state: { returnTo: currentAuthReturnPath() } }),
        }}
      />
    );
  }
  if (!convexAuth.isAuthenticated) {
    return <AccessState kicker="Secure session" title="Finishing authentication" detail="WebMCP remains unavailable until the backend confirms this session." />;
  }
  return <LiveWorkspace />;
}

export function ProductionApp() {
  const configuration = readConfiguration();
  const convex = useMemo(
    () => configuration ? new ConvexReactClient(configuration.convexUrl) : null,
    [configuration?.convexUrl],
  );
  if (!configuration || !convex) {
    return <AccessState kicker="Setup required" title="Concierge is not configured" detail="Convex and WorkOS public client settings are missing. No WebMCP tools were registered." />;
  }

  const handleAuthRedirect = ({ state }: { state?: unknown }) => {
    const returnPath = validatedAuthReturnPath(state, window.location.origin);
    if (returnPath) window.history.replaceState(window.history.state, "", returnPath);
  };

  return (
    <AuthKitProvider
      clientId={configuration.workosClientId}
      devMode={import.meta.env.DEV ? true : false}
      onRedirectCallback={handleAuthRedirect}
      redirectUri={configuration.redirectUri}
    >
      <ConvexProviderWithAuthKit client={convex} useAuth={useAuth}>
        <AuthenticationBoundary />
      </ConvexProviderWithAuthKit>
    </AuthKitProvider>
  );
}
