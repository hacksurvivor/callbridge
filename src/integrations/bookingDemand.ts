export type BookingDemandConfig = {
  apiKey: string;
  affiliateId: string;
  environment: "sandbox" | "production";
};

export type BookingContext = {
  provider: "booking_com_demand";
  reference: string;
  facts: Readonly<Record<string, string>>;
};

type FetchLike = typeof fetch;

function baseUrl(environment: BookingDemandConfig["environment"]): string {
  return environment === "production"
    ? "https://demandapi.booking.com/3.2"
    : "https://demandapi-sandbox.booking.com/3.2";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringFact(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function firstOrder(payload: unknown): Record<string, unknown> {
  if (Array.isArray(payload)) return record(payload[0]);
  const root = record(payload);
  for (const key of ["data", "orders", "results"]) {
    const candidate = root[key];
    if (Array.isArray(candidate)) return record(candidate[0]);
  }
  return root;
}

export function extractBookingFacts(payload: unknown): Readonly<Record<string, string>> {
  const order = firstOrder(payload);
  const accommodation = record(order.accommodations ?? order.accommodation);
  const location = record(accommodation.location);
  const price = record(order.price ?? accommodation.price);
  const total = record(price.total_price ?? price.total);
  const facts: Record<string, string> = {};
  const selected: [string, unknown][] = [
    ["status", order.status],
    ["orderId", order.id],
    ["reservationId", accommodation.reservation ?? order.reservation],
    ["accommodationName", accommodation.name],
    ["checkin", accommodation.checkin ?? order.checkin],
    ["checkout", accommodation.checkout ?? order.checkout],
    ["address", location.address],
    ["country", location.country],
    ["numberOfGuests", accommodation.number_of_guests],
    ["currency", price.currency ?? total.currency],
    ["totalPrice", total.booker_currency ?? total.product_currency ?? total.value],
  ];
  for (const [name, value] of selected) {
    const fact = stringFact(value);
    if (fact) facts[name] = fact;
  }
  return facts;
}

export async function readBookingDemandAccommodation(input: {
  config: BookingDemandConfig;
  bookingReference: string;
  fetchImpl?: FetchLike;
}): Promise<BookingContext> {
  const reference = input.bookingReference.trim();
  if (!/^[A-Za-z0-9_-]{4,128}$/.test(reference)) throw new Error("Booking reference is invalid");
  if (!input.config.apiKey.trim() || !input.config.affiliateId.trim()) {
    throw new Error("Booking Demand credentials are not configured");
  }
  const response = await (input.fetchImpl ?? fetch)(`${baseUrl(input.config.environment)}/orders/details/accommodations`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${input.config.apiKey.trim()}`,
      "x-affiliate-id": input.config.affiliateId.trim(),
      "content-type": "application/json",
    },
    body: JSON.stringify({
      reservations: [reference],
      extras: ["accommodation_details", "policies"],
    }),
  });
  if (!response.ok) throw new Error(`Booking Demand read failed with HTTP ${response.status}`);
  return {
    provider: "booking_com_demand",
    reference,
    facts: extractBookingFacts(await response.json()),
  };
}
