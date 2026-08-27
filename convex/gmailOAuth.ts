import { ConvexError, v } from "convex/values";
import { makeFunctionReference } from "convex/server";

import { action, internalAction, internalMutation, internalQuery, mutation, query } from "./_generated/server.js";
import { assertConnectorActionAllowed } from "../src/application/connectorPolicy.js";
import {
  buildGoogleAuthorizationUrl,
  createOAuthAttempt,
  decryptConnectorSecret,
  encryptConnectorSecret,
  exchangeGoogleAuthorizationCode,
  fetchGmailProfile,
  fetchGmailThread,
  hashOAuthState,
  refreshGoogleAccessToken,
} from "../src/integrations/googleGmail.js";

type ClaimedAttempt = { ownerId: string; codeVerifier: string } | null;
type StoredConnection = {
  emailAddress: string;
  encryptedRefreshToken: string;
  refreshTokenIv: string;
} | null;

const storeAttemptRef = makeFunctionReference<
  "mutation",
  { ownerId: string; stateHash: string; codeVerifier: string; expiresAt: string; now: string },
  null
>("gmailOAuth:storeAttempt");
const claimAttemptRef = makeFunctionReference<
  "mutation",
  { stateHash: string; now: string },
  ClaimedAttempt
>("gmailOAuth:claimAttempt");
const saveConnectionRef = makeFunctionReference<
  "mutation",
  {
    ownerId: string;
    emailAddress: string;
    encryptedRefreshToken: string;
    refreshTokenIv: string;
    scope: string;
    now: string;
  },
  null
>("gmailOAuth:saveConnection");
const getConnectionRef = makeFunctionReference<"query", { ownerId: string }, StoredConnection>(
  "gmailOAuth:getConnection",
);

function requiredEnvironment(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function googleConfig() {
  return {
    clientId: requiredEnvironment("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: requiredEnvironment("GOOGLE_OAUTH_CLIENT_SECRET"),
    redirectUri: requiredEnvironment("GOOGLE_OAUTH_REDIRECT_URI"),
  };
}

async function requireOwnerId(ctx: { auth: { getUserIdentity(): Promise<{ subject: string } | null> } }): Promise<string> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError({ code: "UNAUTHENTICATED" });
  return identity.subject;
}

export const beginOAuth = action({
  args: { loginHint: v.optional(v.string()) },
  handler: async (ctx, args): Promise<{ authorizationUrl: string; expiresAt: string }> => {
    const ownerId = await requireOwnerId(ctx);
    const config = googleConfig();
    const attempt = await createOAuthAttempt();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + 10 * 60 * 1000).toISOString();
    await ctx.runMutation(storeAttemptRef, {
      ownerId,
      stateHash: attempt.stateHash,
      codeVerifier: attempt.codeVerifier,
      expiresAt,
      now: now.toISOString(),
    });
    return {
      authorizationUrl: buildGoogleAuthorizationUrl({ config, attempt, ...(args.loginHint ? { loginHint: args.loginHint } : {}) }),
      expiresAt,
    };
  },
});

export const completeOAuth = internalAction({
  args: { code: v.string(), state: v.string() },
  handler: async (ctx, args): Promise<{ emailAddress: string }> => {
    const config = googleConfig();
    const now = new Date().toISOString();
    const claimed = await ctx.runMutation(claimAttemptRef, {
      stateHash: await hashOAuthState(args.state),
      now,
    });
    if (!claimed) throw new Error("OAuth state is invalid, expired, or already used");

    const tokens = await exchangeGoogleAuthorizationCode({
      config,
      code: args.code,
      codeVerifier: claimed.codeVerifier,
    });
    const profile = await fetchGmailProfile(tokens.accessToken);
    const encrypted = await encryptConnectorSecret(
      tokens.refreshToken,
      requiredEnvironment("CALLBRIDGE_CONNECTOR_TOKEN_ENCRYPTION_KEY"),
    );
    await ctx.runMutation(saveConnectionRef, {
      ownerId: claimed.ownerId,
      emailAddress: profile.emailAddress,
      encryptedRefreshToken: encrypted.ciphertext,
      refreshTokenIv: encrypted.iv,
      scope: tokens.scope,
      now,
    });
    return profile;
  },
});

export const readPermittedThread = action({
  args: { threadId: v.string() },
  handler: async (ctx, args) => {
    assertConnectorActionAllowed("gmail", "read_permitted_context");
    const ownerId = await requireOwnerId(ctx);
    const connection = await ctx.runQuery(getConnectionRef, { ownerId });
    if (!connection) throw new ConvexError({ code: "GMAIL_NOT_CONNECTED" });
    const config = googleConfig();
    const refreshToken = await decryptConnectorSecret(
      { ciphertext: connection.encryptedRefreshToken, iv: connection.refreshTokenIv },
      requiredEnvironment("CALLBRIDGE_CONNECTOR_TOKEN_ENCRYPTION_KEY"),
    );
    const accessToken = await refreshGoogleAccessToken({ config, refreshToken });
    return await fetchGmailThread({ accessToken, threadId: args.threadId });
  },
});

export const status = query({
  args: {},
  handler: async (ctx) => {
    const ownerId = await requireOwnerId(ctx);
    const connection = await ctx.db
      .query("gmailConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    return connection
      ? { connected: true as const, emailAddress: connection.emailAddress, connectedAt: connection.connectedAt }
      : { connected: false as const };
  },
});

export const disconnect = mutation({
  args: {},
  handler: async (ctx): Promise<{ disconnected: boolean }> => {
    const ownerId = await requireOwnerId(ctx);
    const connection = await ctx.db
      .query("gmailConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .unique();
    if (connection) await ctx.db.delete(connection._id);
    const attempts = await ctx.db
      .query("gmailOAuthAttempts")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .collect();
    for (const attempt of attempts) await ctx.db.delete(attempt._id);
    return { disconnected: Boolean(connection) };
  },
});

export const storeAttempt = internalMutation({
  args: {
    ownerId: v.string(),
    stateHash: v.string(),
    codeVerifier: v.string(),
    expiresAt: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const previous = await ctx.db
      .query("gmailOAuthAttempts")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .collect();
    for (const attempt of previous) await ctx.db.delete(attempt._id);
    await ctx.db.insert("gmailOAuthAttempts", {
      ownerId: args.ownerId,
      stateHash: args.stateHash,
      codeVerifier: args.codeVerifier,
      expiresAt: args.expiresAt,
      createdAt: args.now,
    });
    return null;
  },
});

export const claimAttempt = internalMutation({
  args: { stateHash: v.string(), now: v.string() },
  handler: async (ctx, args): Promise<ClaimedAttempt> => {
    const attempt = await ctx.db
      .query("gmailOAuthAttempts")
      .withIndex("by_state_hash", (q) => q.eq("stateHash", args.stateHash))
      .unique();
    if (!attempt || attempt.consumedAt || attempt.expiresAt <= args.now) return null;
    await ctx.db.patch(attempt._id, { consumedAt: args.now });
    return { ownerId: attempt.ownerId, codeVerifier: attempt.codeVerifier };
  },
});

export const saveConnection = internalMutation({
  args: {
    ownerId: v.string(),
    emailAddress: v.string(),
    encryptedRefreshToken: v.string(),
    refreshTokenIv: v.string(),
    scope: v.string(),
    now: v.string(),
  },
  handler: async (ctx, args): Promise<null> => {
    const existing = await ctx.db
      .query("gmailConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .unique();
    const value = {
      ownerId: args.ownerId,
      emailAddress: args.emailAddress,
      encryptedRefreshToken: args.encryptedRefreshToken,
      refreshTokenIv: args.refreshTokenIv,
      scope: args.scope,
      updatedAt: args.now,
    };
    if (existing) await ctx.db.patch(existing._id, value);
    else await ctx.db.insert("gmailConnections", { ...value, connectedAt: args.now });
    return null;
  },
});

export const getConnection = internalQuery({
  args: { ownerId: v.string() },
  handler: async (ctx, args): Promise<StoredConnection> => {
    const connection = await ctx.db
      .query("gmailConnections")
      .withIndex("by_owner", (q) => q.eq("ownerId", args.ownerId))
      .unique();
    return connection
      ? {
        emailAddress: connection.emailAddress,
        encryptedRefreshToken: connection.encryptedRefreshToken,
        refreshTokenIv: connection.refreshTokenIv,
      }
      : null;
  },
});
