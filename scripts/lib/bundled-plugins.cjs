/**
 * Reads docker/bundled-plugins.json: which plugins ship in the image and
 * where each comes from.
 *
 *   { "id": "x", "source": "workspace" }                    built from plugins/x
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

function parseBundledPlugins(raw, workspaceIds) {
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

    if (entry.source === "workspace") {
      if (!workspaceIds.includes(entry.id)) {
        problems.push(
          `${entry.id} is a workspace plugin but plugins/${entry.id} does not exist`,
        );
        continue;
      }
      plugins.push({ id: entry.id, source: "workspace" });
    } else if (entry.source === "tmxplug") {
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
      if (workspaceIds.includes(entry.id)) {
        problems.push(
          `${entry.id} comes from a .tmxplug, so delete plugins/${entry.id}`,
        );
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

  for (const id of workspaceIds) {
    if (!seen.has(id)) {
      problems.push(
        `plugins/${id} is not listed in docker/bundled-plugins.json`,
      );
    }
  }

  return { plugins, problems };
}

function loadBundledPlugins(root) {
  const configPath = path.join(root, "docker", "bundled-plugins.json");
  const pluginsDir = path.join(root, "plugins");
  const workspaceIds = fs.existsSync(pluginsDir)
    ? fs
        .readdirSync(pluginsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .filter((entry) =>
          fs.existsSync(path.join(pluginsDir, entry.name, "manifest.json")),
        )
        .map((entry) => entry.name)
        .sort()
    : [];

  const raw = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const { plugins, problems } = parseBundledPlugins(raw, workspaceIds);
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

module.exports = {
  parseBundledPlugins,
  loadBundledPlugins,
  checkSha256,
  fetchArtifact,
  extractArtifact,
};
