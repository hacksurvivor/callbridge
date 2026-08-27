import {
  INQUIRY_FORBIDDEN_ACTIONS,
  parseInquiryCallContract,
  type InquiryCallContract,
} from "./inquiryContracts.js";

export type InquiryDispatchRequest = {
  taskId: string;
  attemptId: string;
  ownerId: string;
  confirmedRevision: number;
  confirmedExecutionRevision: string;
  dispatchIdempotencyKey: string;
  contract: InquiryCallContract;
};

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required`);
  return value.trim();
}

export function validateInquiryDispatchRequest(input: unknown): InquiryDispatchRequest {
  if (!input || typeof input !== "object") throw new Error("Dispatch request is invalid");
  const value = input as Record<string, unknown>;
  const confirmedRevision = value.confirmedRevision;
  if (!Number.isInteger(confirmedRevision) || Number(confirmedRevision) < 1) {
    throw new Error("Confirmed revision is invalid");
  }
  const contract = parseInquiryCallContract(value.contract);
  if (
    contract.policy.authority !== "gather_information_only" ||
    contract.policy.maxAttempts !== 1 ||
    contract.policy.automaticRetry ||
    contract.policy.audioRecording
  ) {
    throw new Error("Inquiry authority is invalid");
  }
  if (
    contract.policy.forbiddenActions.length !== INQUIRY_FORBIDDEN_ACTIONS.length ||
    !INQUIRY_FORBIDDEN_ACTIONS.every((action) => contract.policy.forbiddenActions.includes(action))
  ) {
    throw new Error("Inquiry forbidden-action boundary is incomplete");
  }
  return {
    taskId: requiredText(value.taskId, "Task ID"),
    attemptId: requiredText(value.attemptId, "Attempt ID"),
    ownerId: requiredText(value.ownerId, "Owner ID"),
    confirmedRevision: Number(confirmedRevision),
    confirmedExecutionRevision: requiredText(value.confirmedExecutionRevision, "Confirmed execution revision"),
    dispatchIdempotencyKey: requiredText(value.dispatchIdempotencyKey, "Dispatch idempotency key"),
    contract,
  };
}
