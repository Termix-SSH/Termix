// Finds the pinned Node and the OS sandbox helper the desktop app runs
// plugin backends with, and checks them before the first plugin starts.
// The expected hashes sit in plugin-runtime.lock.json inside app.asar, which
// the asar integrity fuse covers. Signed macOS builds are checked with
// codesign instead, since signing rewrites the files.

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { runtimeHash } = require("./runtime-hash.cjs");

function binaryNames(platform) {
  const exe = platform === "win32" ? ".exe" : "";
  return { NODE: `node${exe}`, JAIL: `termix-plugin-jail${exe}` };
}

/** Where the runtime folder is for this build. */
function runtimeDir({ isPackaged, resourcesPath, appRoot, platform, arch }) {
  if (isPackaged) return path.join(resourcesPath, "plugin-runtime");
  return path.join(appRoot, ".plugin-runtime", `${platform}-${arch}`);
}

function readLock(lockPath) {
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function teamOf(target) {
  const out = spawnSync("/usr/bin/codesign", ["-dv", "--verbose=2", target], {
    encoding: "utf8",
  });
  if (out.status !== 0) return null;
  const match = /TeamIdentifier=([A-Z0-9]+)/.exec(String(out.stderr));
  return match ? match[1] : null;
}

function codesignValid(file) {
  const out = spawnSync("/usr/bin/codesign", ["--verify", "--strict", file]);
  return out.status === 0;
}

/**
 * Checks the runtime once. Returns { node, jail, dir } or { error }.
 * deps lets tests stand in for the file system and codesign.
 */
function checkRuntime(options, deps = {}) {
  const {
    platform = process.platform,
    arch = process.arch,
    lockPath = path.join(__dirname, "plugin-runtime.lock.json"),
    appBundle = null,
  } = options;
  const hash = deps.hash ?? runtimeHash;
  const exists = deps.exists ?? fs.existsSync;
  const team = deps.teamOf ?? teamOf;
  const valid = deps.codesignValid ?? codesignValid;
  const { NODE, JAIL } = binaryNames(platform);
  const dir = runtimeDir({ ...options, platform, arch });
  const node = path.join(dir, NODE);
  const jail = path.join(dir, JAIL);
  const key = `${platform}-${arch}`;

  if (!exists(node)) {
    return {
      error: `This desktop build (${key}) has no fenced plugin runtime, so plugin backends can't run here.`,
      unsupported: true,
    };
  }
  if (!exists(jail)) {
    return { error: "The plugin sandbox helper is missing." };
  }
  const lock = readLock(lockPath);
  const expected = lock?.files?.[key];
  if (!expected) return { error: "The plugin runtime lock is missing." };

  const names = [NODE, JAIL];
  for (const extra of Object.keys(expected)) {
    if (!names.includes(extra)) names.push(extra);
  }
  const appTeam = platform === "darwin" && appBundle ? team(appBundle) : null;
  for (const name of names) {
    const file = path.join(dir, name);
    if (!exists(file))
      return { error: `The plugin runtime is missing ${name}.` };
    if (appTeam) {
      // A signed app: each runtime file must carry a valid signature from
      // the same team.
      if (!valid(file) || team(file) !== appTeam) {
        return {
          error: `The plugin runtime file ${name} is not signed by Termix.`,
        };
      }
      continue;
    }
    if (!expected[name] || hash(file) !== expected[name]) {
      return {
        error: `The plugin runtime file ${name} does not match this build.`,
      };
    }
  }
  return { node, jail, dir, version: lock.version };
}

module.exports = { checkRuntime, runtimeDir, binaryNames };
