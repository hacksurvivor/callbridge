import type {
  MorningBriefPreparationInput,
  MorningBriefDeliveryPayload,
} from "../domain/morningBriefDelivery.js";
import type {
  MorningBriefDeliveryPort,
  MorningBriefDeliveryReceipt,
} from "../integrations/ports.js";

export type StoredMorningBriefPreparation =
  | { kind: "skipped"; reason: string }
  | { kind: "duplicate"; deliveryId: string }
  | {
      kind: "prepared";
      deliveryId: string;
      deliveryKey: string;
      ownerId: string;
      payload: MorningBriefDeliveryPayload;
    };

export interface MorningBriefDeliveryStore {
  prepareOnce(input: MorningBriefPreparationInput): Promise<StoredMorningBriefPreparation>;
  recordNoopReceipt(input: {
    deliveryId: string;
    deliveryKey: string;
    ownerId: string;
    receipt: MorningBriefDeliveryReceipt;
  }): Promise<"recorded" | "duplicate">;
}

export type MorningBriefDeliveryRunResult =
  | Exclude<StoredMorningBriefPreparation, { kind: "prepared" }>
  | { kind: "completed_noop"; deliveryId: string; receipt: MorningBriefDeliveryReceipt };

/**
 * Claims preparation before invoking the adapter. A duplicate claim never
 * reaches the adapter, including when a previous attempt stopped before its
 * receipt was recorded.
 */
export async function runMorningBriefDelivery(input: {
  store: MorningBriefDeliveryStore;
  adapter: MorningBriefDeliveryPort;
  candidate: MorningBriefPreparationInput;
}): Promise<MorningBriefDeliveryRunResult> {
  const preparation = await input.store.prepareOnce(input.candidate);
  if (preparation.kind !== "prepared") return preparation;

  const receipt = await input.adapter.deliver({
    deliveryId: preparation.deliveryId,
    deliveryKey: preparation.deliveryKey,
    ownerId: preparation.ownerId,
    payload: preparation.payload,
  });
  await input.store.recordNoopReceipt({
    deliveryId: preparation.deliveryId,
    deliveryKey: preparation.deliveryKey,
    ownerId: preparation.ownerId,
    receipt,
  });
  return { kind: "completed_noop", deliveryId: preparation.deliveryId, receipt };
}
