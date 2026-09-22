/**
 * Builds every plugin workspace, then stages the result in dist/plugins.
 *
 * getBundledPluginsDir() in src/backend/plugins/paths.ts resolves
 * dist/backend/backend/plugins -> dist/plugins, which is where this writes.
 * Only what a server needs at runtime is copied: the manifest, the built
 * bundles, locales and migrations. Source and tests stay out of the image.
 */

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const source = path.join(root, "plugins");
const destination = path.join(root, "dist", "plugins");
const cli = path.join(root, "packages", "plugin-sdk", "cli", "index.mjs");

const SHIPPED = ["manifest.json", "dist", "locales", "migrations", "README.md"];

if (!fs.existsSync(source)) {
  console.log("No plugins/ directory, nothing to bundle.");
  process.exit(0);
}

const pluginIds = fs
  .readdirSync(source, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .filter((entry) =>
    fs.existsSync(path.join(source, entry.name, "manifest.json")),
  )
  .map((entry) => entry.name);

fs.rmSync(destination, { recursive: true, force: true });

for (const id of pluginIds) {
  const pluginDir = path.join(source, id);

  execFileSync(process.execPath, [cli, "build"], {
    cwd: pluginDir,
    stdio: "inherit",
  });

  const built = path.join(pluginDir, "dist", "backend.js");
  if (!fs.existsSync(built)) {
    throw new Error(`${id} produced no dist/backend.js`);
  }

  const outDir = path.join(destination, id);
  fs.mkdirSync(outDir, { recursive: true });
  for (const entry of SHIPPED) {
    const from = path.join(pluginDir, entry);
    if (!fs.existsSync(from)) continue;
    fs.cpSync(from, path.join(outDir, entry), { recursive: true });
  }
}

console.log(`Bundled ${pluginIds.length} plugin(s): ${pluginIds.join(", ")}`);
