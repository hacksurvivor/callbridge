import { useEffect, useState, useSyncExternalStore } from "react";

import { INQUIRY_CONTRACT_SCHEMA_VERSION, type InquiryCallContract } from "../../shared/inquiryContracts.js";
import type { InquiryTaskSnapshot } from "../../shared/inquiryState.js";
import App, { type ConfirmationUiState } from "./App.js";
import type { RecentTask } from "./components/RelaySidebar.js";
import {
  confirmInquirySimulation,
  beginInquirySimulationExecution,
  completeInquirySimulationFixture,
  answerSimulationArtifactQuestion,
  beginSimulationArtifactFixture,
  completeSimulationArtifactAuthorization,
  getInquirySimulationArtifacts,
  getInquirySimulationEvents,
  getInquirySimulationHistory,
  getInquirySimulationResult,
  getInquirySimulationSnapshot,
  prepareInquirySimulation,
  simulationInquiryClient,
  selectInquirySimulationTask,
  subscribeInquirySimulation,
} from "./simulation/inquirySimulation.js";

function recentTask(snapshot: InquiryTaskSnapshot): RecentTask {
  const updated = new Date(snapshot.updatedAt);
  const sameDay = updated.toDateString() === new Date().toDateString();
  return {
    taskId: snapshot.taskId,
    title: `${snapshot.contract.destination.displayName} · ${snapshot.contract.objective}`,
    time: sameDay
      ? updated.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
      : updated.toLocaleDateString([], { month: "short", day: "numeric" }),
  };
}

export function SimulationApp({ visualFixture }: { visualFixture?: "approved" | "result" | "artifacts" }) {
  const [confirmation, setConfirmation] = useState<ConfirmationUiState>({ state: "idle" });
  const draft = useSyncExternalStore(
    subscribeInquirySimulation,
    getInquirySimulationSnapshot,
    getInquirySimulationSnapshot,
  );
  const artifacts = useSyncExternalStore(
    subscribeInquirySimulation,
    getInquirySimulationArtifacts,
    getInquirySimulationArtifacts,
  );
  const history = useSyncExternalStore(
    subscribeInquirySimulation,
    getInquirySimulationHistory,
    getInquirySimulationHistory,
  );

  useEffect(() => {
    if (visualFixture === "result") completeInquirySimulationFixture();
    if (visualFixture === "artifacts") beginSimulationArtifactFixture();
  }, [visualFixture]);

  useEffect(() => {
    if (draft.status !== "draft" || draft.confirmation.state === "ready") return;
    const timeout = window.setTimeout(() => prepareInquirySimulation(), 250);
    return () => window.clearTimeout(timeout);
  }, [draft.confirmation.state, draft.status]);

  useEffect(() => {
    if (visualFixture) return;
    if (draft.status === "confirmed") {
      const timeout = window.setTimeout(() => beginInquirySimulationExecution(), 450);
      return () => window.clearTimeout(timeout);
    }
    if (draft.status === "in_progress") {
      const timeout = window.setTimeout(() => completeInquirySimulationFixture(), 1_400);
      return () => window.clearTimeout(timeout);
    }
  }, [draft.status, visualFixture]);

  const update = async (contract: InquiryCallContract) => {
    try {
      await simulationInquiryClient.updateCallDraft({
        schemaVersion: 1,
        taskId: draft.taskId,
        expectedRevision: draft.revision,
        contract,
      }, new AbortController().signal);
      setConfirmation({ state: "idle" });
    } catch {
      setConfirmation({ state: "error", message: "CallBridge could not save this draft." });
    }
  };

  return (
    <App
      activity={getInquirySimulationEvents()}
      artifacts={artifacts}
      confirmation={confirmation}
      confirmationReady={draft.confirmation.state === "ready"}
      draft={draft}
      onArtifactAuthorize={(artifact) => completeSimulationArtifactAuthorization(artifact.artifactId)}
      onArtifactAnswer={(artifact, value) => answerSimulationArtifactQuestion(artifact.artifactId, value)}
      onConfirm={() => {
        confirmInquirySimulation();
        setConfirmation({
          state: "confirmed",
          message: "Confirmation captured in this local simulation. External effects remain disabled.",
        });
      }}
      onCreateTask={async (objective) => {
        await simulationInquiryClient.createCallDraft({
          schemaVersion: INQUIRY_CONTRACT_SCHEMA_VERSION,
          idempotencyKey: `web-new-task-${crypto.randomUUID()}`,
          contract: {
            ...draft.contract,
            objective,
            questions: [{ id: "primary-request", prompt: objective, required: true }],
            context: {
              privateBackground: "Created by the user from the CallBridge task composer.",
              shareableFacts: [],
            },
            playbook: undefined,
          },
        }, new AbortController().signal);
      }}
      onSelectTask={(taskId) => selectInquirySimulationTask(taskId)}
      onUpdate={update}
      recentTasks={history.map(recentTask)}
      result={getInquirySimulationResult()}
      simulation
      visualFixture={Boolean(visualFixture)}
    />
  );
}
