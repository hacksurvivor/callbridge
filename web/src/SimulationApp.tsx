import { useEffect, useState, useSyncExternalStore } from "react";

import type { InquiryCallContract } from "../../shared/inquiryContracts.js";
import App, { type ConfirmationUiState } from "./App.js";
import {
  confirmInquirySimulation,
  completeInquirySimulationFixture,
  answerSimulationArtifactQuestion,
  beginSimulationArtifactFixture,
  completeSimulationArtifactAuthorization,
  getInquirySimulationArtifacts,
  getInquirySimulationEvents,
  getInquirySimulationResult,
  getInquirySimulationSnapshot,
  prepareInquirySimulation,
  simulationInquiryClient,
  subscribeInquirySimulation,
} from "./simulation/inquirySimulation.js";

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

  useEffect(() => {
    if (visualFixture === "result") completeInquirySimulationFixture();
    if (visualFixture === "artifacts") beginSimulationArtifactFixture();
  }, [visualFixture]);

  useEffect(() => {
    if (draft.status !== "draft" || draft.confirmation.state === "ready") return;
    const timeout = window.setTimeout(() => prepareInquirySimulation(), 250);
    return () => window.clearTimeout(timeout);
  }, [draft.confirmation.state, draft.status]);

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
      onUpdate={update}
      result={getInquirySimulationResult()}
      simulation
      visualFixture={Boolean(visualFixture)}
    />
  );
}
