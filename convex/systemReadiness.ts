import { internalQueryGeneric as internalQuery } from "convex/server";
import { v } from "convex/values";

import { launchReadiness } from "../src/application/launchReadiness.js";

const capabilityValidator = v.union(
  v.literal("convex"),
  v.literal("authentication"),
  v.literal("call_policy"),
  v.literal("billing_webhook"),
  v.literal("realtime"),
  v.literal("telephony"),
  v.literal("push_notifications"),
  v.literal("gmail"),
  v.literal("booking"),
  v.literal("public_contact_search"),
  v.literal("messaging_drafts"),
);

export const get = internalQuery({
  args: {},
  returns: v.object({
    readyForExternalEffects: v.boolean(),
    externalEffectsEnabled: v.boolean(),
    capabilities: v.array(v.object({
      capability: capabilityValidator,
      ready: v.boolean(),
      missing: v.array(v.string()),
      externallyEnabled: v.boolean(),
    })),
  }),
  handler: async () => launchReadiness(process.env),
});
