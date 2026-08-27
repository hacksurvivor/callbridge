import type { CallTaskDraft } from "./model.js";

/**
 * Removes user content while preserving only the policy fields needed to prove
 * what authority the task did and did not have. The sentinel source keeps old
 * task documents schema-valid without retaining the original request.
 */
export function purgeTaskDraft(draft: CallTaskDraft): CallTaskDraft {
  return {
    category: draft.category,
    title: "Deleted task",
    sources: { typedContext: "[deleted]" },
    target: { contacts: [] },
    details: {},
    questions: [],
    autonomy: draft.autonomy,
    memory: draft.memory,
    callWindow: draft.callWindow,
    permissions: draft.permissions,
  };
}
