import { describe, expect, it, vi } from "vitest";

import { INQUIRY_TOOL_NAMES } from "../../shared/inquiryWebMcp.js";
import {
  APPROVED_INQUIRY_FIXTURE,
  simulationInquiryClient,
} from "../src/simulation/inquirySimulation.js";
import {
  callBridgeWebMcpTools,
  registerCallBridgeWebMcpTools,
  type InquiryToolClient,
} from "../src/webmcp/registerTools.js";
import type { WebMcpModelContext, WebMcpTool } from "../src/webmcp/types.js";

function client(overrides: Partial<InquiryToolClient> = {}): InquiryToolClient {
  const unexpected = () => Promise.reject(new Error("not implemented in this fixture"));
  return {
    createCallDraft: unexpected,
    updateCallDraft: unexpected,
    readCallDraft: unexpected,
    getCallStatus: unexpected,
    getCallResult: unexpected,
    ...overrides,
  };
}

describe("CallBridge generalized WebMCP registration", () => {
  it("registers exactly five stable tools and excludes confirmation, dispatch, and stop", async () => {
    const tools: WebMcpTool[] = [];
    const modelContext: WebMcpModelContext = {
      registerTool: vi.fn(async (tool) => { tools.push(tool); }),
    };
    const result = await registerCallBridgeWebMcpTools({
      modelContext,
      client: client(),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ supported: true, registered: INQUIRY_TOOL_NAMES });
    expect(tools.map(({ name }) => name)).toEqual(INQUIRY_TOOL_NAMES);
    expect(tools.map(({ name }) => name)).not.toContain("confirm_call");
    expect(tools.map(({ name }) => name)).not.toContain("dispatch_call");
    expect(tools.map(({ name }) => name)).not.toContain("request_stop");
    expect(tools).toHaveLength(5);
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
          message: "CallBridge could not complete the request.",
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
});
