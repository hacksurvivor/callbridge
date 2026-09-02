import { spawnSync } from "node:child_process";

const root = spawnSync("git", ["rev-parse", "--show-toplevel"], {
  cwd: process.cwd(),
  encoding: "utf8",
});
if (root.error) throw root.error;
if (root.status !== 0 || !root.stdout.trim()) {
  throw new Error(root.stderr.trim() || "Could not resolve the deployment source repository.");
}

const repositoryRoot = root.stdout.trim();
const result = spawnSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
  cwd: repositoryRoot,
  encoding: "utf8",
});

if (result.error) throw result.error;
if (result.status !== 0) {
  throw new Error(result.stderr.trim() || "Could not verify the deployment source tree.");
}
if (result.stdout.trim()) {
  throw new Error("Refusing to deploy from a dirty worktree. Commit the approved checkpoint first.");
}
