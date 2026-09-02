import type { GetInquiryResultOutput, InquiryActivityEvent } from "../../shared/inquiryWebMcp.js";
import type { InquiryTaskStatus } from "../../shared/inquiryState.js";

const TERMINAL_TASK_STATUSES = new Set<InquiryTaskStatus>(["completed", "partial", "failed", "stopped"]);

export function mergeInquiryActivity(
  current: readonly InquiryActivityEvent[],
  incoming: readonly InquiryActivityEvent[],
): InquiryActivityEvent[] {
  if (!incoming.length) return [...current];
  const byId = new Map(current.map((event) => [event.eventId, event]));
  for (const event of incoming) byId.set(event.eventId, event);
  return [...byId.values()].sort((left, right) => left.sequence - right.sequence);
}

export function nextRefreshFailureCount(current: number, successfulReads: number): number {
  return successfulReads > 0 ? 0 : current + 1;
}

export function shouldStopInquiryPolling(
  status: InquiryTaskStatus,
  result: GetInquiryResultOutput,
): boolean {
  return TERMINAL_TASK_STATUSES.has(status) && result.status === "ready";
}
