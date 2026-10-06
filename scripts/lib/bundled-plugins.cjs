/**
 * Reads docker/bundled-plugins.json: which plugins ship in the image and
 * where each comes from.
 *
 *   { "id": "x", "source": "tmxplug", "url": "...", "sha256": "..." }
 *   { "id": "x", "source": "tmxplug", "path": "...", "sha256": "..." }
 *
 * A tmxplug entry is pinned by sha256 in this file, which is reviewed like
 * any other change, so the build does not need the registry signature.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const ID = /^[a-z0-9][a-z0-9-]*$/;
const SHA256 = /^[0-9a-f]{64}$/;

function parseBundledPlugins(raw) {
  const problems = [];
  const list = raw && Array.isArray(raw.plugins) ? raw.plugins : null;
  if (!list) {
    return {
      plugins: [],
      problems: ['bundled-plugins.json needs a "plugins" array'],
    };
  }

  const seen = new Set();
  const plugins = [];
  for (const [index, entry] of list.entries()) {
    const where = `plugins[${index}]`;
    if (!entry || typeof entry.id !== "string" || !ID.test(entry.id)) {
      problems.push(`${where} needs a valid id`);
      continue;
    }
    if (seen.has(entry.id)) {
      problems.push(`${entry.id} is listed twice`);
      continue;
    }
    seen.add(entry.id);

    if (entry.source === "tmxplug") {
      const hasUrl =
        typeof entry.url === "string" && entry.url.startsWith("https://");
      const hasPath = typeof entry.path === "string" && entry.path.length > 0;
      if (hasUrl === hasPath) {
        problems.push(
          `${entry.id} needs exactly one of an https url or a path`,
        );
        continue;
      }
      if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
        problems.push(`${entry.id} needs a lowercase hex sha256`);
        continue;
      }
      plugins.push({
        id: entry.id,
        source: "tmxplug",
        url: hasUrl ? entry.url : null,
        path: hasPath ? entry.path : null,
        sha256: entry.sha256,
      });
    } else {
      problems.push(`${entry.id} has an unknown source "${entry.source}"`);
    }
  }

  return { plugins, problems };
}

function loadBundledPlugins(root) {
  const configPath = path.join(root, "docker", "bundled-plugins.json");
  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const { plugins, problems } = parseBundledPlugins(raw);
  if (problems.length > 0) {
    throw new Error(`docker/bundled-plugins.json:\n  ${problems.join("\n  ")}`);
  }
  return plugins;
}

/** Refuses an artifact whose bytes are not the ones the config pinned. */
function checkSha256(buffer, expected, id) {
  const actual = crypto.createHash("sha256").update(buffer).digest("hex");
  if (actual !== expected) {
    throw new Error(
      `${id}: sha256 is ${actual}, bundled-plugins.json pins ${expected}`,
    );
  }
}

/**
 * The .tmxplug bytes for an entry: a local path, or a download cached by
 * sha256 so rebuilds do not fetch it again.
 */
async function fetchArtifact(entry, root, fetchImpl = fetch) {
  if (entry.path) {
    const buffer = fs.readFileSync(path.resolve(root, entry.path));
    checkSha256(buffer, entry.sha256, entry.id);
    return buffer;
  }

  const cacheDir = path.join(
    root,
    "node_modules",
    ".cache",
    "termix-bundled-plugins",
  );
  const cached = path.join(cacheDir, `${entry.sha256}.tmxplug`);
  if (fs.existsSync(cached)) {
    const buffer = fs.readFileSync(cached);
    checkSha256(buffer, entry.sha256, entry.id);
    return buffer;
  }

  const response = await fetchImpl(entry.url);
  if (!response.ok) {
    throw new Error(`${entry.id}: download failed with ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  checkSha256(buffer, entry.sha256, entry.id);
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(cached, buffer);
  return buffer;
}

/** Unpacks a checked .tmxplug into outDir and confirms its manifest id. */
async function extractArtifact(buffer, outDir, id) {
  const tar = require("tar");
  const { Readable } = require("node:stream");
  const { pipeline } = require("node:stream/promises");

  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  await pipeline(
    Readable.from(buffer),
    tar.x({
      cwd: outDir,
      strict: true,
      filter: (_p, entry) =>
        entry.type === "File" || entry.type === "Directory",
    }),
  );

  const manifestPath = path.join(outDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`${id}: the .tmxplug has no manifest.json`);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (manifest.id !== id) {
    throw new Error(`${id}: the .tmxplug is for "${manifest.id}"`);
  }
}

/**
 * Pins the newest registry version of each wanted plugin. `ids` is the list
 * to pin, or null for every plugin in the index.
 */
function pinsFromIndex(index, ids) {
  const plugins = Array.isArray(index?.plugins) ? index.plugins : [];
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const wanted = ids ?? plugins.map((plugin) => plugin.id);
  return [...wanted].sort().map((id) => {
    const latest = byId.get(id)?.versions?.[0];
    if (!latest) throw new Error(`${id} is not in the registry index`);
    return {
      id,
      source: "tmxplug",
      url: latest.url,
      sha256: latest.sha256,
    };
  });
}

const LOCAL_FILES = [
  "manifest.json",
  "dist",
  "locales",
  "migrations",
  "README.md",
  "CHANGELOG.json",
];

/**
 * Built plugin repos under dir (each with manifest.json and dist/), by id.
 * Used in development to stage local plugin builds instead of the pins.
 */
function findLocalPluginBuilds(dir) {
  const builds = new Map();
  if (!dir || !fs.existsSync(dir)) return builds;
  for (const name of fs.readdirSync(dir)) {
    const repo = path.join(dir, name);
    const manifestPath = path.join(repo, "manifest.json");
    if (!fs.existsSync(manifestPath)) continue;
    if (!fs.existsSync(path.join(repo, "dist"))) continue;
    try {
      const { id } = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      if (typeof id === "string" && ID.test(id)) builds.set(id, repo);
    } catch {
      // not a plugin repo
    }
  }
  return builds;
}

/** Copies a local plugin build into the staging folder. */
function copyLocalBuild(repo, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of LOCAL_FILES) {
    const from = path.join(repo, entry);
    if (fs.existsSync(from)) {
      fs.cpSync(from, path.join(destination, entry), { recursive: true });
    }
  }
}

module.exports = {
  findLocalPluginBuilds,
  copyLocalBuild,
  parseBundledPlugins,
  pinsFromIndex,
  loadBundledPlugins,
  checkSha256,
  fetchArtifact,
  extractArtifact,
};
