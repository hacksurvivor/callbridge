import { ConvexError, v } from "convex/values";

import { action } from "./_generated/server.js";
import { assertConnectorActionAllowed } from "../src/application/connectorPolicy.js";
import { assertCapabilityEnabled } from "../src/application/launchReadiness.js";
import { searchPublicContactsWithOpenAI } from "../src/integrations/openAiPublicContactSearch.js";

export const search = action({
  args: { query: v.string(), city: v.optional(v.string()), country: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    assertConnectorActionAllowed("public_contact_search", "search_public_sources");
    assertCapabilityEnabled("public_contact_search", process.env);
    return await searchPublicContactsWithOpenAI({
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.CALLBRIDGE_CONTACT_SEARCH_MODEL ?? "",
      query: args.query,
      ...(args.city ? { city: args.city } : {}),
      ...(args.country ? { country: args.country } : {}),
      safetyIdentifier: identity.subject,
    });
  },
});
