import { makeFunctionReference } from "convex/server";

import { convexClient, isConvexConfigured } from "./convex-client";

export type RemoteCallTaskDraft = {
  category: "accommodation" | "restaurant" | "service" | "transport" | "delivery" | "marketplace" | "property" | "vehicle" | "other";
  title: string;
  sources: { typedContext: string };
  target: { contacts: Array<never> };
  details: Record<string, string | number | boolean | string[]>;
  questions: string[];
  userLanguage: string;
  locale: string;
  autonomy: {
    fullAccess: boolean;
    automaticallyTryNextVerifiedNumber: boolean;
    automaticallyRetryUnavailableNumber: boolean;
    retryDelayMinutes: 5;
    maxAutomaticRetriesPerNumber: 2;
    mentionPastVisits: boolean;
    useCompetitorPricing: boolean;
    nameCompetitorAndExactPrice: boolean;
  };
  memory: { mode: "save_for_30_days"; retainForDays: 30 };
  callWindow: {
    timeZone: string;
    days: Array<"mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun">;
    opensAt: string;
    closesAt: string;
  };
  permissions: {
    scope: "gather_options_only";
    mayShareProvidedDetails: boolean;
    mayBook: false;
    mayPay: false;
    mayAcceptTerms: false;
    mayMakeIrreversibleCommitment: false;
    mayCancel: false;
  };
};

const createTask = makeFunctionReference<"mutation", { draft: RemoteCallTaskDraft }, string>("callTasks:create");
const confirmTask = makeFunctionReference<"mutation", { taskId: string; expectedRevision: number; noSaveModeAcknowledged: boolean }, string>("callTasks:confirm");
const stopTask = makeFunctionReference<"mutation", { taskId: string }, string>("retries:stop");

/**
 * Remote task state is opt-in until a deployed Convex project and an
 * authenticated application identity exist. The additional flag prevents a
 * pasted URL from starting external mutations accidentally during setup.
 */
export const isRemoteTaskSyncEnabled = isConvexConfigured && process.env.EXPO_PUBLIC_ENABLE_REMOTE_SYNC === "true";

export function buildDraftFromRequest(request: string): RemoteCallTaskDraft {
  const normalized = request.trim();
  const lower = normalized.toLowerCase();
  const category = lower.includes("courier") || lower.includes("delivery")
    ? "delivery"
    : lower.includes("restaurant") || lower.includes("table") || lower.includes("dinner")
      ? "restaurant"
      : lower.includes("hotel") || lower.includes("stay") || lower.includes("room")
        ? "accommodation"
        : lower.includes("car") || lower.includes("vehicle")
          ? "vehicle"
          : lower.includes("buy") || lower.includes("seller") || lower.includes("market")
            ? "marketplace"
            : "other";
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

  return {
    category,
    title: normalized.slice(0, 300),
    sources: { typedContext: normalized },
    target: { contacts: [] },
    details: {},
    questions: [],
    userLanguage: "en",
    locale: "en",
    autonomy: {
      fullAccess: false,
      automaticallyTryNextVerifiedNumber: false,
      automaticallyRetryUnavailableNumber: false,
      retryDelayMinutes: 5,
      maxAutomaticRetriesPerNumber: 2,
      mentionPastVisits: false,
      useCompetitorPricing: false,
      nameCompetitorAndExactPrice: false,
    },
    memory: { mode: "save_for_30_days", retainForDays: 30 },
    callWindow: { timeZone, days: ["mon", "tue", "wed", "thu", "fri", "sat", "sun"], opensAt: "08:00", closesAt: "22:00" },
    permissions: {
      scope: "gather_options_only",
      mayShareProvidedDetails: true,
      mayBook: false,
      mayPay: false,
      mayAcceptTerms: false,
      mayMakeIrreversibleCommitment: false,
      mayCancel: false,
    },
  };
}

function remoteClient() {
  if (!isRemoteTaskSyncEnabled || !convexClient) {
    throw new Error("Remote sync is not enabled");
  }
  return convexClient;
}

export const convexTaskGateway = {
  async create(draft: RemoteCallTaskDraft): Promise<string> {
    return await remoteClient().mutation(createTask, { draft });
  },
  async confirm(taskId: string, expectedRevision: number): Promise<string> {
    return await remoteClient().mutation(confirmTask, { taskId, expectedRevision, noSaveModeAcknowledged: false });
  },
  async stop(taskId: string): Promise<string> {
    return await remoteClient().mutation(stopTask, { taskId });
  },
};
