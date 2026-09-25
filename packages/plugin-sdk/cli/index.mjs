#!/usr/bin/env node
/**
 * termix-plugin: build, validate, test, pack and sign a Termix plugin.
 *
 * Run from a plugin directory (npm run build inside plugins/<id>/ does).
 */

import process from "node:process";
import { build } from "./commands/build.mjs";
import { validate } from "./commands/validate.mjs";
import { test } from "./commands/test.mjs";
import { pack } from "./commands/pack.mjs";
import { sign, verify, keygen } from "./commands/sign.mjs";
import { migrations } from "./commands/migrations.mjs";

const COMMANDS = {
  build,
  validate,
  test,
  pack,
  sign,
  verify,
  keygen,
  migrations,
};

const [command, ...args] = process.argv.slice(2);

if (!command || command === "--help" || command === "-h") {
  console.log(
    [
      "Usage: termix-plugin <command>",
      "",
      "  build      Bundle the plugin into dist/",
      "  validate   Check manifest.json and the files it names",
      "  test       Run the plugin's vitest suite",
      "  pack       Write <id>-<version>.tmxplug of the built plugin [--out dir]",
      "  sign       Sign a .tmxplug with TERMIX_PLUGIN_SIGNING_KEY <file>",
      "  verify     Check a .tmxplug's .sig <file> --key <base64>[,...]",
      "  keygen     Write a new signing key pair [--out dir]",
      "  migrations Generate migrations from the plugin's table definitions",
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
