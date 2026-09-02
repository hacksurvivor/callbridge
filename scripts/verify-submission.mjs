import { spawnSync } from "node:child_process";

const steps = [
  ["Auth configuration consistency", "node", ["scripts/verify-auth-config.mjs"]],
  ["Focused inquiry backend tests", "npx", ["vitest", "run",
    "convex/inquiries.test.ts",
    "convex/inquiryDispatch.test.ts",
    "tests/inquiryContracts.test.ts",
    "tests/inquiryAcceptanceMatrix.test.ts",
    "tests/inquiryPricing.test.ts",
    "tests/inquiryTelephonyBridge.test.ts",
    "tests/inquiryWorkerCallback.test.ts",
  ]],
  ["Web tests", "npm", ["--prefix", "web", "test"]],
  ["Telephony worker tests", "npm", ["--prefix", "telephony-worker", "test"]],
  ["Backend TypeScript build", "npm", ["run", "build"]],
  ["Telephony worker TypeScript build", "npm", ["--prefix", "telephony-worker", "run", "build"]],
  ["Production web build", "npm", ["--prefix", "web", "run", "build:production"]],
  ["Production bundle inspection", "node", ["web/scripts/verify-production-bundle.mjs"]],
];

for (const [label, command, args] of steps) {
  console.log(`\n[verify:submission] ${label}`);
  const result = spawnSync(command, args, { stdio: "inherit", env: process.env });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status ?? "unknown"}.`);
  }
}

console.log("\n[verify:submission] Candidate code gate passed.");
console.log("External gates still required: WorkOS Production isolation, target-browser smoke, two unchanged live canaries, public package, and video/link verification.");
