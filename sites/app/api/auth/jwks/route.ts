import { chatGPTSessionJwks } from '../../../chatgpt-session';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    return Response.json(await chatGPTSessionJwks(), {
      headers: { 'cache-control': 'public, max-age=300, stale-while-revalidate=300' },
    });
  } catch {
    return Response.json({ error: 'JWKS_UNAVAILABLE' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
