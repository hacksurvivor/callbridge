import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import type { IncomingMessage, ServerResponse } from "node:http";

import { handleCallBridgeAssistantTransport } from "./src/assistantTransportServer.js";

function requestHeaders(request: IncomingMessage): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  return headers;
}

async function requestBody(request: IncomingMessage): Promise<string> {
  request.setEncoding("utf8");
  let body = "";
  for await (const chunk of request) body += String(chunk);
  return body;
}

async function sendWebResponse(response: Response, target: ServerResponse): Promise<void> {
  target.statusCode = response.status;
  response.headers.forEach((value, name) => target.setHeader(name, value));
  if (!response.body) {
    target.end();
    return;
  }
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    target.write(value);
  }
  target.end();
}

function assistantTransportDevEndpoint(): Plugin {
  return {
    name: "callbridge-assistant-transport-dev-endpoint",
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/assistant", (request, response) => {
        void (async () => {
          const webRequest = new Request("http://127.0.0.1/api/assistant", {
            method: request.method,
            headers: requestHeaders(request),
            ...(request.method === "POST" ? { body: await requestBody(request) } : {}),
          });
          await sendWebResponse(await handleCallBridgeAssistantTransport(webRequest), response);
        })().catch((error) => {
          response.statusCode = 500;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: error instanceof Error ? error.message : "Transport failed" }));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), assistantTransportDevEndpoint()],
  server: {
    host: "127.0.0.1",
    port: 5173,
  },
});
