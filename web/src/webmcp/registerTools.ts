import {
  INQUIRY_TOOL_NAMES,
  inquiryToolInputSchemas,
  toInquiryWebMcpError,
  type CreateInquiryDraftInput,
  type GetInquiryResultInput,
  type GetInquiryResultOutput,
  type GetInquiryStatusInput,
  type GetInquiryStatusOutput,
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

export type WebMcpToolFailure = { ok: false; error: InquiryWebMcpError };

async function executeSafely<T>(operation: () => Promise<T>): Promise<T | WebMcpToolFailure> {
  try {
    return await operation();
  } catch (error) {
    return { ok: false, error: toInquiryWebMcpError(error) };
  }
}

export function callBridgeWebMcpTools(client: InquiryToolClient): WebMcpTool[] {
  return [
    {
      name: "create_call_draft",
      title: "Create an inquiry call draft",
      description: "Create a controlled information-gathering call draft for any destination, service, or inquiry. This changes page state but never confirms or starts a call.",
      inputSchema: inquiryToolInputSchemas.create_call_draft,
      annotations: { readOnlyHint: false },
      execute: (input, { signal }) => executeSafely(() => client.createCallDraft(input as CreateInquiryDraftInput, signal)),
    },
    {
      name: "update_call_draft",
      title: "Update an inquiry call draft",
      description: "Replace a call brief at an exact revision, including its objective, questions, shareable context, destination, languages, spending limit, or approved playbook. Material changes revoke pending confirmation and never start a call.",
      inputSchema: inquiryToolInputSchemas.update_call_draft,
      annotations: { readOnlyHint: false },
      execute: (input, { signal }) => executeSafely(() => client.updateCallDraft(input as UpdateInquiryDraftInput, signal)),
    },
    {
      name: "read_call_draft",
      title: "Read an inquiry call draft",
      description: "Read the signed-in person's current controlled inquiry, exact execution revision, and confirmation state.",
      inputSchema: inquiryToolInputSchemas.read_call_draft,
      annotations: { readOnlyHint: true },
      execute: (input, { signal }) => executeSafely(() => client.readCallDraft(input as ReadInquiryDraftInput, signal)),
    },
    {
      name: "get_call_status",
      title: "Read inquiry call status",
      description: "Read factual public Activity events for a controlled inquiry call after an optional sequence cursor.",
      inputSchema: inquiryToolInputSchemas.get_call_status,
      annotations: { readOnlyHint: true },
      execute: (input, { signal }) => executeSafely(() => client.getCallStatus(input as GetInquiryStatusInput, signal)),
    },
    {
      name: "get_call_result",
      title: "Read inquiry call result",
      description: "Read the evidence-bound result for a controlled inquiry call. It never returns hidden reasoning, a raw transcript, or audio.",
      inputSchema: inquiryToolInputSchemas.get_call_result,
      annotations: { readOnlyHint: true },
      execute: (input, { signal }) => executeSafely(() => client.getCallResult(input as GetInquiryResultInput, signal)),
    },
  ];
}

export async function registerCallBridgeWebMcpTools(input: {
  modelContext: WebMcpModelContext | undefined;
  client: InquiryToolClient;
  signal: AbortSignal;
}): Promise<{ supported: true; registered: readonly string[] } | { supported: false; error: InquiryWebMcpError }> {
  if (typeof input.modelContext?.registerTool !== "function") {
    return { supported: false, error: toInquiryWebMcpError({ code: "UNSUPPORTED_ENVIRONMENT" }) };
  }

  const tools = callBridgeWebMcpTools(input.client);
  for (const tool of tools) {
    await input.modelContext.registerTool(tool, { signal: input.signal });
  }
  return { supported: true, registered: INQUIRY_TOOL_NAMES };
}
