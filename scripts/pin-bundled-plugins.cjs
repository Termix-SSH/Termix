/**
 * Points docker/bundled-plugins.json at the newest version of each plugin in
 * the official registry index. Run it again after a plugin is released or
 * re-released.
 *
 *   node scripts/pin-bundled-plugins.cjs          refresh the plugins already listed
 *   node scripts/pin-bundled-plugins.cjs --all    also add plugins new to the index (tier full)
 *   --core-version X                              skip releases whose engine.termix excludes X
 *
 * The release workflow runs it with --all and the version being released.
 */

const fs = require("node:fs");
const path = require("node:path");
const {
  loadBundledPlugins,
  pinsFromIndex,
} = require("./lib/bundled-plugins.cjs");

const INDEX_URL =
  "https://raw.githubusercontent.com/Termix-SSH/Termix-Registry/main/official/index.json";

const root = path.resolve(__dirname, "..");
const configPath = path.join(root, "docker", "bundled-plugins.json");

async function main() {
  const all = process.argv.includes("--all");
  const flag = process.argv.indexOf("--core-version");
  const coreVersion = flag !== -1 ? process.argv[flag + 1] : null;
  const response = await fetch(INDEX_URL);
  if (!response.ok) {
    throw new Error(`registry index download failed with ${response.status}`);
  }
  const index = await response.json();

  const current = loadBundledPlugins(root);
  const ids = all ? null : current.map((plugin) => plugin.id);
  const plugins = pinsFromIndex(index, ids, current, coreVersion);
  fs.writeFileSync(configPath, `${JSON.stringify({ plugins }, null, 2)}\n`);
  console.log(
    `Pinned ${plugins.length} plugin(s) in docker/bundled-plugins.json`,
  );
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
