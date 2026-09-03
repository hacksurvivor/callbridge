import { handleCallBridgeAssistantTransport } from '../../../../web/src/assistantTransportServer';

export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  return handleCallBridgeAssistantTransport(request);
}
