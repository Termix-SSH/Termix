/**
 * Runs every plugin's own vitest suite.
 *
 * Core's `npm run test` covers src/ only. A plugin's tests live beside it and
 * run under its own config, so a plugin that moves out of this repo keeps a
 * working suite.
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "plugins");
const cli = path.join(root, "packages", "plugin-sdk", "cli", "index.mjs");

const pluginIds = fs
  .readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) =>
    fs.existsSync(path.join(source, entry.name, "vitest.config.ts")),
  )
  .map((entry) => entry.name);

const failed = [];

for (const id of pluginIds) {
  const pluginDir = path.join(source, id);

  const hasTests = ["tests/backend", "tests/frontend"].some((dir) => {
    const full = path.join(pluginDir, dir);
    return (
      fs.existsSync(full) &&
      fs
        .readdirSync(full, { recursive: true })
        .some(
          (name) =>
            String(name).endsWith(".test.ts") ||
            String(name).endsWith(".test.tsx"),
        )
    );
  });
  if (!hasTests) continue;

  const result = spawnSync(process.execPath, [cli, "test"], {
    cwd: pluginDir,
    stdio: "inherit",
  });
  if (result.status !== 0) failed.push(id);
}

if (failed.length > 0) {
  console.error(`\nPlugin tests failed: ${failed.join(", ")}`);
  process.exit(1);
}

console.log(`\nPlugin tests passed for ${pluginIds.length} plugin(s).`);
