#!/usr/bin/env node
/**
 * Release secrets live in the build and release environments, which only
 * dev-* and main can deploy to. This keeps every workflow that way:
 * - a job reading a secret other than GITHUB_TOKEN names an environment
 * - a workflow with environment jobs has no pull_request_target or
 *   workflow_run trigger (those run with the base branch's rights)
 * - nothing reads the retired TERMIX_PAT
 */

const fs = require("node:fs");
const path = require("node:path");
const YAML = require("yaml");

const ROOT = path.resolve(__dirname, "..");
const SECRET = /secrets\.([A-Za-z0-9_]+)/g;
const RISKY_TRIGGERS = ["pull_request_target", "workflow_run"];

function secretsIn(value) {
  const found = new Set();
  for (const match of JSON.stringify(value ?? null).matchAll(SECRET)) {
    if (match[1] !== "GITHUB_TOKEN") found.add(match[1]);
  }
  return found;
}

function triggersOf(doc) {
  const on = doc.on ?? doc[true];
  if (typeof on === "string") return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on ?? {});
}

function checkWorkflow(name, text) {
  const problems = [];
  if (text.includes("TERMIX_PAT")) {
    problems.push(`${name}: uses TERMIX_PAT, mint a Termix CI App token`);
  }
  const doc = YAML.parse(text);
  const triggers = triggersOf(doc);
  const top = secretsIn(doc.env);
  if (top.size) {
    problems.push(`${name}: workflow env reads ${[...top].join(", ")}`);
  }
  for (const [id, job] of Object.entries(doc.jobs ?? {})) {
    const { secrets: passed, ...rest } = job;
    const read = secretsIn(rest);
    if (passed && passed !== "inherit") {
      for (const secret of secretsIn(passed)) read.add(secret);
    }
    if (read.size && !job.environment) {
      problems.push(
        `${name} ${id}: reads ${[...read].join(", ")} without an environment`,
      );
    }
    if (job.environment) {
      for (const trigger of RISKY_TRIGGERS) {
        if (triggers.includes(trigger)) {
          problems.push(
            `${name} ${id}: environment job in a ${trigger} workflow`,
          );
        }
      }
    }
  }
  return problems;
}

function checkDir(dir) {
  return fs
    .readdirSync(dir)
    .filter((file) => /\.ya?ml$/.test(file))
    .sort()
    .flatMap((file) =>
      checkWorkflow(file, fs.readFileSync(path.join(dir, file), "utf8")),
    );
}

module.exports = { checkWorkflow, checkDir };

if (require.main === module) {
  const problems = checkDir(
    process.argv[2] ?? path.join(ROOT, ".github", "workflows"),
  );
  for (const problem of problems) console.error(problem);
  if (problems.length) process.exit(1);
  console.log("workflow secrets ok");
}
