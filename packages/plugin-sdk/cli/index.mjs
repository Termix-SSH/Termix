#!/usr/bin/env node
/**
 * termix-plugin: build, validate, test, pack and sign a Termix plugin.
 *
 * Run from a plugin directory (a plugin repo's npm run build does).
 */

import process from "node:process";
import { applyPatches, build } from "./commands/build.mjs";
import { readManifest } from "./lib/plugin-dir.mjs";
import { validate } from "./commands/validate.mjs";
import { test } from "./commands/test.mjs";
import { pack } from "./commands/pack.mjs";
import { sign, verify, keygen } from "./commands/sign.mjs";
import { migrations } from "./commands/migrations.mjs";
import { dev } from "./commands/dev.mjs";
import { changelog } from "./commands/changelog.mjs";

const COMMANDS = {
  build,
  patch: async ({ cwd }) => applyPatches(cwd, readManifest(cwd).id),
  validate,
  // The tests exercise patched dependencies, so patch first like build does.
  test: async (options) => {
    applyPatches(options.cwd, readManifest(options.cwd).id);
    return test(options);
  },
  pack,
  sign,
  verify,
  keygen,
  migrations,
  dev,
  changelog,
};

const [command, ...args] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log(
    [
      "Usage: termix-plugin <command>",
      "",
      "  build      Bundle the plugin into dist/",
      "  patch      Apply the plugin's dependency patches (build does this too)",
      "  validate   Check manifest.json and the files it names",
      "  test       Apply the patches, then run the plugin's vitest suite",
      "  pack       Write <id>-<version>.tmxplug of the built plugin [--out dir]",
      "  sign       Sign a .tmxplug with TERMIX_PLUGIN_SIGNING_KEY <file>",
      "  verify     Check a .tmxplug's .sig <file> --key <base64>[,...]",
      "  keygen     Write a new signing key pair [--out dir]",
      "  migrations Generate migrations from the plugin's table definitions",
      "  changelog  Print a version's notes from CHANGELOG.md [--version x.y.z]",
      "  dev        Build, pack and install on a running server, again on every change",
      "             [--server url] [--key tmx_...] [--once]",
      "             (or TERMIX_SERVER_URL and TERMIX_API_KEY; needs developer mode)",
    ].join("\n"),
  );
  process.exit(command ? 0 : 1);
}

const run = COMMANDS[command];
if (!run) {
  console.error(`Unknown command: ${command}`);
  process.exit(1);
}

try {
  await run({ cwd: process.cwd(), args });
} catch (error) {
  console.error(error?.message ?? error);
  process.exit(1);
}
