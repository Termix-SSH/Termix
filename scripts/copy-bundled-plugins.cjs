/**
 * Copies plugins/ into dist/plugins so bundled first-party plugins ship with a
 * built server.
 *
 * tsc only emits .ts, and a plugin's backend entry is a hand-written .mjs plus
 * a manifest.json, so without this step the plugins directory simply would not
 * exist in dist and the loader would find nothing.
 *
 * getBundledPluginsDir() in src/backend/plugins/paths.ts resolves
 * dist/backend/backend/plugins -> dist/plugins, which is where this writes.
 */

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "plugins");
const destination = path.join(root, "dist", "plugins");

if (!fs.existsSync(source)) {
  console.log("No plugins/ directory, nothing to bundle.");
  process.exit(0);
}

fs.rmSync(destination, { recursive: true, force: true });
fs.cpSync(source, destination, { recursive: true });

const bundled = fs
  .readdirSync(destination, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

console.log(`Bundled ${bundled.length} plugin(s): ${bundled.join(", ")}`);
