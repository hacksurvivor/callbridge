import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const productionRedirectUri = "https://callbridge-web.pages.dev/callback";

function readLocalConfiguration() {
  try {
    return Object.fromEntries(
      readFileSync(resolve(process.cwd(), ".env.local"), "utf8")
        .split(/\r?\n/u)
        .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u))
        .filter(Boolean)
        .map((match) => [match[1], match[2].replace(/^("|')(.*)\1$/u, "$2")]),
    );
  } catch {
    return {};
  }
}

const local = readLocalConfiguration();
const serverClientId = process.env.WORKOS_CLIENT_ID || local.WORKOS_CLIENT_ID;
const browserClientId = process.env.VITE_WORKOS_CLIENT_ID || serverClientId;
const configuredRedirectUri = process.env.VITE_WORKOS_REDIRECT_URI || productionRedirectUri;
const serverConvexUrl = process.env.CONVEX_URL || local.CONVEX_URL;
const browserConvexUrl = process.env.VITE_CONVEX_URL || serverConvexUrl;

if (!serverClientId || !browserClientId) {
  throw new Error("Candidate verification requires WORKOS_CLIENT_ID and VITE_WORKOS_CLIENT_ID (or the same server ID inherited by the web build).");
}
if (serverClientId !== browserClientId) {
  throw new Error("Convex and the production web build must use the same WorkOS client ID.");
}
if (configuredRedirectUri !== productionRedirectUri) {
  throw new Error(`Production redirect URI must be ${productionRedirectUri}.`);
}
if (!serverConvexUrl || !browserConvexUrl) {
  throw new Error("Candidate verification requires CONVEX_URL and VITE_CONVEX_URL (or the same server URL inherited by the web build).");
}
if (serverConvexUrl !== browserConvexUrl) {
  throw new Error("The production web build must target the reviewed Convex deployment.");
}

console.log("Auth configuration is internally consistent: one WorkOS client, one Convex deployment, and the exact production callback.");
console.log("External proof is still required that the client belongs to an isolated WorkOS Production environment.");
