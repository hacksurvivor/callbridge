import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const productionRedirectUri = "https://callbridge-web.pages.dev/callback";

function readLocalPublicConfiguration() {
  try {
    const source = readFileSync(resolve(process.cwd(), "../.env.local"), "utf8");
    return Object.fromEntries(
      source
        .split(/\r?\n/u)
        .map((line) => line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/u))
        .filter(Boolean)
        .map((match) => [match[1], match[2].replace(/^(["'])(.*)\1$/u, "$2")]),
    );
  } catch {
    return {};
  }
}

const local = readLocalPublicConfiguration();
const convexUrl = process.env.VITE_CONVEX_URL || local.CONVEX_URL;
const serverWorkosClientId = process.env.WORKOS_CLIENT_ID || local.WORKOS_CLIENT_ID;
const workosClientId = process.env.VITE_WORKOS_CLIENT_ID || serverWorkosClientId;

if (!convexUrl || !workosClientId) {
  throw new Error("Production build requires VITE_CONVEX_URL/CONVEX_URL and VITE_WORKOS_CLIENT_ID/WORKOS_CLIENT_ID.");
}
if (serverWorkosClientId && serverWorkosClientId !== workosClientId) {
  throw new Error("Production web and Convex configuration must use the same WorkOS client ID.");
}

const vite = resolve(process.cwd(), "node_modules/.bin/vite");
const result = spawnSync(vite, ["build"], {
  stdio: "inherit",
  env: {
    ...process.env,
    VITE_CALLBRIDGE_SIMULATION: "false",
    VITE_CONVEX_URL: convexUrl,
    VITE_WORKOS_CLIENT_ID: workosClientId,
    VITE_WORKOS_REDIRECT_URI: productionRedirectUri,
  },
});

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
