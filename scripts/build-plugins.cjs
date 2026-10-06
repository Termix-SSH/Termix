/**
 * Stages the plugins listed in docker/bundled-plugins.json in dist/plugins.
 *
 * getBundledPluginsDir() in src/backend/plugins/paths.ts resolves
 * dist/backend/backend/plugins -> dist/plugins, which is where this writes.
 * Each .tmxplug is downloaded (or read from a path), checked against its
 * pinned sha256 and unpacked.
 *
 * For development, `--local <dir>` (or TERMIX_LOCAL_PLUGINS) points at a
 * folder of plugin repos like ../Termix-Plugins. A bundled plugin there whose
 * sources changed since its last build is rebuilt first, then any built one
 * (has dist/) is copied in place of its pin, so local plugin changes show up.
 */

const { execSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  loadBundledPlugins,
  fetchArtifact,
  extractArtifact,
  findLocalPluginBuilds,
  rebuildLocalPlugins,
  copyLocalBuild,
} = require("./lib/bundled-plugins.cjs");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "dist", "plugins");

async function main() {
  const plugins = loadBundledPlugins(root);
  const flag = process.argv.indexOf("--local");
  const localArg =
    flag !== -1 ? process.argv[flag + 1] : process.env.TERMIX_LOCAL_PLUGINS;
  const localDir = localArg ? path.resolve(root, localArg) : null;
  rebuildLocalPlugins(
    localDir,
    new Set(plugins.map((p) => p.id)),
    (repo, id) => {
      console.log(`building ${id}`);
      execSync("npm run build", { cwd: repo, stdio: "inherit" });
    },
  );
  const local = findLocalPluginBuilds(localDir);

  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  for (const plugin of plugins) {
    const repo = local.get(plugin.id);
    if (repo) {
      copyLocalBuild(repo, path.join(destination, plugin.id));
      console.log(`copied local build of ${plugin.id}`);
      continue;
    }
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
