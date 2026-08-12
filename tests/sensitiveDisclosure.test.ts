import { describe, expect, it } from "vitest";

import {
  canConsumeDeliveryDisclosure,
  validateDeliveryDisclosure,
} from "../src/domain/sensitiveDisclosure.js";

describe("sensitive delivery disclosure", () => {
  it("permits only a present delivery instruction after an explicit recipient is named", () => {
    expect(
      validateDeliveryDisclosure({
        category: "delivery",
        kind: "intercom",
        recipientLabel: "Courier",
        value: "17B",
      }),
    ).toBe("17B");
  });

  it("fails closed for a non-delivery task or absent value", () => {
    expect(() =>
      validateDeliveryDisclosure({
        category: "accommodation",
        kind: "intercom",
        recipientLabel: "Courier",
        value: "17B",
      }),
    ).toThrow("Only delivery tasks");
    expect(() =>
      validateDeliveryDisclosure({
        category: "delivery",
        kind: "entry_instructions",
        recipientLabel: "Courier",
        value: undefined,
      }),
    ).toThrow("not available");
  });

  it("requires a fresh, single-use approval for the same revision and recipient", () => {
    expect(
      canConsumeDeliveryDisclosure({
        state: "approved",
        approvedRevision: 4,
        currentRevision: 4,
        approvedRecipientLabel: "Courier",
        recipientLabel: "Courier",
      }),
    ).toBe(true);
    expect(
      canConsumeDeliveryDisclosure({
        state: "approved",
        approvedRevision: 4,
        currentRevision: 5,
        approvedRecipientLabel: "Courier",
        recipientLabel: "Courier",
      }),
    ).toBe(false);
    expect(
      canConsumeDeliveryDisclosure({
        state: "consumed",
        approvedRevision: 4,
        currentRevision: 4,
        approvedRecipientLabel: "Courier",
        recipientLabel: "Courier",
      }),
    ).toBe(false);
  });
});
