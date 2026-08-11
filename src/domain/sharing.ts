import type { CallTaskDraft } from "./model.js";

export const FRIENDLY_PERMISSION_LEVELS = [
  "manage_everything",
  "help_with_tasks",
  "view_updates",
] as const;

export type FriendlyPermissionLevel = (typeof FRIENDLY_PERMISSION_LEVELS)[number];

export const FRIENDLY_PERMISSION_LABELS: Record<FriendlyPermissionLevel, string> = {
  manage_everything: "Can manage everything",
  help_with_tasks: "Can help with tasks",
  view_updates: "Can only view updates",
};

export type HistoryVisibility = "full_history" | "new_updates_only";
export type NotificationPreference = "push" | "monitor_only";

export type InviteSettings = {
  permissionLevel: FriendlyPermissionLevel;
  historyVisibility: HistoryVisibility;
  transcriptAccess: boolean;
  receivesApprovalRequests: boolean;
};

export type TaskShareSettings = InviteSettings & {
  notificationPreference: NotificationPreference;
};

export type SharedTaskAction =
  | "view"
  | "edit"
  | "confirm"
  | "share"
  | "change_household";

export function canPerformSharedTaskAction(
  permissionLevel: FriendlyPermissionLevel,
  action: SharedTaskAction,
): boolean {
  if (permissionLevel === "manage_everything") return true;
  if (permissionLevel === "help_with_tasks") {
    return action === "view" || action === "edit" || action === "confirm";
  }
  return action === "view";
}

export function redactDraftForShare(
  draft: CallTaskDraft,
  transcriptAccess: boolean,
): CallTaskDraft {
  const visible = structuredClone(draft);
  if (transcriptAccess) return visible;
  delete visible.sources.transcript;
  if (visible.sources.voiceNote) delete visible.sources.voiceNote.transcript;
  if (visible.sources.screenshot) delete visible.sources.screenshot.extractedText;
  return visible;
}

/**
 * Friendly task permissions never imply financial or legal authority. Those
 * capabilities do not exist in the shared-access model at any level.
 */
export function sharedAccessNeverGrantsCommitmentAuthority(): true {
  return true;
}
