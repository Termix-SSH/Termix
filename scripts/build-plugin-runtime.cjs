#!/usr/bin/env node
// Builds the desktop plugin runtime: the pinned Node from
// electron/plugin-node.json (checked against its sha256) and the OS sandbox
// helper from native/plugin-jail, into .plugin-runtime/<platform>-<arch>.
// Then writes electron/plugin-runtime.lock.json with their hashes, which the
// app checks before it starts a plugin.
//
//   node scripts/build-plugin-runtime.cjs [--platform win32] [--arch x64,arm64]
//
// An arch with no pinned Node gets an empty
// folder, and that build refuses plugin backends.

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");
const { runtimeHash } = require("../electron/runtime-hash.cjs");

const root = path.resolve(__dirname, "..");
const pin = require("../electron/plugin-node.json");
const outRoot = path.join(root, ".plugin-runtime");
const cacheDir = path.join(outRoot, ".cache");
const lockPath = path.join(root, "electron", "plugin-runtime.lock.json");
const jailDir = path.join(root, "native", "plugin-jail");

const TRIPLES = {
  "win32-x64": "x86_64-pc-windows-msvc",
  "win32-arm64": "aarch64-pc-windows-msvc",
  "darwin-x64": "x86_64-apple-darwin",
  "darwin-arm64": "aarch64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
};

/** Where a Linux build host keeps libatomic for each arch. */
const LIBATOMIC = {
  x64: [
    "/usr/lib/x86_64-linux-gnu/libatomic.so.1",
    "/usr/lib64/libatomic.so.1",
    "/usr/x86_64-linux-gnu/lib/libatomic.so.1",
  ],
  arm64: [
    "/usr/aarch64-linux-gnu/lib/libatomic.so.1",
    "/usr/lib/aarch64-linux-gnu/libatomic.so.1",
  ],
};

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function sha256(file) {
  return crypto
    .createHash("sha256")
    .update(fs.readFileSync(file))
    .digest("hex");
}

async function download(build) {
  fs.mkdirSync(cacheDir, { recursive: true });
  const file = path.join(cacheDir, build.file);
  if (!fs.existsSync(file) || sha256(file) !== build.sha256) {
    const url = `https://nodejs.org/dist/v${pin.version}/${build.file}`;
    console.log(`downloading ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    fs.writeFileSync(file, Buffer.from(await response.arrayBuffer()));
  }
  const actual = sha256(file);
  if (actual !== build.sha256) {
    fs.rmSync(file, { force: true });
    throw new Error(`${build.file}: sha256 ${actual} is not the pinned one`);
  }
  return file;
}

/** The system tar reads zip on Windows (bsdtar); GNU tar from Git Bash does not. */
function tarBinary() {
  if (process.platform !== "win32") return "tar";
  return path.join(
    process.env.SystemRoot || "C:\\Windows",
    "System32",
    "tar.exe",
  );
}

function extractNode(archive, platform, outDir) {
  const base = path.basename(archive).replace(/\.(zip|tar\.gz|tar\.xz)$/, "");
  const member = platform === "win32" ? `${base}/node.exe` : `${base}/bin/node`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "termix-node-"));
  try {
    execFileSync(tarBinary(), ["-xf", archive, "-C", temp, member], {
      stdio: "inherit",
    });
    const name = platform === "win32" ? "node.exe" : "node";
    fs.copyFileSync(path.join(temp, member), path.join(outDir, name));
    fs.chmodSync(path.join(outDir, name), 0o755);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

function buildJail(platform, arch, outDir) {
  const triple = TRIPLES[`${platform}-${arch}`];
  const env = { ...process.env };
  if (platform === "linux") {
    // Static musl, linked by rust-lld, so one runner builds both arches.
    env.RUSTFLAGS = "-Clinker=rust-lld -Clink-self-contained=yes";
  }
  execFileSync(
    "cargo",
    ["build", "--release", "--locked", "--target", triple],
    { cwd: jailDir, stdio: "inherit", env },
  );
  const name =
    platform === "win32" ? "termix-plugin-jail.exe" : "termix-plugin-jail";
  const from = path.join(jailDir, "target", triple, "release", name);
  fs.copyFileSync(from, path.join(outDir, name));
  fs.chmodSync(path.join(outDir, name), 0o755);
}

function copyLibatomic(arch, outDir) {
  const found = (LIBATOMIC[arch] ?? []).find((file) => fs.existsSync(file));
  if (!found) {
    throw new Error(
      `libatomic.so.1 for ${arch} not found; install libatomic1 (or libatomic1-arm64-cross)`,
    );
  }
  fs.copyFileSync(found, path.join(outDir, "libatomic.so.1"));
}

function readLock() {
  try {
    const lock = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (lock.version === pin.version) return lock;
  } catch {
    // start a new one
  }
  return { version: pin.version, files: {} };
}

async function main() {
  const platform = arg("platform", process.platform);
  const arches = arg("arch", process.arch).split(",").filter(Boolean);
  const lock = readLock();
  for (const arch of arches) {
    const key = `${platform}-${arch}`;
    const outDir = path.join(outRoot, key);
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    const build = pin.builds[key];
    if (!build) {
      console.log(
        `${key}: no pinned Node, plugin backends stay off in this build`,
      );
      delete lock.files[key];
      continue;
    }
    extractNode(await download(build), platform, outDir);
    buildJail(platform, arch, outDir);
    if (platform === "linux") copyLibatomic(arch, outDir);
    const files = {};
    for (const name of fs.readdirSync(outDir).sort()) {
      files[name] = runtimeHash(path.join(outDir, name));
    }
    lock.files[key] = files;
    console.log(`${key}: ${Object.keys(files).join(", ")}`);
  }
  fs.writeFileSync(lockPath, `${JSON.stringify(lock, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
