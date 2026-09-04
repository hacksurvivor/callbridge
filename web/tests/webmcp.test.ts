import { describe, expect, it, vi } from "vitest";

import { INQUIRY_TOOL_NAMES } from "../../shared/inquiryWebMcp.js";
import {
  APPROVED_INQUIRY_FIXTURE,
  beginInquirySimulationExecution,
  completeInquirySimulationFixture,
  confirmInquirySimulation,
  getInquirySimulationEvents,
  getInquirySimulationResult,
  getInquirySimulationSnapshot,
  prepareInquirySimulation,
  simulationInquiryClient,
} from "../src/simulation/inquirySimulation.js";
import {
  callBridgeWebMcpTools,
  CALLBRIDGE_WEBMCP_TOOL_NAMES,
  inquiryToolNamesForPhase,
  registerCallBridgeWebMcpTools,
  type InquiryToolClient,
} from "../src/webmcp/registerTools.js";
import type { WebMcpModelContext, WebMcpTool } from "../src/webmcp/types.js";

function client(overrides: Partial<InquiryToolClient> = {}): InquiryToolClient {
  const unexpected = () => Promise.reject(new Error("not implemented in this fixture"));
  return {
    createCallDraft: unexpected,
    createDemoCallDraft: unexpected,
    updateCallDraft: unexpected,
    readCallDraft: unexpected,
    getCallStatus: unexpected,
    getCallResult: unexpected,
    ...overrides,
  };
}

describe("CallBridge generalized WebMCP registration", () => {
  it("registers the five general inquiry tools plus the controlled demo creator and excludes protected actions", async () => {
    const tools: WebMcpTool[] = [];
    const modelContext: WebMcpModelContext = {
      registerTool: vi.fn(async (tool) => { tools.push(tool); }),
    };
    const result = await registerCallBridgeWebMcpTools({
      modelContext,
      client: client(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ supported: true, registered: CALLBRIDGE_WEBMCP_TOOL_NAMES });
    expect(tools.map(({ name }) => name)).toEqual([...INQUIRY_TOOL_NAMES]);
    expect(tools.map(({ name }) => name)).not.toContain("create_task_artifact");
    expect(tools.map(({ name }) => name)).not.toContain("update_task_artifact");
    expect(tools.map(({ name }) => name)).not.toContain("read_task_artifacts");
    expect(tools.map(({ name }) => name)).not.toContain("confirm_call");
    expect(tools.map(({ name }) => name)).not.toContain("dispatch_call");
    expect(tools.map(({ name }) => name)).not.toContain("request_stop");
    expect(tools.map(({ name }) => name)).not.toContain("send_message");
    expect(tools.map(({ name }) => name)).not.toContain("submit_form");
    expect(tools.map(({ name }) => name)).not.toContain("pay");
    expect(tools).toHaveLength(6);
  });

  it("selects the least-authority tool palette for every lifecycle phase", () => {
    expect(inquiryToolNamesForPhase("none")).toEqual([]);
    expect(inquiryToolNamesForPhase("no_task")).toEqual(["create_call_draft", "create_demo_call_draft"]);
    expect(inquiryToolNamesForPhase("editable")).toEqual([
      "create_call_draft",
      "create_demo_call_draft",
      "update_call_draft",
      "read_call_draft",
    ]);
    expect(inquiryToolNamesForPhase("running")).toEqual(["read_call_draft", "get_call_status"]);
    expect(inquiryToolNamesForPhase("terminal")).toEqual([
      "read_call_draft",
      "get_call_status",
      "get_call_result",
    ]);
  });

  it("registers only the selected phase and aborts the complete scope through its parent signal", async () => {
    const registered: string[] = [];
    const registrationSignals: AbortSignal[] = [];
    const parent = new AbortController();
    const result = await registerCallBridgeWebMcpTools({
      modelContext: {
        registerTool: vi.fn(async (tool, options) => {
          registered.push(tool.name);
          if (options?.signal) registrationSignals.push(options.signal);
        }),
      },
      client: client(),
      signal: parent.signal,
      toolNames: inquiryToolNamesForPhase("running"),
    });

    expect(result).toEqual({ supported: true, registered: ["read_call_draft", "get_call_status"] });
    expect(registered).toEqual(["read_call_draft", "get_call_status"]);
    expect(registrationSignals.every(({ aborted }) => !aborted)).toBe(true);
    parent.abort();
    expect(registrationSignals.every(({ aborted }) => aborted)).toBe(true);
  });

  it("fails a partially registered scope closed by aborting every tool in it", async () => {
    const registrationSignals: AbortSignal[] = [];
    let calls = 0;
    const result = await registerCallBridgeWebMcpTools({
      modelContext: {
        registerTool: vi.fn(async (_tool, options) => {
          calls += 1;
          if (options?.signal) registrationSignals.push(options.signal);
          if (calls === 2) throw new Error("registration failed");
        }),
      },
      client: client(),
      signal: new AbortController().signal,
      toolNames: inquiryToolNamesForPhase("editable"),
    });

    expect(result).toMatchObject({ supported: false, error: { code: "INTERNAL_ERROR" } });
    expect(registrationSignals).toHaveLength(2);
    expect(registrationSignals.every(({ aborted }) => aborted)).toBe(true);
  });

  it("keeps capabilities stable while the inquiry and optional playbook are data", () => {
    const tools = callBridgeWebMcpTools(client());
    const create = tools.find(({ name }) => name === "create_call_draft");
    const serialized = JSON.stringify(create?.inputSchema);

    expect(serialized).toContain("destination");
    expect(serialized).toContain("objective");
    expect(serialized).toContain("questions");
    expect(serialized).toContain("privateBackground");
    expect(serialized).toContain("shareableFacts");
    expect(serialized).toContain("playbook");
    expect(serialized).not.toContain("after-midnight-allowed");
  });

  it("marks only the three factual reads as read-only", () => {
    const tools = callBridgeWebMcpTools(client());
    expect(Object.fromEntries(tools.map((tool) => [tool.name, tool.annotations?.readOnlyHint]))).toEqual({
      create_call_draft: false,
      create_demo_call_draft: false,
      update_call_draft: false,
      read_call_draft: true,
      get_call_status: true,
      get_call_result: true,
    });
  });

  it("returns a stable unsupported-environment error", async () => {
    const result = await registerCallBridgeWebMcpTools({
      modelContext: undefined,
      client: client(),
      signal: new AbortController().signal,
    });
    expect(result).toEqual({
      supported: false,
      error: {
        code: "UNSUPPORTED_ENVIRONMENT",
        message: "This browser does not support the required WebMCP interface.",
        retryable: false,
      },
    });
  });

  it("uses the shared non-leaking error boundary for every handler", async () => {
    const tools = callBridgeWebMcpTools(client());
    for (const tool of tools) {
      const result = await tool.execute({}, { signal: new AbortController().signal });
      expect(result).toEqual({
        ok: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "Concierge could not complete the request.",
          retryable: true,
        },
      });
    }
  });

  it("returns successful client output without wrapping or mutation", async () => {
    const expected = { status: "not_ready" as const };
    const tools = callBridgeWebMcpTools(client({ getCallResult: async () => expected }));
    const tool = tools.find(({ name }) => name === "get_call_result");
    expect(await tool?.execute({ schemaVersion: 1, taskId: "task_1" }, { signal: new AbortController().signal })).toBe(expected);
  });

  it("supports WebMCP runtimes that omit the optional execution context", async () => {
    const createCallDraft = vi.fn<InquiryToolClient["createCallDraft"]>((input, signal) => (
      simulationInquiryClient.createCallDraft(input, signal)
    ));
    const tools = callBridgeWebMcpTools(client({ createCallDraft }));
    const tool = tools.find(({ name }) => name === "create_call_draft");

    const result = await tool?.execute({
      schemaVersion: 1,
      idempotencyKey: "contextless-runtime",
      contract: structuredClone(APPROVED_INQUIRY_FIXTURE),
    });

    expect(createCallDraft).toHaveBeenCalledOnce();
    expect(createCallDraft.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal);
    expect(createCallDraft.mock.calls[0]?.[1].aborted).toBe(false);
    expect(result).toMatchObject({ revision: 1, status: "draft" });
  });

  it("preserves the runtime abort signal when one is supplied", async () => {
    const runtimeSignal = new AbortController().signal;
    const created = await simulationInquiryClient.createCallDraft({
      schemaVersion: 1,
      idempotencyKey: "runtime-signal",
      contract: structuredClone(APPROVED_INQUIRY_FIXTURE),
    }, runtimeSignal);
    const readCallDraft = vi.fn<InquiryToolClient["readCallDraft"]>(async () => created);
    const tools = callBridgeWebMcpTools(client({ readCallDraft }));
    const tool = tools.find(({ name }) => name === "read_call_draft");

    await tool?.execute({ schemaVersion: 1, taskId: "task_1" }, { signal: runtimeSignal });

    expect(readCallDraft.mock.calls[0]?.[1]).toBe(runtimeSignal);
  });

  it("keeps generalized simulation creation idempotent at the current material revision", async () => {
    const signal = new AbortController().signal;
    const createInput = {
      schemaVersion: 1 as const,
      idempotencyKey: "web-general-inquiry-idempotency",
      contract: structuredClone(APPROVED_INQUIRY_FIXTURE),
    };
    const created = await simulationInquiryClient.createCallDraft(createInput, signal);
    const editedContract = structuredClone(created.contract);
    editedContract.category = "government";
    editedContract.destination = {
      displayName: "Moldova Public Services Agency",
      e164PhoneNumber: "+37322123456",
      countryCode: "MD",
    };
    editedContract.objective = "Ask which documents are required for an address certificate.";
    editedContract.questions = [
      { id: "required-documents", prompt: "Which documents must the applicant bring?", required: true },
    ];
    editedContract.languages.call = "ro";
    await simulationInquiryClient.updateCallDraft({
      schemaVersion: 1,
      taskId: created.taskId,
      expectedRevision: created.revision,
      contract: editedContract,
    }, signal);
    const repeated = await simulationInquiryClient.createCallDraft(createInput, signal);

    expect(repeated.revision).toBe(2);
    expect(repeated.contract.category).toBe("government");
    expect(repeated.contract.destination.countryCode).toBe("MD");
    expect(repeated.confirmation.state).toBe("revoked");
  });

  it("runs the safe simulation through confirmed, in-progress, and evidence-bound result states", async () => {
    const signal = new AbortController().signal;
    const created = await simulationInquiryClient.createCallDraft({
      schemaVersion: 1,
      idempotencyKey: "complete-simulation-flow",
      contract: structuredClone(APPROVED_INQUIRY_FIXTURE),
    }, signal);
    expect(created.status).toBe("draft");

    prepareInquirySimulation();
    expect(confirmInquirySimulation().status).toBe("confirmed");
    expect(beginInquirySimulationExecution().status).toBe("in_progress");
    expect(completeInquirySimulationFixture().status).toBe("completed");

    const result = getInquirySimulationResult();
    expect(result.status).toBe("ready");
    if (result.status !== "ready") return;
    expect(result.result.answers.map(({ questionId }) => questionId)).toEqual(
      getInquirySimulationSnapshot().contract.questions.map(({ id }) => id),
    );
    expect(result.receipt.answeredQuestionIds).toHaveLength(3);
    const eventTimes = getInquirySimulationEvents().map(({ occurredAt }) => new Date(occurredAt).getTime());
    expect(eventTimes).toEqual([...eventTimes].sort((left, right) => left - right));
  });
});
