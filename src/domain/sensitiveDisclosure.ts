import { DomainError } from "./errors.js";

export const DELIVERY_DISCLOSURE_KINDS = [
  "entry_instructions",
  "intercom",
] as const;

export type DeliveryDisclosureKind = (typeof DELIVERY_DISCLOSURE_KINDS)[number];

export function validateDeliveryDisclosure(input: {
  category: string;
  kind: DeliveryDisclosureKind;
  recipientLabel: string;
  value: string | undefined;
}): string {
  if (input.category !== "delivery") {
    throw new DomainError("VALIDATION_FAILED", "Only delivery tasks can disclose delivery instructions");
  }
  if (!input.recipientLabel.trim()) {
    throw new DomainError("VALIDATION_FAILED", "A recipient label is required");
  }
  if (!input.value?.trim()) {
    throw new DomainError("VALIDATION_FAILED", "The requested instruction is not available");
  }
  return input.value;
}

/** A consent is single-use and tied to the exact reviewed task revision. */
export function canConsumeDeliveryDisclosure(input: {
  state: "approved" | "consumed" | "revoked";
  approvedRevision: number;
  currentRevision: number;
  approvedRecipientLabel: string;
  recipientLabel: string;
}): boolean {
  return (
    input.state === "approved" &&
    input.approvedRevision === input.currentRevision &&
    input.approvedRecipientLabel === input.recipientLabel
  );
}
