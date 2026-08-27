import type { AttemptEvent } from "./hotelDemoContracts.js";

async function signature(input: { body: string; secret: string; timestamp: string }): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(input.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${input.timestamp}.${input.body}`));
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function deliverHotelDemoEvent(input: {
  callbackUrl: string;
  secret: string;
  event: AttemptEvent;
  fetchImpl?: typeof fetch;
  nowMs?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}): Promise<void> {
  if (!input.callbackUrl.startsWith("https://")) throw new Error("Hotel demo callback must use HTTPS");
  if (!input.secret.trim()) throw new Error("Hotel demo callback secret is missing");
  const fetchImpl = input.fetchImpl ?? fetch;
  const wait = input.wait ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const body = JSON.stringify({ event: input.event });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const timestamp = Math.floor((input.nowMs?.() ?? Date.now()) / 1_000).toString();
    const response = await fetchImpl(input.callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-callbridge-signature": await signature({ body, secret: input.secret, timestamp }),
        "x-callbridge-timestamp": timestamp,
      },
      body,
    });
    if (response.ok) return;
    if (attempt < 2) await wait(attempt === 0 ? 250 : 1_000);
  }
  throw new Error("Hotel demo event delivery exhausted retries");
}
