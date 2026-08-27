import { ConvexError, v } from "convex/values";

import { action } from "./_generated/server.js";
import { assertConnectorActionAllowed } from "../src/application/connectorPolicy.js";
import { readBookingDemandAccommodation } from "../src/integrations/bookingDemand.js";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export const readPermittedAccommodation = action({
  args: { bookingReference: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
    assertConnectorActionAllowed("booking", "read_permitted_context");
    return await readBookingDemandAccommodation({
      config: {
        apiKey: required("BOOKING_DEMAND_API_KEY"),
        affiliateId: required("BOOKING_AFFILIATE_ID"),
        environment: process.env.BOOKING_DEMAND_ENVIRONMENT === "production" ? "production" : "sandbox",
      },
      bookingReference: args.bookingReference,
    });
  },
});
