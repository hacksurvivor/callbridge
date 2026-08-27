import { describe, expect, it } from "vitest";

import { readBookingDemandAccommodation } from "../src/integrations/bookingDemand.js";

describe("Booking Demand read-only adapter", () => {
  it("uses only the sandbox accommodation-details endpoint", async () => {
    let calledUrl = "";
    let calledRequest: RequestInit | undefined;
    const fetchImpl: typeof fetch = async (url, request) => {
      calledUrl = String(url);
      calledRequest = request;
      return new Response(JSON.stringify({
        data: [{
          id: "order-1",
          status: "booked",
          accommodations: { reservation: 2321873123, name: "Test Hotel", checkin: "2026-09-01" },
        }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    };

    const result = await readBookingDemandAccommodation({
      config: { apiKey: "key", affiliateId: "123", environment: "sandbox" },
      bookingReference: "2321873123",
      fetchImpl,
    });

    expect(calledUrl).toBe("https://demandapi-sandbox.booking.com/3.2/orders/details/accommodations");
    expect(calledRequest?.method).toBe("POST");
    expect(String(calledRequest?.body)).toContain('"reservations":["2321873123"]');
    expect(calledUrl).not.toMatch(/cancel|modify|create/);
    expect(result).toMatchObject({
      provider: "booking_com_demand",
      reference: "2321873123",
      facts: { status: "booked", accommodationName: "Test Hotel" },
    });
  });

  it("rejects invalid references before making a request", async () => {
    let called = false;
    const fetchImpl: typeof fetch = async () => {
      called = true;
      return new Response(null, { status: 500 });
    };
    await expect(readBookingDemandAccommodation({
      config: { apiKey: "key", affiliateId: "123", environment: "sandbox" },
      bookingReference: "../cancel",
      fetchImpl,
    })).rejects.toThrow("invalid");
    expect(called).toBe(false);
  });
});
