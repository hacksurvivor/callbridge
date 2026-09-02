import { exportJWK, generateKeyPair, jwtVerify, type JWK } from 'jose';
import { describe, expect, it } from 'vitest';

import { chatGPTSessionJwks, issueChatGPTSessionToken, type ChatGPTSessionConfig } from './chatgpt-session';

async function testConfig(): Promise<ChatGPTSessionConfig> {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true, modulusLength: 2048 });
  const privateJwk = await exportJWK(privateKey) as JWK;
  privateJwk.kid = 'callbridge-test-key';
  return {
    issuer: 'https://callbridge.test/chatgpt',
    audience: 'callbridge-convex',
    privateJwk,
  };
}

describe('ChatGPT session bridge', () => {
  it('issues a short-lived Convex token bound to the stable Site user id', async () => {
    const config = await testConfig();
    const now = new Date('2026-09-02T10:00:00.000Z');
    const user = { userId: 'acct_123', email: 'person@example.com', fullName: 'Example Person', displayName: 'Example Person' };
    const { token, expiresAt } = await issueChatGPTSessionToken(user, config, now);
    const { keys } = await chatGPTSessionJwks(config);
    const publicKey = await crypto.subtle.importKey(
      'jwk',
      keys[0] as JsonWebKey,
      { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    const verified = await jwtVerify(token, publicKey, { issuer: config.issuer, audience: config.audience, currentDate: now });

    expect(verified.payload.sub).toBe('chatgpt:acct_123');
    expect(verified.payload.provider).toBe('chatgpt');
    expect(expiresAt).toBe('2026-09-02T10:05:00.000Z');
  });

  it('publishes only the public half of the signing key', async () => {
    const config = await testConfig();
    const { keys } = await chatGPTSessionJwks(config);
    expect(keys).toHaveLength(1);
    expect(keys[0]).toMatchObject({ alg: 'RS256', kid: 'callbridge-test-key', use: 'sig' });
    expect(keys[0]).not.toHaveProperty('d');
    expect(keys[0]).not.toHaveProperty('p');
    expect(keys[0]).not.toHaveProperty('q');
  });
});
