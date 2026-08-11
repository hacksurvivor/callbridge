export type DomainErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_FAILED"
  | "INVALID_TRANSITION"
  | "STALE_REVISION"
  | "CALL_WINDOW_CLOSED"
  | "ENTITLEMENT_REQUIRED";

export class DomainError extends Error {
  constructor(
    public readonly code: DomainErrorCode,
    message: string,
    public readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = "DomainError";
  }
}
