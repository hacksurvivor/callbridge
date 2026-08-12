import type { AuthenticatedActor, CallTaskDraft } from "../domain/model.js";
import type { MorningBriefDeliveryPayload } from "../domain/morningBriefDelivery.js";

/** Adapter target for WorkOS AuthKit session/JWT verification. */
export interface IdentityProvider {
  authenticate(credential: string): Promise<AuthenticatedActor | null>;
}

export type CallEntitlement = {
  active: boolean;
  plan: string | null;
  validUntil: string | null;
};

/** Read model populated by verified, idempotently processed Lemon Squeezy webhooks. */
export interface EntitlementProvider {
  getCallEntitlement(userId: string): Promise<CallEntitlement>;
}

export type LemonSqueezyEntitlementEvent = {
  eventId: string;
  eventName:
    | "subscription_created"
    | "subscription_updated"
    | "subscription_cancelled"
    | "subscription_expired";
  externalCustomerId: string;
  externalSubscriptionId: string;
  status: string;
  renewsAt: string | null;
  endsAt: string | null;
  userId: string;
};

/**
 * Boundary for a server-only webhook adapter. Implementations must verify the
 * Lemon Squeezy signature over the unmodified body before parsing or returning an event.
 */
export interface EntitlementWebhookVerifier {
  verifyAndParse(input: {
    rawBody: Uint8Array;
    signature: string | null;
  }): Promise<LemonSqueezyEntitlementEvent>;
}

export interface EntitlementEventStore {
  applyOnce(event: LemonSqueezyEntitlementEvent): Promise<"applied" | "duplicate">;
}

export type RealtimeRuntime = {
  provider: string;
  model: string;
};

export const DEFAULT_REALTIME_RUNTIME: RealtimeRuntime = Object.freeze({
  provider: "openai_realtime",
  model: "gpt-realtime-2.1-mini",
});

export type OptionGatheringRequest = {
  taskId: string;
  ownerId: string;
  draft: CallTaskDraft;
  confirmation: {
    confirmedAt: string;
    confirmedRevision: number;
  };
  runtime: RealtimeRuntime;
  capability: "gather_options_only";
  forbiddenActions: readonly [
    "book",
    "pay",
    "accept_terms",
    "irreversible_commitment",
    "cancel",
  ];
};

/**
 * Future server-side OpenAI Realtime + telephony boundary. No client may invoke
 * it directly, and an implementation must reject any capability beyond inquiry.
 */
export interface OptionGatheringGateway {
  start(request: OptionGatheringRequest): Promise<{ externalSessionId: string }>;
}

export type MorningBriefDeliveryReceipt = {
  adapter: "noop";
  completedAt: string;
  externalMessageId: null;
};

/**
 * Server-only delivery boundary. The repository intentionally provides only a
 * no-op implementation; adding a live provider requires a separate change.
 */
export interface MorningBriefDeliveryPort {
  deliver(input: {
    deliveryId: string;
    deliveryKey: string;
    ownerId: string;
    payload: MorningBriefDeliveryPayload;
  }): Promise<MorningBriefDeliveryReceipt>;
}
