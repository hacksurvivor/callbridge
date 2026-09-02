import { isPlausibleTaskId, readTaskIdFromLocation } from "./convex/inquiryClient.js";

export function currentAuthReturnPath(location: Location = window.location): string {
  const taskId = readTaskIdFromLocation(location);
  return taskId ? `/callback?task=${encodeURIComponent(taskId)}` : "/callback";
}

export function validatedAuthReturnPath(state: unknown, origin: string): string | null {
  if (!state || typeof state !== "object") return null;
  const returnTo = (state as { returnTo?: unknown }).returnTo;
  if (typeof returnTo !== "string") return null;
  let url: URL;
  try {
    url = new URL(returnTo, origin);
  } catch {
    return null;
  }
  if (url.origin !== origin || url.pathname !== "/callback") return null;
  const taskId = url.searchParams.get("task");
  if (taskId === null) return "/callback";
  return isPlausibleTaskId(taskId) ? `/callback?task=${encodeURIComponent(taskId)}` : null;
}
