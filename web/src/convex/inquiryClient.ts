import type { ConvexReactClient } from "convex/react";
import { makeFunctionReference } from "convex/server";

import {
  INQUIRY_CONTRACT_SCHEMA_VERSION,
  parseInquiryCallContract,
  type InquiryExecutionRevision,
} from "../../../shared/inquiryContracts.js";
import type {
  CreateInquiryDraftInput,
  GetInquiryResultOutput,
  GetInquiryStatusOutput,
  InquiryActivityEvent,
  UpdateInquiryDraftOutput,
} from "../../../shared/inquiryWebMcp.js";
import type { InquiryTaskSnapshot } from "../../../shared/inquiryState.js";
import type { InquiryPricingQuote } from "../../../shared/inquiryPricing.js";
import {
  type TaskArtifact,
} from "../../../shared/taskArtifacts.js";
import type { InquiryToolClient } from "../webmcp/registerTools.js";

type CreateDraftArgs = { idempotencyKey: string; contract: unknown };
type UpdateDraftArgs = { taskId: string; expectedRevision: number; contract: unknown };
type ReadDraftArgs = { taskId: string };
type CreateConfirmationIntentArgs = {
  taskId: string;
  expectedRevision: number;
  expectedExecutionRevision: string;
  idempotencyKey: string;
};
type CreateConfirmationIntentOutput = {
  intentId: string;
  expiresAt: string;
  executionRevision: string;
  pricingQuoteId: string;
};
type QuoteCallArgs = { taskId: string; expectedRevision: number; expectedExecutionRevision: string };
type ConfirmAndQueueArgs = CreateConfirmationIntentArgs & { confirmationIntentId: string };
type ConfirmAndQueueOutput = {
  taskId: string;
  attemptId: string;
  reservationId: string;
  revision: number;
  executionRevision: string;
  taskStatus: "confirmed";
  attemptStatus: "queued";
};
type ListEventsArgs = { taskId: string; afterSequence?: number };
type GetResultArgs = { taskId: string };
type SubmitUserQuestionResponseArgs = {
  taskId: string;
  artifactId: string;
  expectedArtifactRevision: number;
  idempotencyKey: string;
  value: string | string[];
};
type BeginControlledFixtureArgs = { taskId: string; expectedTaskRevision: number; idempotencyKey: string };
type CompleteControlledFixtureAuthorizationArgs = {
  taskId: string;
  artifactId: string;
  expectedArtifactRevision: number;
  idempotencyKey: string;
};
type AttachControlledFixtureEvidenceArgs = { taskId: string; idempotencyKey: string };
const createDraftRef = makeFunctionReference<"mutation", CreateDraftArgs, InquiryTaskSnapshot>("inquiries:createDraft");
const updateDraftRef = makeFunctionReference<"mutation", UpdateDraftArgs, UpdateInquiryDraftOutput>("inquiries:updateDraft");
const readDraftRef = makeFunctionReference<"query", ReadDraftArgs, InquiryTaskSnapshot>("inquiries:readDraft");
const listDraftsRef = makeFunctionReference<"query", Record<string, never>, InquiryTaskSnapshot[]>("inquiries:listMine");
const createConfirmationIntentRef = makeFunctionReference<"mutation", CreateConfirmationIntentArgs, CreateConfirmationIntentOutput>("inquiries:createConfirmationIntent");
const quoteCallRef = makeFunctionReference<"action", QuoteCallArgs, InquiryPricingQuote>("inquiryPricing:quoteCall");
const confirmAndQueueRef = makeFunctionReference<"mutation", ConfirmAndQueueArgs, ConfirmAndQueueOutput>("inquiries:confirmAndQueue");
const listEventsRef = makeFunctionReference<"query", ListEventsArgs, InquiryActivityEvent[]>("inquiries:listEvents");
const getResultRef = makeFunctionReference<"query", GetResultArgs, GetInquiryResultOutput>("inquiries:getResult");
const submitUserQuestionResponseRef = makeFunctionReference<"mutation", SubmitUserQuestionResponseArgs, TaskArtifact>("taskArtifacts:submitUserQuestionResponse");
const beginControlledFixtureRef = makeFunctionReference<"mutation", BeginControlledFixtureArgs, TaskArtifact>("taskArtifacts:beginControlledFixture");
const completeControlledFixtureAuthorizationRef = makeFunctionReference<"mutation", CompleteControlledFixtureAuthorizationArgs, TaskArtifact>("taskArtifacts:completeControlledFixtureAuthorization");
const attachControlledFixtureEvidenceRef = makeFunctionReference<"mutation", AttachControlledFixtureEvidenceArgs, TaskArtifact>("taskArtifacts:attachControlledFixtureEvidence");

function assertNotAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("The WebMCP request was aborted.", "AbortError");
}

function assertSchemaVersion(value: unknown): void {
  if (value !== INQUIRY_CONTRACT_SCHEMA_VERSION) throw { code: "INVALID_INPUT" };
}

export function isPlausibleTaskId(value: string | null): value is string {
  return value !== null && value.length >= 8 && value.length <= 128 && /^[A-Za-z0-9_-]+$/.test(value);
}

export function readTaskIdFromLocation(location?: Location): string | null {
  const currentLocation = location
    ?? (typeof window === "undefined" ? null : window.location);
  if (!currentLocation) return null;
  const candidate = new URL(currentLocation.href).searchParams.get("task");
  return isPlausibleTaskId(candidate) ? candidate : null;
}

export function persistTaskIdInLocation(taskId: string): void {
  if (!isPlausibleTaskId(taskId)) return;
  const url = new URL(window.location.href);
  url.searchParams.set("task", taskId);
  window.history.replaceState(window.history.state, "", url);
}

export function createConvexInquiryClient(input: {
  convex: ConvexReactClient;
  onDraft: (draft: InquiryTaskSnapshot) => void;
}): InquiryToolClient {
  const acceptDraft = (draft: InquiryTaskSnapshot) => {
    input.onDraft(draft);
    persistTaskIdInLocation(draft.taskId);
  };

  return {
    async createCallDraft(args: CreateInquiryDraftInput, signal) {
      assertSchemaVersion(args.schemaVersion);
      const contract = parseInquiryCallContract(args.contract);
      assertNotAborted(signal);
      const result = await input.convex.mutation(createDraftRef, {
        idempotencyKey: args.idempotencyKey,
        contract,
      });
      assertNotAborted(signal);
      acceptDraft(result);
      return result;
    },
    async updateCallDraft(args, signal) {
      assertSchemaVersion(args.schemaVersion);
      const contract = parseInquiryCallContract(args.contract);
      assertNotAborted(signal);
      const result = await input.convex.mutation(updateDraftRef, {
        taskId: args.taskId,
        expectedRevision: args.expectedRevision,
        contract,
      });
      assertNotAborted(signal);
      acceptDraft(result.task);
      return result;
    },
    async readCallDraft(args, signal) {
      assertSchemaVersion(args.schemaVersion);
      assertNotAborted(signal);
      const result = await input.convex.query(readDraftRef, { taskId: args.taskId });
      assertNotAborted(signal);
      acceptDraft(result);
      return result;
    },
    async getCallStatus(args, signal): Promise<GetInquiryStatusOutput> {
      assertSchemaVersion(args.schemaVersion);
      assertNotAborted(signal);
      const [task, events] = await Promise.all([
        input.convex.query(readDraftRef, { taskId: args.taskId }),
        input.convex.query(listEventsRef, {
          taskId: args.taskId,
          ...(args.afterSequence === undefined ? {} : { afterSequence: args.afterSequence }),
        }),
      ]);
      assertNotAborted(signal);
      return {
        taskId: task.taskId,
        taskStatus: task.status,
        events,
        nextSequence: events.at(-1)?.sequence ?? null,
      };
    },
    async getCallResult(args, signal): Promise<GetInquiryResultOutput> {
      assertSchemaVersion(args.schemaVersion);
      assertNotAborted(signal);
      const result = await input.convex.query(getResultRef, { taskId: args.taskId });
      assertNotAborted(signal);
      return result;
    },
  };
}

export async function listInquiryTasks(convex: ConvexReactClient): Promise<InquiryTaskSnapshot[]> {
  return convex.query(listDraftsRef, {});
}

export async function submitArtifactQuestionResponse(input: {
  convex: ConvexReactClient;
  artifact: TaskArtifact;
  value: string | string[];
}): Promise<TaskArtifact> {
  return input.convex.mutation(submitUserQuestionResponseRef, {
    taskId: input.artifact.taskId,
    artifactId: input.artifact.artifactId,
    expectedArtifactRevision: input.artifact.revision,
    idempotencyKey: `question-response-${crypto.randomUUID()}`,
    value: input.value,
  });
}

export async function beginArtifactFixture(input: {
  convex: ConvexReactClient;
  draft: InquiryTaskSnapshot;
}): Promise<TaskArtifact> {
  return input.convex.mutation(beginControlledFixtureRef, {
    taskId: input.draft.taskId,
    expectedTaskRevision: input.draft.revision,
    idempotencyKey: `artifact-fixture-${input.draft.taskId}`,
  });
}

export async function completeArtifactFixtureAuthorization(input: {
  convex: ConvexReactClient;
  artifact: TaskArtifact;
}): Promise<TaskArtifact> {
  return input.convex.mutation(completeControlledFixtureAuthorizationRef, {
    taskId: input.artifact.taskId,
    artifactId: input.artifact.artifactId,
    expectedArtifactRevision: input.artifact.revision,
    idempotencyKey: `fixture-auth-${input.artifact.artifactId}`,
  });
}

export async function attachArtifactFixtureEvidence(input: {
  convex: ConvexReactClient;
  taskId: string;
}): Promise<TaskArtifact> {
  return input.convex.mutation(attachControlledFixtureEvidenceRef, {
    taskId: input.taskId,
    idempotencyKey: `fixture-evidence-${input.taskId}`,
  });
}

export type PreparedConfirmationIntent = {
  intentId: string;
  taskId: string;
  revision: number;
  executionRevision: InquiryExecutionRevision;
  expiresAt: string;
  pricingQuoteId: string;
};

export async function prepareInquiryConfirmation(input: {
  convex: ConvexReactClient;
  draft: InquiryTaskSnapshot;
}): Promise<{ draft: InquiryTaskSnapshot; intent: PreparedConfirmationIntent }> {
  let pricedDraft = input.draft;
  if (
    pricedDraft.pricing.status !== "ready"
    || new Date(pricedDraft.pricing.quote.quote.expiresAt) <= new Date()
  ) {
    await input.convex.action(quoteCallRef, {
      taskId: pricedDraft.taskId,
      expectedRevision: pricedDraft.revision,
      expectedExecutionRevision: pricedDraft.executionRevision,
    });
    pricedDraft = await input.convex.query(readDraftRef, { taskId: pricedDraft.taskId });
  }
  const intent = await input.convex.mutation(createConfirmationIntentRef, {
    taskId: pricedDraft.taskId,
    expectedRevision: pricedDraft.revision,
    expectedExecutionRevision: pricedDraft.executionRevision,
    idempotencyKey: `intent-${crypto.randomUUID()}`,
  });
  const refreshed = await input.convex.query(readDraftRef, { taskId: pricedDraft.taskId });
  return {
    draft: refreshed,
    intent: {
      intentId: intent.intentId,
      taskId: pricedDraft.taskId,
      revision: pricedDraft.revision,
      executionRevision: intent.executionRevision as InquiryExecutionRevision,
      expiresAt: intent.expiresAt,
      pricingQuoteId: intent.pricingQuoteId,
    },
  };
}

export async function confirmInquiryTask(input: {
  convex: ConvexReactClient;
  draft: InquiryTaskSnapshot;
  intent: PreparedConfirmationIntent;
}): Promise<InquiryTaskSnapshot> {
  if (
    input.intent.taskId !== input.draft.taskId
    || input.intent.revision !== input.draft.revision
    || input.intent.executionRevision !== input.draft.executionRevision
    || input.draft.pricing.status !== "ready"
    || input.intent.pricingQuoteId !== input.draft.pricing.quote.quoteId
    || new Date(input.intent.expiresAt) <= new Date()
  ) {
    throw { code: "INTENT_EXPIRED" };
  }
  await input.convex.mutation(confirmAndQueueRef, {
    taskId: input.draft.taskId,
    expectedRevision: input.draft.revision,
    expectedExecutionRevision: input.draft.executionRevision,
    confirmationIntentId: input.intent.intentId,
    idempotencyKey: `confirm-${crypto.randomUUID()}`,
  });
  return input.convex.query(readDraftRef, { taskId: input.draft.taskId });
}
