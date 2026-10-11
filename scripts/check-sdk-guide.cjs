#!/usr/bin/env node
/**
 * packages/plugin-sdk/PLUGIN-GUIDE.md ships with the SDK and is what plugin
 * authors and their AI tools read first. Fails when it misses a CLI command,
 * a capability or an entry point, or when its header names an older SDK or
 * plugin API version, so the guide is touched with every SDK release.
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const SDK = path.join(ROOT, "packages", "plugin-sdk");

// Exports that are plumbing, not something a plugin author imports.
const INTERNAL_EXPORTS = new Set([
  "./testing/setup",
  "./testing-host",
  "./tsconfig.plugin.json",
  "./schema/manifest.schema.json",
  "./theme.css",
]);

function cliCommands(source) {
  const block = source.match(/const COMMANDS = \{([\s\S]*?)\n\};/);
  if (!block) return [];
  return [...block[1].matchAll(/^ {2}([a-z-]+)[:,]/gm)].map((m) => m[1]);
}

function capabilityIds(source) {
  return [
    ...new Set(
      [...source.matchAll(/entry\("([a-z-]+:[a-z-]+)"/g)].map((m) => m[1]),
    ),
  ];
}

function entryPoints(pkg) {
  return Object.keys(pkg.exports ?? {})
    .filter((key) => key !== "." && !INTERNAL_EXPORTS.has(key))
    .map((key) => `@termix-ssh/plugin-sdk/${key.slice(2)}`);
}

function apiVersion(source) {
  return source.match(/PLUGIN_API_VERSION = "([^"]+)"/)?.[1] ?? null;
}

function findProblems({
  guide,
  commands,
  capabilities,
  entries,
  sdkVersion,
  api,
}) {
  const problems = [];
  for (const command of commands) {
    // `sign <file>` counts as well as `sign`.
    if (!new RegExp(`\`${command}[\` ]`).test(guide))
      problems.push(`CLI command "${command}" is not covered`);
  }
  for (const id of capabilities) {
    if (!guide.includes(`\`${id}\``))
      problems.push(`capability "${id}" is not covered`);
  }
  for (const entry of entries) {
    if (!guide.includes(`\`${entry}\``))
      problems.push(`entry point "${entry}" is not covered`);
  }
  const header = guide.match(/^SDK (\S+) \| Plugin API (\S+)$/m);
  if (!header) {
    problems.push('missing the "SDK x.y.z | Plugin API x.y.z" header line');
  } else {
    if (header[1] !== sdkVersion) {
      problems.push(`header says SDK ${header[1]}, package is ${sdkVersion}`);
    }
    if (api && header[2] !== api) {
      problems.push(`header says Plugin API ${header[2]}, SDK has ${api}`);
    }
  }
  return problems;
}

function main() {
  const read = (file) => fs.readFileSync(path.join(SDK, file), "utf8");
  const pkg = JSON.parse(read("package.json"));
  const problems = findProblems({
    guide: read("PLUGIN-GUIDE.md"),
    commands: cliCommands(read("cli/index.mjs")),
    capabilities: capabilityIds(read("src/capabilities.ts")),
    entries: entryPoints(pkg),
    sdkVersion: pkg.version,
    api: apiVersion(read("src/manifest.ts")),
  });
  if (!pkg.files?.includes("PLUGIN-GUIDE.md")) {
    problems.push(
      '"PLUGIN-GUIDE.md" is not in the SDK package.json files list',
    );
  }
  if (problems.length > 0) {
    console.error(
      "check-sdk-guide: update packages/plugin-sdk/PLUGIN-GUIDE.md",
    );
    for (const problem of problems) console.error(`  ${problem}`);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = {
  cliCommands,
  capabilityIds,
  entryPoints,
  apiVersion,
  findProblems,
};
