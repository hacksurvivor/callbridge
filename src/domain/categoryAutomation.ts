import type { TaskCategory } from "./model.js";

export type CategoryAutomationPreference = {
  category: TaskCategory;
  backgroundSearchEnabled: boolean;
  notificationsEnabled: boolean;
};

export function validateCategoryAutomationPreference(
  value: CategoryAutomationPreference,
): CategoryAutomationPreference {
  if (typeof value.backgroundSearchEnabled !== "boolean" || typeof value.notificationsEnabled !== "boolean") {
    throw new Error("Search and notification preferences must be explicit booleans");
  }
  return value;
}

export function maySearchInBackground(value: CategoryAutomationPreference | undefined): boolean {
  return value?.backgroundSearchEnabled ?? false;
}

export function mayNotifyAboutFinding(value: CategoryAutomationPreference | undefined): boolean {
  return value?.notificationsEnabled ?? false;
}
