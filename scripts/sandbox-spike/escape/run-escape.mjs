// Builds a fake Termix layout, runs probe.mjs as a sandboxed plugin child in
// each mode and prints a table. Usage:
//   node run-escape.mjs [--node <binary>] [--addon <file.node>] [--json out.json]
// Extra env: ESCAPE_ELECTRON=1 runs the child with ELECTRON_RUN_AS_NODE.
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const nodeBin = opt("--node", process.execPath);
const addonPath = opt("--addon", "");
const jsonOut = opt("--json", "");
// A command prefix the child runs under, like "bwrap ... --" or "unshare -rn".
const wrap = opt("--wrap", "").split(" ").filter(Boolean);
const uid = opt("--uid", "");
const gid = opt("--gid", "");
const onlyModes = opt("--modes", "");

const root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-escape-"));
const dataDir = path.join(root, "data");
const appDir = path.join(root, "app");
const pluginDir = path.join(root, "plugins", "probe-plugin");
const ownDataDir = path.join(dataDir, "plugins-data", "probe-plugin");
for (const dir of [dataDir, appDir, pluginDir, ownDataDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const dbFile = path.join(dataDir, "db.sqlite.encrypted");
try {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync(dbFile);
  db.exec("create table t (x)");
  db.close();
} catch {
  fs.writeFileSync(dbFile, crypto.randomBytes(64));
}
const keyFile = path.join(dataDir, ".system-key");
fs.writeFileSync(keyFile, crypto.randomBytes(32).toString("hex"));
const envFile = path.join(appDir, ".env");
fs.writeFileSync(envFile, "FAKE=1\n");
const coreModule = path.join(appDir, "core-module.mjs");
fs.writeFileSync(coreModule, "export const systemKey = 'fake';\n");
fs.copyFileSync(
  path.join(here, "probe.mjs"),
  path.join(pluginDir, "index.mjs"),
);
const symlink = path.join(pluginDir, "db-link");
try {
  fs.symlinkSync(dbFile, symlink);
} catch {
  // Windows without developer mode cannot make symlinks.
}

if (uid) {
  // Core's files stay 0600/0700 and owned by core; the plugin user can only
  // walk to its own folders.
  fs.chmodSync(root, 0o711);
  fs.chmodSync(path.join(root, "plugins"), 0o755);
  fs.chmodSync(dataDir, 0o711);
  fs.chmodSync(path.join(dataDir, "plugins-data"), 0o711);
  fs.chmodSync(dbFile, 0o600);
  fs.chmodSync(coreModule, 0o600);
  fs.chmodSync(keyFile, 0o600);
  fs.chmodSync(appDir, 0o700);
  for (const f of fs.readdirSync(pluginDir)) {
    const file = path.join(pluginDir, f);
    // chmod follows symlinks, which would loosen the db itself.
    if (!fs.lstatSync(file).isSymbolicLink()) fs.chmodSync(file, 0o644);
  }
  fs.chmodSync(pluginDir, 0o755);
  fs.chownSync(ownDataDir, Number(uid), Number(gid));
}

const coreServer = net.createServer((s) => s.destroy());
await new Promise((r) => coreServer.listen(0, "127.0.0.1", r));
const pipePath =
  process.platform === "win32"
    ? `\\\\.\\pipe\\termix-escape-${process.pid}`
    : path.join(root, "core.sock");
const pipeServer = net.createServer((s) => s.destroy());
await new Promise((r) => pipeServer.listen(pipePath, r));

const cfg = {
  dbFile,
  keyFile,
  envFile,
  dataDir,
  pluginDir,
  ownDataDir,
  symlink,
  addonPath,
  corePid: process.pid,
  corePort: coreServer.address().port,
  pipePath,
  internetIp: "1.1.1.1",
  internetHost: "example.com",
  coreModuleUrl: pathToFileURL(coreModule).href,
};

const fsFlags = [
  "--permission",
  `--allow-fs-read=${pluginDir}`,
  `--allow-fs-write=${ownDataDir}`,
];
const harden = path.join(pluginDir, "..", "harden.mjs");
fs.copyFileSync(path.join(here, "harden.mjs"), harden);
const modes = {
  "no sandbox": [],
  "--permission": fsFlags,
  "--permission + harden": [
    "--permission",
    `--allow-fs-read=${pluginDir}`,
    `--allow-fs-read=${harden}`,
    `--allow-fs-write=${ownDataDir}`,
    `--import=${pathToFileURL(harden).href}`,
  ],
  "--permission --allow-net": [...fsFlags, "--allow-net"],
};

function runChild(flags) {
  return new Promise((resolve) => {
    const env = { PATH: process.env.PATH ?? "" };
    if (process.env.ESCAPE_ELECTRON === "1") env.ELECTRON_RUN_AS_NODE = "1";
    // A fake secret, so the env probe shows whether core strips them.
    if (flags.length === 0) env.JWT_SECRET = "fake";
    const argv = [
      nodeBin,
      ...flags,
      path.join(pluginDir, "index.mjs"),
      JSON.stringify(cfg),
    ];
    const [cmd, ...rest] = [...wrap, ...argv];
    const child = spawn(cmd, rest, {
      env,
      stdio: ["ignore", "pipe", "pipe", "ipc"],
      ...(uid ? { uid: Number(uid), gid: Number(gid) } : {}),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", () => {
      const line = out.trim().split("\n").pop();
      try {
        resolve(JSON.parse(line));
      } catch {
        resolve([
          { probe: "child start", outcome: "error", detail: err.slice(0, 300) },
        ]);
      }
    });
  });
}

const version = await new Promise((resolve) => {
  const env = { ...process.env };
  if (process.env.ESCAPE_ELECTRON === "1") env.ELECTRON_RUN_AS_NODE = "1";
  const c = spawn(nodeBin, ["-p", "process.version"], { env });
  let v = "";
  c.stdout.on("data", (d) => (v += d));
  c.on("close", () => resolve(v.trim()));
});

const table = {};
if (onlyModes) {
  for (const name of Object.keys(modes)) {
    if (!onlyModes.split(",").includes(name)) delete modes[name];
  }
}
for (const [mode, flags] of Object.entries(modes)) {
  for (const row of await runChild(flags)) {
    table[row.probe] ??= {};
    table[row.probe][mode] = row;
  }
}

coreServer.close();
pipeServer.close();
fs.rmSync(root, { recursive: true, force: true });

const header = `Node ${version} on ${process.platform}${wrap.length ? ` wrapped in "${wrap.join(" ")}"` : ""}${uid ? ` as uid ${uid}` : ""}${process.env.ESCAPE_ELECTRON === "1" ? " (ELECTRON_RUN_AS_NODE)" : ""}`;
console.log(header);
const names = Object.keys(modes);
console.log(["probe", ...names].join(" | "));
for (const [probe, byMode] of Object.entries(table)) {
  console.log(
    [probe, ...names.map((m) => byMode[m]?.outcome ?? "-")].join(" | "),
  );
}
if (jsonOut) {
  fs.writeFileSync(jsonOut, JSON.stringify({ header, table }, null, 2));
}
