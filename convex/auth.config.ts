import type { AuthConfig } from "convex/server";

const clientId = process.env.WORKOS_CLIENT_ID;
if (!clientId) {
  throw new Error("WORKOS_CLIENT_ID must be configured before Convex auth can be deployed");
}

const chatgptIssuer = process.env.CALLBRIDGE_SIWC_ISSUER?.trim();
const chatgptJwks = process.env.CALLBRIDGE_SIWC_JWKS?.trim();
if (Boolean(chatgptIssuer) !== Boolean(chatgptJwks)) {
  throw new Error("CALLBRIDGE_SIWC_ISSUER and CALLBRIDGE_SIWC_JWKS must be configured together");
}

export default {
  providers: [
    {
      type: "customJwt",
      issuer: "https://api.workos.com/",
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
      applicationID: clientId,
    },
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${clientId}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${clientId}`,
    },
    ...(chatgptIssuer && chatgptJwks ? [{
      type: "customJwt" as const,
      issuer: chatgptIssuer,
      algorithm: "RS256" as const,
      jwks: chatgptJwks,
      applicationID: "callbridge-convex",
    }] : []),
  ],
} satisfies AuthConfig;
