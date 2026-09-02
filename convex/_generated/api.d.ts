/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as bookingContext from "../bookingContext.js";
import type * as callTasks from "../callTasks.js";
import type * as cancellations from "../cancellations.js";
import type * as categoryAutomationPreferences from "../categoryAutomationPreferences.js";
import type * as communicationPreferences from "../communicationPreferences.js";
import type * as crons from "../crons.js";
import type * as entitlements from "../entitlements.js";
import type * as gmailOAuth from "../gmailOAuth.js";
import type * as hotelDemo from "../hotelDemo.js";
import type * as hotelDemoContracts from "../hotelDemoContracts.js";
import type * as hotelDemoEvents from "../hotelDemoEvents.js";
import type * as hotelDemoPricing from "../hotelDemoPricing.js";
import type * as hotelDemoResults from "../hotelDemoResults.js";
import type * as hotelDemoRetention from "../hotelDemoRetention.js";
import type * as hotelDemoValidators from "../hotelDemoValidators.js";
import type * as hotelDemoWebhook from "../hotelDemoWebhook.js";
import type * as households from "../households.js";
import type * as http from "../http.js";
import type * as inquiries from "../inquiries.js";
import type * as inquiryDispatch from "../inquiryDispatch.js";
import type * as inquiryDispatchWorker from "../inquiryDispatchWorker.js";
import type * as inquiryPricing from "../inquiryPricing.js";
import type * as inquiryValidators from "../inquiryValidators.js";
import type * as inquiryWorkerWebhook from "../inquiryWorkerWebhook.js";
import type * as lemonSqueezyWebhook from "../lemonSqueezyWebhook.js";
import type * as maintenance from "../maintenance.js";
import type * as messageDrafts from "../messageDrafts.js";
import type * as morningBriefDeliveries from "../morningBriefDeliveries.js";
import type * as notificationOutbox from "../notificationOutbox.js";
import type * as notificationWorker from "../notificationWorker.js";
import type * as optionGathering from "../optionGathering.js";
import type * as optionGatheringJobs from "../optionGatheringJobs.js";
import type * as optionGatheringRequests from "../optionGatheringRequests.js";
import type * as optionGatheringWorker from "../optionGatheringWorker.js";
import type * as postStayReviews from "../postStayReviews.js";
import type * as proactiveFindings from "../proactiveFindings.js";
import type * as publicContactSearch from "../publicContactSearch.js";
import type * as pushSubscriptions from "../pushSubscriptions.js";
import type * as relationshipMemories from "../relationshipMemories.js";
import type * as remoteBridge from "../remoteBridge.js";
import type * as retries from "../retries.js";
import type * as sensitiveDisclosures from "../sensitiveDisclosures.js";
import type * as systemReadiness from "../systemReadiness.js";
import type * as taskActivityEvents from "../taskActivityEvents.js";
import type * as taskLifecycle from "../taskLifecycle.js";
import type * as taskSharing from "../taskSharing.js";
import type * as taskTranscripts from "../taskTranscripts.js";
import type * as telephonyWebhook from "../telephonyWebhook.js";
import type * as travelerGroups from "../travelerGroups.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  bookingContext: typeof bookingContext;
  callTasks: typeof callTasks;
  cancellations: typeof cancellations;
  categoryAutomationPreferences: typeof categoryAutomationPreferences;
  communicationPreferences: typeof communicationPreferences;
  crons: typeof crons;
  entitlements: typeof entitlements;
  gmailOAuth: typeof gmailOAuth;
  hotelDemo: typeof hotelDemo;
  hotelDemoContracts: typeof hotelDemoContracts;
  hotelDemoEvents: typeof hotelDemoEvents;
  hotelDemoPricing: typeof hotelDemoPricing;
  hotelDemoResults: typeof hotelDemoResults;
  hotelDemoRetention: typeof hotelDemoRetention;
  hotelDemoValidators: typeof hotelDemoValidators;
  hotelDemoWebhook: typeof hotelDemoWebhook;
  households: typeof households;
  http: typeof http;
  inquiries: typeof inquiries;
  inquiryDispatch: typeof inquiryDispatch;
  inquiryDispatchWorker: typeof inquiryDispatchWorker;
  inquiryPricing: typeof inquiryPricing;
  inquiryValidators: typeof inquiryValidators;
  inquiryWorkerWebhook: typeof inquiryWorkerWebhook;
  lemonSqueezyWebhook: typeof lemonSqueezyWebhook;
  maintenance: typeof maintenance;
  messageDrafts: typeof messageDrafts;
  morningBriefDeliveries: typeof morningBriefDeliveries;
  notificationOutbox: typeof notificationOutbox;
  notificationWorker: typeof notificationWorker;
  optionGathering: typeof optionGathering;
  optionGatheringJobs: typeof optionGatheringJobs;
  optionGatheringRequests: typeof optionGatheringRequests;
  optionGatheringWorker: typeof optionGatheringWorker;
  postStayReviews: typeof postStayReviews;
  proactiveFindings: typeof proactiveFindings;
  publicContactSearch: typeof publicContactSearch;
  pushSubscriptions: typeof pushSubscriptions;
  relationshipMemories: typeof relationshipMemories;
  remoteBridge: typeof remoteBridge;
  retries: typeof retries;
  sensitiveDisclosures: typeof sensitiveDisclosures;
  systemReadiness: typeof systemReadiness;
  taskActivityEvents: typeof taskActivityEvents;
  taskLifecycle: typeof taskLifecycle;
  taskSharing: typeof taskSharing;
  taskTranscripts: typeof taskTranscripts;
  telephonyWebhook: typeof telephonyWebhook;
  travelerGroups: typeof travelerGroups;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
