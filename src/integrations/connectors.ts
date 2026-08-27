export type ConnectorProvider = "gmail" | "booking" | "public_contact_search" | "messaging";

export type SourceProvenance = {
  sourceUrl: string;
  retrievedAt: string;
  label: string;
};

export type PublicContactCandidate = {
  kind: "phone" | "email" | "website";
  value: string;
  verified: boolean;
  evidence: readonly SourceProvenance[];
};

/** Read-only by construction. There is deliberately no send or delete method. */
export interface GmailContextConnector {
  readPermittedThread(input: { ownerId: string; tokenReference: string; threadId: string }): Promise<{
    subject: string;
    messages: readonly { sender: string; receivedAt: string; text: string }[];
  }>;
}

/** Booking context is imported for reference only; mutations are outside this port. */
export interface BookingContextConnector {
  readPermittedBooking(input: { ownerId: string; tokenReference: string; bookingReference: string }): Promise<{
    provider: string;
    reference: string;
    facts: Readonly<Record<string, string>>;
  }>;
}

export interface PublicContactSearchConnector {
  search(input: { query: string; city?: string; country?: string }): Promise<readonly PublicContactCandidate[]>;
}

/** Messaging remains draft-only until a separate, revision-bound send authorization is designed. */
export interface MessagingDraftConnector {
  prepareDraft(input: { ownerId: string; recipientLabel: string; context: string }): Promise<{
    draftId: string;
    text: string;
  }>;
}
