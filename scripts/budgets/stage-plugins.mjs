#!/usr/bin/env node
// Clones every official plugin at its newest dev-X.Y.Z branch (main when it
// has none) and installs its dependencies, so build-plugins.cjs --local can
// build them all with this checkout's SDK. Only source is cloned: CI must
// never download a .tmxplug, which would count as a download.
//
//   node scripts/budgets/stage-plugins.mjs <outDir> [--jobs 4]

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { newestDevBranch, parseArgs } from "./lib.mjs";

const run = promisify(execFile);
const INDEX =
  "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/index.json";
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

async function stage(plugin, outDir) {
  const repository = plugin.repository;
  if (!/^https:\/\/github\.com\/Termix-SSH\/[\w.-]+$/.test(repository ?? "")) {
    throw new Error(`No official repository for ${plugin.id}`);
  }
  const { stdout } = await run("git", ["ls-remote", "--heads", repository]);
  const branch =
    newestDevBranch(stdout.split("\n").map((l) => l.split("\t")[1] ?? "")) ??
    "main";
  const dir = path.join(outDir, path.basename(repository));
  fs.rmSync(dir, { recursive: true, force: true });
  await run("git", [
    "clone",
    "--quiet",
    "--depth",
    "1",
    "--branch",
    branch,
    repository,
    dir,
  ]);
  await run(npm, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: dir,
    shell: npm === "npm.cmd",
    maxBuffer: 64 * 1024 * 1024,
  });
  return `${plugin.id}@${branch}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const outDir = process.argv[2];
  if (!outDir || outDir.startsWith("--")) {
    console.error("usage: stage-plugins.mjs <outDir> [--jobs 4]");
    process.exit(2);
  }
  fs.mkdirSync(outDir, { recursive: true });
  const index = await (await fetch(INDEX)).json();
  const queue = [...index.plugins];
  const jobs = Number(args.jobs ?? 4);
  const failed = [];
  await Promise.all(
    Array.from({ length: jobs }, async () => {
      for (let plugin = queue.shift(); plugin; plugin = queue.shift()) {
        try {
          console.log(await stage(plugin, outDir));
        } catch (error) {
          failed.push(plugin.id);
          console.error(`${plugin.id}: ${error.message}`);
        }
      }
    }),
  );
  if (failed.length > 0) {
    console.error(`could not stage: ${failed.join(", ")}`);
    process.exit(1);
  }
}

await main();
