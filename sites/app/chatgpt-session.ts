import { importJWK, SignJWT, type JWK } from 'jose';

import type { ChatGPTUser } from './chatgpt-auth';

const DEFAULT_AUDIENCE = 'callbridge-convex';
const TOKEN_TTL_SECONDS = 5 * 60;

export type ChatGPTSessionConfig = {
  issuer: string;
  audience: string;
  privateJwk: JWK;
};

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

export function readChatGPTSessionConfig(): ChatGPTSessionConfig {
  const privateJwk = JSON.parse(requiredEnvironment('CALLBRIDGE_SIWC_PRIVATE_JWK')) as JWK;
  if (privateJwk.kty !== 'RSA' || !privateJwk.d || !privateJwk.kid) {
    throw new Error('CALLBRIDGE_SIWC_PRIVATE_JWK must be a private RSA JWK with a kid');
  }
  return {
    issuer: requiredEnvironment('CALLBRIDGE_SIWC_ISSUER'),
    audience: process.env.CALLBRIDGE_SIWC_AUDIENCE?.trim() || DEFAULT_AUDIENCE,
    privateJwk,
  };
}

export async function issueChatGPTSessionToken(
  user: ChatGPTUser,
  config = readChatGPTSessionConfig(),
  now = new Date(),
): Promise<{ token: string; expiresAt: string }> {
  const issuedAt = Math.floor(now.getTime() / 1000);
  const expiresAt = issuedAt + TOKEN_TTL_SECONDS;
  const key = await importJWK(config.privateJwk, 'RS256');
  const token = await new SignJWT({
    email: user.email,
    name: user.fullName ?? undefined,
    provider: 'chatgpt',
  })
    .setProtectedHeader({ alg: 'RS256', kid: config.privateJwk.kid, typ: 'JWT' })
    .setIssuer(config.issuer)
    .setAudience(config.audience)
    .setSubject(`chatgpt:${user.userId}`)
    .setIssuedAt(issuedAt)
    .setExpirationTime(expiresAt)
    .setJti(crypto.randomUUID())
    .sign(key);

  return { token, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export async function chatGPTSessionJwks(
  config = readChatGPTSessionConfig(),
): Promise<{ keys: JWK[] }> {
  const { e, n } = config.privateJwk;
  if (!e || !n) throw new Error('The configured RSA key is missing its public parameters');
  return {
    keys: [{ kty: 'RSA', e, n, alg: 'RS256', kid: config.privateJwk.kid, use: 'sig' }],
  };
}
