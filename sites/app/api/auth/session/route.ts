import { getChatGPTUser } from '../../../chatgpt-auth';
import { issueChatGPTSessionToken } from '../../../chatgpt-session';

export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  const user = await getChatGPTUser();
  if (!user) {
    return Response.json({ error: 'CHATGPT_SIGN_IN_REQUIRED' }, {
      status: 401,
      headers: { 'cache-control': 'no-store' },
    });
  }

  try {
    const session = await issueChatGPTSessionToken(user);
    return Response.json({ ...session, user: { email: user.email, name: user.fullName } }, {
      headers: { 'cache-control': 'no-store' },
    });
  } catch {
    return Response.json({ error: 'CHATGPT_SESSION_UNAVAILABLE' }, {
      status: 503,
      headers: { 'cache-control': 'no-store' },
    });
  }
}
