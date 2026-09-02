import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const WORKER_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REPOSITORY_ROOT = resolve(WORKER_ROOT, "..");
const MANIFEST_PATH = resolve(WORKER_ROOT, "evals/latest-run.json");
const EXPECTED_CASES_PER_RUN = 13;

// This order is part of the manifest contract. Change it only when intentionally
// changing which source controls the live model gate.
export const EVAL_DIGEST_FILES = [
  "telephony-worker/package.json",
  "telephony-worker/package-lock.json",
  "telephony-worker/evals/run-live-evals.mjs",
  "telephony-worker/evals/evalSupport.ts",
  "telephony-worker/evals/inquiry-agent-v1.eval.test.ts",
  "telephony-worker/evals/inquiry-result-v1.eval.test.ts",
  "telephony-worker/src/inquiryRealtime.ts",
  "telephony-worker/src/inquiryExtraction.ts",
  "telephony-worker/src/inquiryResult.ts",
  "shared/inquiryContracts.ts",
  "shared/inquiryDispatchContracts.ts",
  "shared/inquiryAcceptanceFixtures.ts",
];

function sourceDigest() {
  const hash = createHash("sha256");
  for (const path of EVAL_DIGEST_FILES) {
    hash.update(path);
    hash.update("\0");
    hash.update(readFileSync(resolve(REPOSITORY_ROOT, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function runOnce() {
  const startedAt = new Date().toISOString();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [
      resolve(WORKER_ROOT, "node_modules/vitest/vitest.mjs"),
      "run",
      "--pool=threads",
      "--maxWorkers=1",
      "evals",
    ], {
      cwd: WORKER_ROOT,
      env: { ...process.env, CALLBRIDGE_RUN_LIVE_EVALS: "true" },
      stdio: ["inherit", "pipe", "pipe"],
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
      stream.on("data", (chunk) => {
        const text = String(chunk);
        output += text;
        (stream === child.stdout ? process.stdout : process.stderr).write(text);
      });
    }
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`Live eval run failed with exit code ${code}`));
      const plain = output.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
      const match = plain.match(/Tests\s+(\d+)\s+passed/);
      const passed = Number(match?.[1] ?? 0);
      if (passed !== EXPECTED_CASES_PER_RUN) {
        return reject(new Error(`Expected ${EXPECTED_CASES_PER_RUN} passing live cases, observed ${passed}`));
      }
      resolvePromise({ startedAt, passed, failed: 0 });
    });
  });
}

function verifyManifest() {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8"));
  if (manifest.sourceDigest?.algorithm !== "sha256" || manifest.sourceDigest?.value !== sourceDigest()) {
    throw new Error("Live eval manifest source digest does not match the current gate source");
  }
  if (!Array.isArray(manifest.digestFiles) || JSON.stringify(manifest.digestFiles) !== JSON.stringify(EVAL_DIGEST_FILES)) {
    throw new Error("Live eval manifest digest file order does not match the runner");
  }
  if (!Array.isArray(manifest.consecutiveRuns) || manifest.consecutiveRuns.length !== 2) {
    throw new Error("Live eval manifest must contain exactly two consecutive runs");
  }
  if (manifest.consecutiveRuns.some((run) => run.passed !== EXPECTED_CASES_PER_RUN || run.failed !== 0)) {
    throw new Error("Live eval manifest does not contain two complete passing runs");
  }
  console.log("Live eval manifest verified.");
}

if (process.argv.includes("--verify")) {
  verifyManifest();
} else {
  if (!process.env.CALLBRIDGE_EVAL_OPENAI_API_KEY?.trim()) {
    throw new Error("CALLBRIDGE_EVAL_OPENAI_API_KEY is required for live evals");
  }
  const consecutiveRuns = [await runOnce(), await runOnce()];
  const manifest = {
    schemaVersion: 1,
    completedAt: new Date().toISOString(),
    sourceDigest: { algorithm: "sha256", value: sourceDigest() },
    digestFiles: EVAL_DIGEST_FILES,
    models: {
      realtimeRequested: "gpt-realtime-2.1-mini",
      realtimeServerReportedConstraint: "contains:gpt-realtime-2.1-mini",
      extractionRequested: "gpt-5.4-mini",
      extractionServerReportedConstraint: "contains:gpt-5.4-mini",
      judgeRequested: "gpt-5.4-mini",
    },
    suites: [
      { id: "inquiry-agent-v1", casesPerRun: 6 },
      { id: "inquiry-result-v1", casesPerRun: 7 },
    ],
    consecutiveRuns,
    totalPassingSamples: consecutiveRuns.reduce((total, run) => total + run.passed, 0),
    modelTextPersisted: false,
    credentialPersisted: false,
    credentialVariable: "CALLBRIDGE_EVAL_OPENAI_API_KEY",
  };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
  verifyManifest();
}
