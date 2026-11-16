// Builds the hostile fixtures with the SDK CLI and stages them, plus any
// other local plugin builds, into a folder core loads as its bundled plugins.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
export const coreDir = path.resolve(here, "../../..");
export const fixturesDir = path.resolve(here, "../plugins");
export const FIXTURES = [
  "hostile-victim",
  "hostile-backend",
  "hostile-frame",
  "hostile-crash",
];

export function buildFixtures(log) {
  const cli = path.join(coreDir, "packages/plugin-sdk/cli/index.mjs");
  for (const id of FIXTURES) {
    const cwd = path.join(fixturesDir, id);
    const result = spawnSync(process.execPath, [cli, "build"], {
      cwd,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      throw new Error(
        `build ${id} failed:\n${result.stdout}\n${result.stderr}`,
      );
    }
  }
  log?.(`built ${FIXTURES.length} fixtures`);
}

/**
 * Copies the fixtures and the given local plugin repos into target, and
 * writes the bundled index core reads. Returns target.
 */
export function stagePlugins(
  target,
  { localParents = [], localRepos = [] } = {},
) {
  const lib = require("../../lib/bundled-plugins.cjs");
  const builds = new Map();
  for (const parent of localParents) {
    for (const [id, repo] of lib.findLocalPluginBuilds(path.resolve(parent))) {
      builds.set(id, repo);
    }
  }
  for (const repo of localRepos) {
    const { id } = JSON.parse(
      fs.readFileSync(path.join(repo, "manifest.json"), "utf8"),
    );
    builds.set(id, path.resolve(repo));
  }
  for (const id of FIXTURES) builds.set(id, path.join(fixturesDir, id));
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(target, { recursive: true });
  for (const [id, repo] of builds) {
    lib.copyLocalBuild(repo, path.join(target, id));
  }
  const pinned = lib.loadBundledPlugins(coreDir);
  const index = lib.buildBundledIndex(pinned, [...builds.keys()], "full");
  fs.writeFileSync(
    path.join(target, "bundled-index.json"),
    `${JSON.stringify(index, null, 2)}\n`,
  );
  return { target, ids: [...builds.keys()] };
}
