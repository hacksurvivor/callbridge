import { readdirSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

const dist = resolve(process.cwd(), process.cwd().endsWith("/web") ? "dist" : "web/dist");

function filesUnder(directory) {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    return statSync(path).isDirectory() ? filesUnder(path) : [path];
  });
}

const bundle = filesUnder(dist)
  .filter((path) => /\.(?:html|js|css)$/u.test(path))
  .map((path) => readFileSync(path, "utf8"))
  .join("\n");

const requiredTools = [
  "create_call_draft",
  "create_demo_call_draft",
  "update_call_draft",
  "read_call_draft",
  "get_call_status",
  "get_call_result",
];
const forbiddenSubmissionSurface = [
  "create_task_artifact",
  "update_task_artifact",
  "read_task_artifacts",
  "Five stable WebMCP tools are ready",
  "artifactFixture",
];

for (const name of requiredTools) {
  if (!bundle.includes(name)) throw new Error(`Production bundle is missing ${name}.`);
}
for (const value of forbiddenSubmissionSurface) {
  if (bundle.includes(value)) throw new Error(`Production bundle still contains forbidden submission surface: ${value}.`);
}

console.log("Production bundle exposes five general call tools plus the controlled demo creator and contains no artifact submission surface.");
