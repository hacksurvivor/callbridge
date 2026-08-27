import { describe, expect, it } from "vitest";

import { assertConnectorActionAllowed } from "../src/application/connectorPolicy.js";

describe("connector authority", () => {
  it("allows context reads, public search and message drafts", () => {
    expect(() => assertConnectorActionAllowed("gmail", "read_permitted_context")).not.toThrow();
    expect(() => assertConnectorActionAllowed("public_contact_search", "search_public_sources")).not.toThrow();
    expect(() => assertConnectorActionAllowed("messaging", "prepare_draft")).not.toThrow();
  });

  it("structurally rejects sends, booking changes and cancellations", () => {
    expect(() => assertConnectorActionAllowed("gmail", "send_message")).toThrow("cannot perform");
    expect(() => assertConnectorActionAllowed("booking", "change_booking")).toThrow("cannot perform");
    expect(() => assertConnectorActionAllowed("booking", "cancel_booking")).toThrow("cannot perform");
  });
});
