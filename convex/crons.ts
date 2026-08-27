import { cronJobs, makeFunctionReference } from "convex/server";

const crons = cronJobs();
const runMaintenance = makeFunctionReference<
  "action",
  {},
  { ownersChecked: number; briefsQueued: number; briefFailures: number; tasksPurged: number; messageDraftsPurged: number; reviewPromptsQueued: number; optionGatheringRetriesScheduled: number; notificationDispatchScheduled: boolean }
>("maintenance:runTick");
const runHotelDemoRetention = makeFunctionReference<"action", {}, { deleted: number; overdueCount: number; healthy: boolean }>("hotelDemoRetention:run");

crons.interval("callbridge maintenance", { minutes: 5 }, runMaintenance, {});
crons.interval("hotel demo retention", { minutes: 5 }, runHotelDemoRetention, {});

export default crons;
