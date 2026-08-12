import type {
  MorningBriefDeliveryPort,
  MorningBriefDeliveryReceipt,
} from "./ports.js";

/** Records completion without contacting any notification or messaging system. */
export class NoopMorningBriefDeliveryAdapter implements MorningBriefDeliveryPort {
  constructor(private readonly now: () => Date = () => new Date()) {}

  async deliver(): Promise<MorningBriefDeliveryReceipt> {
    return {
      adapter: "noop",
      completedAt: this.now().toISOString(),
      externalMessageId: null,
    };
  }
}
