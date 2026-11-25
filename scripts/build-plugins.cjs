/**
 * Stages the plugins listed in docker/bundled-plugins.json in dist/plugins.
 *
 * getBundledPluginsDir() in src/backend/plugins/paths.ts resolves
 * dist/backend/backend/plugins -> dist/plugins, which is where this writes.
 * --profile minimal|standard|full (or TERMIX_PLUGIN_PROFILE, default standard)
 * picks which tiers of the file are staged.
 * Each .tmxplug is downloaded (or read from a path), checked against its
 * pinned sha256 and unpacked.
 *
 * For development, `--local <dir>` (or TERMIX_LOCAL_PLUGINS) points at a
 * folder of plugin repos like ../Plugins. A plugin there whose sources
 * changed since its last build is rebuilt first with this checkout's SDK, so
 * SDK edits apply without publishing, then any built one (has
 * dist/) is copied in place of its pin, or added when it has no pin.
 */

const crypto = require("node:crypto");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {
  loadBundledPlugins,
  fetchArtifact,
  extractArtifact,
  findLocalPluginBuilds,
  rebuildLocalPlugins,
  localSdkBuildCommand,
  copyLocalBuild,
  buildBundledIndex,
  resolveProfile,
  pluginsForProfile,
} = require("./lib/bundled-plugins.cjs");

const root = path.resolve(__dirname, "..");
const destination = path.join(root, "dist", "plugins");
const artifactCacheDir = path.join(
  root,
  "node_modules",
  ".cache",
  "termix-bundled-plugins",
);
const DOWNLOAD_CONCURRENCY = 4;

async function fetchArtifactCached(plugin) {
  const sha = typeof plugin.sha256 === "string" ? plugin.sha256.trim() : "";
  const safeSha = /^[a-f0-9]{64}$/i.test(sha) ? sha.toLowerCase() : "";
  const cachePath = safeSha
    ? path.join(artifactCacheDir, `${safeSha}.tmxplug`)
    : null;
  if (cachePath && fs.existsSync(cachePath)) {
    const cached = fs.readFileSync(cachePath);
    const actual = crypto.createHash("sha256").update(cached).digest("hex");
    if (actual === safeSha) {
      return cached;
    }
  }
  const buffer = await fetchArtifact(plugin, root);
  if (cachePath) {
    try {
      fs.mkdirSync(artifactCacheDir, { recursive: true });
      const tmp = `${cachePath}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, buffer);
      fs.renameSync(tmp, cachePath);
    } catch {
      // Cache write failure is non-fatal.
    }
  }
  return buffer;
}

async function runWithConcurrency(items, limit, worker) {
  let nextIndex = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (nextIndex < items.length) {
        const current = items[nextIndex++];
        await worker(current);
      }
    },
  );
  await Promise.all(runners);
}

async function main() {
  const profile = resolveProfile();
  const plugins = pluginsForProfile(loadBundledPlugins(root), profile);
  const flag = process.argv.indexOf("--local");
  const localArg =
    flag !== -1 ? process.argv[flag + 1] : process.env.TERMIX_LOCAL_PLUGINS;
  const localDir = localArg ? path.resolve(root, localArg) : null;
  const [node, buildArgs] = localSdkBuildCommand();
  rebuildLocalPlugins(localDir, null, (repo, id) => {
    console.log(`building ${id}`);
    execFileSync(node, buildArgs, { cwd: repo, stdio: "inherit" });
  });
  const local = findLocalPluginBuilds(localDir);

  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });

  await runWithConcurrency(plugins, DOWNLOAD_CONCURRENCY, async (plugin) => {
    const repo = local.get(plugin.id);
    if (repo) {
      copyLocalBuild(repo, path.join(destination, plugin.id));
      console.log(`copied local build of ${plugin.id}`);
      return;
    }
    const buffer = await fetchArtifactCached(plugin);
    await extractArtifact(buffer, path.join(destination, plugin.id), plugin.id);
    console.log(`unpacked ${plugin.id}`);
  });

  // A local plugin with no pin yet still gets staged, so new plugins work too.
  const pinned = new Set(plugins.map((p) => p.id));
  const extra = [...local.keys()].filter((id) => !pinned.has(id));
  for (const id of extra) {
    copyLocalBuild(local.get(id), path.join(destination, id));
    console.log(`copied local build of ${id} (not pinned)`);
  }

  const staged = [...pinned, ...extra];
  fs.writeFileSync(
    path.join(destination, "bundled-index.json"),
    `${JSON.stringify(buildBundledIndex(plugins, staged, profile), null, 2)}
`,
  );

  console.log(
    `Bundled ${plugins.length + extra.length} plugin(s) (${profile}): ${[...pinned, ...extra].join(", ")}`,
  );
}

main().catch((error) => {
  console.error(error?.message ?? error);
  process.exit(1);
});
