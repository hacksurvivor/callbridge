import { DomainError } from "./errors.js";

const EXPO_PUSH_TOKEN = /^(?:ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]{10,200}\]$/;

export function validateExpoPushToken(value: string): string {
  const token = value.trim();
  if (!EXPO_PUSH_TOKEN.test(token)) {
    throw new DomainError("VALIDATION_FAILED", "Push token is invalid");
  }
  return token;
}
