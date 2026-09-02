import { createRoot } from "react-dom/client";

import { ProductionApp } from "./ProductionApp.js";
import { SimulationApp } from "./SimulationApp.js";
import { simulationInquiryClient } from "./simulation/inquirySimulation.js";
import "./styles.css";
import "./artifact-styles.css";
import { registerCallBridgeWebMcpTools } from "./webmcp/registerTools.js";

const params = new URLSearchParams(window.location.search);
const simulation = import.meta.env.DEV || import.meta.env.VITE_CALLBRIDGE_SIMULATION === "true";
const visualFixture = import.meta.env.DEV && ["approved", "result", "artifacts"].includes(params.get("visualFixture") ?? "")
  ? params.get("visualFixture") as "approved" | "result" | "artifacts"
  : undefined;

if (simulation) {
  const toolLifetime = new AbortController();
  void registerCallBridgeWebMcpTools({
    modelContext: document.modelContext,
    client: simulationInquiryClient,
    signal: toolLifetime.signal,
  });
  window.addEventListener("pagehide", () => toolLifetime.abort(), { once: true });
}

createRoot(document.getElementById("root")!).render(
  simulation ? <SimulationApp {...(visualFixture ? { visualFixture } : {})} /> : <ProductionApp />,
);
