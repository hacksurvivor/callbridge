import {
  INQUIRY_TOOL_NAMES,
  inquiryToolInputSchemas,
  toInquiryWebMcpError,
  type CreateInquiryDraftInput,
  type GetInquiryResultInput,
  type GetInquiryResultOutput,
  type GetInquiryStatusInput,
  type GetInquiryStatusOutput,
  type InquiryToolName,
  type InquiryWebMcpError,
  type ReadInquiryDraftInput,
  type UpdateInquiryDraftInput,
  type UpdateInquiryDraftOutput,
} from "../../../shared/inquiryWebMcp.js";
import type { InquiryTaskSnapshot } from "../../../shared/inquiryState.js";

import type { WebMcpModelContext, WebMcpTool } from "./types.js";

export type InquiryToolClient = {
  createCallDraft(input: CreateInquiryDraftInput, signal: AbortSignal): Promise<InquiryTaskSnapshot>;
  updateCallDraft(input: UpdateInquiryDraftInput, signal: AbortSignal): Promise<UpdateInquiryDraftOutput>;
  readCallDraft(input: ReadInquiryDraftInput, signal: AbortSignal): Promise<InquiryTaskSnapshot>;
  getCallStatus(input: GetInquiryStatusInput, signal: AbortSignal): Promise<GetInquiryStatusOutput>;
  getCallResult(input: GetInquiryResultInput, signal: AbortSignal): Promise<GetInquiryResultOutput>;
};

export const CALLBRIDGE_WEBMCP_TOOL_NAMES = INQUIRY_TOOL_NAMES;

export type InquiryToolPhase = "none" | "no_task" | "editable" | "running" | "terminal";

const TOOL_NAMES_BY_PHASE: Readonly<Record<InquiryToolPhase, readonly InquiryToolName[]>> = {
  none: [],
  no_task: ["create_call_draft"],
  editable: ["create_call_draft", "update_call_draft", "read_call_draft"],
  running: ["read_call_draft", "get_call_status"],
  terminal: ["read_call_draft", "get_call_status", "get_call_result"],
};

export function inquiryToolNamesForPhase(phase: InquiryToolPhase): readonly InquiryToolName[] {
  return TOOL_NAMES_BY_PHASE[phase];
}

export type WebMcpToolFailure = { ok: false; error: InquiryWebMcpError };

async function executeSafely<T>(operation: () => Promise<T>): Promise<T | WebMcpToolFailure> {
  try {
    return await operation();
  } catch (error) {
    return { ok: false, error: toInquiryWebMcpError(error) };
  }
}

function executionSignal(options?: { signal?: AbortSignal }): AbortSignal {
  return options?.signal ?? new AbortController().signal;
}

export function callBridgeWebMcpTools(
  client: InquiryToolClient,
  toolNames: readonly InquiryToolName[] = CALLBRIDGE_WEBMCP_TOOL_NAMES,
): WebMcpTool[] {
  const selected = new Set(toolNames);
  const tools: WebMcpTool[] = [
    {
      name: "create_call_draft",
      title: "Create an inquiry call draft",
      description: "Create a controlled information-gathering call draft for any destination, service, or inquiry. This changes page state but never confirms or starts a call.",
      inputSchema: inquiryToolInputSchemas.create_call_draft,
      annotations: { readOnlyHint: false },
      execute: (input, options) => executeSafely(() => client.createCallDraft(input as CreateInquiryDraftInput, executionSignal(options))),
    },
    {
      name: "update_call_draft",
      title: "Update an inquiry call draft",
      description: "Replace a call brief at an exact revision, including its objective, questions, shareable context, destination, languages, spending limit, or approved playbook. Material changes revoke pending confirmation and never start a call.",
      inputSchema: inquiryToolInputSchemas.update_call_draft,
      annotations: { readOnlyHint: false },
      execute: (input, options) => executeSafely(() => client.updateCallDraft(input as UpdateInquiryDraftInput, executionSignal(options))),
    },
    {
      name: "read_call_draft",
      title: "Read an inquiry call draft",
      description: "Read the signed-in person's current controlled inquiry, exact execution revision, and confirmation state.",
      inputSchema: inquiryToolInputSchemas.read_call_draft,
      annotations: { readOnlyHint: true },
      execute: (input, options) => executeSafely(() => client.readCallDraft(input as ReadInquiryDraftInput, executionSignal(options))),
    },
    {
      name: "get_call_status",
      title: "Read inquiry call status",
      description: "Read factual public Activity events for a controlled inquiry call after an optional sequence cursor.",
      inputSchema: inquiryToolInputSchemas.get_call_status,
      annotations: { readOnlyHint: true },
      execute: (input, options) => executeSafely(() => client.getCallStatus(input as GetInquiryStatusInput, executionSignal(options))),
    },
    {
      name: "get_call_result",
      title: "Read inquiry call result",
      description: "Read the evidence-bound result for a controlled inquiry call. It never returns hidden reasoning, a raw transcript, or audio.",
      inputSchema: inquiryToolInputSchemas.get_call_result,
      annotations: { readOnlyHint: true },
      execute: (input, options) => executeSafely(() => client.getCallResult(input as GetInquiryResultInput, executionSignal(options))),
    },
  ];
  return tools.filter(({ name }) => selected.has(name as InquiryToolName));
}

export async function registerCallBridgeWebMcpTools(input: {
  modelContext: WebMcpModelContext | undefined;
  client: InquiryToolClient;
  signal: AbortSignal;
  toolNames?: readonly InquiryToolName[];
}): Promise<{ supported: true; registered: readonly string[] } | { supported: false; error: InquiryWebMcpError }> {
  if (typeof input.modelContext?.registerTool !== "function") {
    return { supported: false, error: toInquiryWebMcpError({ code: "UNSUPPORTED_ENVIRONMENT" }) };
  }

  const registration = new AbortController();
  const abortRegistration = () => registration.abort(input.signal.reason);
  if (input.signal.aborted) abortRegistration();
  else input.signal.addEventListener("abort", abortRegistration, { once: true });

  const tools = callBridgeWebMcpTools(input.client, input.toolNames);
  try {
    for (const tool of tools) {
      await input.modelContext.registerTool(tool, { signal: registration.signal });
    }
  } catch (error) {
    registration.abort();
    return { supported: false, error: toInquiryWebMcpError(error) };
  }
  return { supported: true, registered: tools.map(({ name }) => name) };
}
