/**
 * Stages the plugins listed in docker/bundled-plugins.json in dist/plugins.
 *
 * getBundledPluginsDir() in src/backend/plugins/paths.ts resolves
 * dist/backend/backend/plugins -> dist/plugins, which is where this writes.
 * Each .tmxplug is downloaded (or read from a path), checked against its
 * pinned sha256 and unpacked.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  loadBundledPlugins,
  fetchArtifact,
  extractArtifact,
} = require("./lib/bundled-plugins.cjs");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "dist", "plugins");

async function main() {
  const plugins = loadBundledPlugins(root);

  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  for (const plugin of plugins) {
    const buffer = await fetchArtifact(plugin, root);
    await extractArtifact(buffer, path.join(destination, plugin.id), plugin.id);
    console.log(`unpacked ${plugin.id}`);
  }

  console.log(
    `Bundled ${plugins.length} plugin(s): ${plugins.map((p) => p.id).join(", ")}`,
  );
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
