import { handleCallBridgeAssistantTransport } from '../../src/assistantTransportServer.js';

type PagesContext = { request: Request };

export function onRequestPost(context: PagesContext): Promise<Response> {
  return handleCallBridgeAssistantTransport(context.request);
}
