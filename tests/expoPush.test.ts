import { describe, expect, it, vi } from "vitest";

import { sendExpoPushNotification } from "../src/integrations/expoPush.js";

describe("Expo push delivery", () => {
  it("sends a bounded authenticated batch and returns ticket ids", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket_1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
    await expect(sendExpoPushNotification({
      accessToken: "access",
      tokens: ["ExpoPushToken[abcdefghijklmnop]"],
      title: "Update",
      body: "One task changed",
      data: { type: "task_result" },
      fetchImpl,
    })).resolves.toEqual({ ticketIds: ["ticket_1"] });
    expect(fetchImpl).toHaveBeenCalledWith("https://exp.host/--/api/v2/push/send", expect.objectContaining({
      headers: expect.objectContaining({ authorization: "Bearer access" }),
    }));
  });

  it("fails closed without subscriptions", async () => {
    const fetchImpl = vi.fn();
    await expect(sendExpoPushNotification({
      accessToken: "access",
      tokens: [],
      title: "Update",
      body: "Body",
      data: {},
      fetchImpl,
    })).rejects.toThrow("No push subscriptions");
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
