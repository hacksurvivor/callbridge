import { z } from "zod";

const responseSchema = z.object({
  data: z.union([
    z.object({ status: z.literal("ok"), id: z.string() }),
    z.object({ status: z.literal("error"), message: z.string() }),
    z.array(z.union([
      z.object({ status: z.literal("ok"), id: z.string() }),
      z.object({ status: z.literal("error"), message: z.string() }),
    ])),
  ]),
});

export async function sendExpoPushNotification(input: {
  accessToken: string;
  tokens: readonly string[];
  title: string;
  body: string;
  data: Record<string, string>;
  fetchImpl?: typeof fetch;
}): Promise<{ ticketIds: string[] }> {
  if (!input.accessToken.trim()) throw new Error("Expo access token is missing");
  if (input.tokens.length === 0) throw new Error("No push subscriptions are enabled");
  const fetchImpl = input.fetchImpl ?? fetch;
  const messages = input.tokens.slice(0, 100).map((to) => ({
    to,
    title: input.title,
    body: input.body,
    data: input.data,
    sound: "default",
  }));
  const response = await fetchImpl("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: {
      accept: "application/json",
      authorization: `Bearer ${input.accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(messages),
  });
  if (!response.ok) throw new Error(`Expo push failed with status ${response.status}`);
  const parsed = responseSchema.safeParse(await response.json());
  if (!parsed.success) throw new Error("Expo push response is invalid");
  const tickets = Array.isArray(parsed.data.data) ? parsed.data.data : [parsed.data.data];
  const ticketIds = tickets.flatMap((ticket) => ticket.status === "ok" ? [ticket.id] : []);
  if (ticketIds.length === 0) throw new Error("Expo push rejected every message");
  return { ticketIds };
}
