import type { ConnectorProvider } from "../integrations/connectors.js";

export type ConnectorAction =
  | "read_permitted_context"
  | "search_public_sources"
  | "prepare_draft"
  | "send_message"
  | "change_booking"
  | "cancel_booking";

const ALLOWED: Readonly<Record<ConnectorProvider, readonly ConnectorAction[]>> = {
  gmail: ["read_permitted_context"],
  booking: ["read_permitted_context"],
  public_contact_search: ["search_public_sources"],
  messaging: ["prepare_draft"],
};

export function assertConnectorActionAllowed(provider: ConnectorProvider, action: ConnectorAction): void {
  if (!ALLOWED[provider].includes(action)) {
    throw new Error(`${provider} cannot perform ${action} in the current CallBridge scope`);
  }
}
