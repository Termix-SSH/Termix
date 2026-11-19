/**
 * The Docker image's root launcher. The entrypoint starts it as root instead
 * of dropping to the node user with gosu. It does two things only:
 *
 *   1. runs the rest of the entrypoint (and so core) as the node user, with a
 *      private umask and an IPC channel back to here;
 *   2. when core asks, starts a plugin process as that plugin's own Linux
 *      user and relays its messages, so the kernel keeps plugins out of
 *      core's files, each other's data and core's process.
 *
 * It refuses any request that is not exactly a plugin start: the script is
 * its own runtime, every flag is checked against a fixed list, the write
 * grant must be the plugin's own data folder and the env is fixed. When the
 * container has NET_ADMIN, plugins without network:sockets also get a
 * firewall rule that rejects their traffic.
 */
import { fork, spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { allocateUid, isPluginId, validateSpawn } from "./policy.js";
import { adoptDataDir, readAdopted, writeAdopted } from "./adopt.js";

const SANDBOX_MESSAGE = "tmx-sandbox";
const here = path.dirname(fileURLToPath(import.meta.url));
const runtime = path.resolve(here, "../child/runtime.js");
const harden = path.resolve(here, "../child/harden.js");
const dataRoot = process.env.DATA_DIR ?? "/app/data";
const uidFile = path.join(dataRoot, ".plugin-uids.json");
const adoptedFile = path.join(dataRoot, ".plugin-data-owners.json");

const [script, ...scriptArgs] = process.argv.slice(2);
const coreUid = Number(process.env.TERMIX_LAUNCHER_UID ?? "1000");
const coreGid = Number(process.env.TERMIX_LAUNCHER_GID ?? "1000");

function log(line: string): void {
  process.stdout.write(`[launcher] ${line}\n`);
}

let nft = false;
function setupFirewall(): void {
  const probe = spawnSync("nft", ["list", "tables"], { stdio: "ignore" });
  if (probe.status !== 0) return;
  const made = spawnSync("nft", ["-f", "-"], {
    input:
      "table inet termix_sandbox\ndelete table inet termix_sandbox\n" +
      "table inet termix_sandbox {\n  chain out {\n    type filter hook output priority 0; policy accept;\n  }\n}\n",
    stdio: ["pipe", "ignore", "ignore"],
  });
  nft = made.status === 0;
  log(
    nft
      ? "plugin firewall rules are on"
      : "no plugin firewall (needs NET_ADMIN)",
  );
}

function firewall(uid: number, rule: "deny" | "allow-all"): void {
  if (!nft) return;
  const list = spawnSync(
    "nft",
    ["-a", "list", "chain", "inet", "termix_sandbox", "out"],
    {
      encoding: "utf8",
    },
  );
  for (const line of (list.stdout ?? "").split("\n")) {
    const match = new RegExp(`meta skuid ${uid} .*# handle (\\d+)`).exec(line);
    if (match) {
      spawnSync("nft", [
        "delete",
        "rule",
        "inet",
        "termix_sandbox",
        "out",
        "handle",
        match[1],
      ]);
    }
  }
  if (rule === "deny") {
    spawnSync("nft", [
      "add",
      "rule",
      "inet",
      "termix_sandbox",
      "out",
      "meta",
      "skuid",
      String(uid),
      "reject",
    ]);
  }
}

const children = new Map<string, ChildProcess>();

function reply(core: ChildProcess, message: Record<string, unknown>): void {
  if (!core.connected) return;
  core.send({ type: SANDBOX_MESSAGE, ...message }, (error) => {
    if (error) log(`could not reach core: ${error.message}`);
  });
}

/**
 * A plugin killed a moment ago can still get messages core sent before it
 * heard. Writing to its closed channel must never take the launcher down.
 */
function sendToPlugin(child: ChildProcess | undefined, message: unknown): void {
  if (!child?.connected) return;
  child.send(message as never, () => {});
}

let sharedUserWarned = false;

/**
 * Makes the plugin's data folder its own and picks the user it runs as. On
 * storage that refuses chown (some network shares) the plugin runs as core's
 * user instead, as it does when the launcher isn't root, and core says so.
 */
function prepareUser(
  pluginId: string,
  dataDir: string,
): { uid: number; gid: number } {
  fs.mkdirSync(path.dirname(dataDir), { recursive: true, mode: 0o711 });
  fs.chmodSync(path.dirname(dataDir), 0o711);
  fs.mkdirSync(dataDir, { recursive: true });
  const uid = allocateUid(uidFile, pluginId);
  try {
    // The plugin's user owns it; core's group keeps access (setgid) so core
    // can still remove it on uninstall. Other plugins can't get in.
    fs.chownSync(dataDir, uid, coreGid);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EPERM" && code !== "EINVAL") throw error;
    if (!sharedUserWarned) {
      sharedUserWarned = true;
      log(
        `the data folder does not allow changing owners (${code}), so plugins run as Termix's own user and are less isolated from each other`,
      );
    }
    fs.chmodSync(dataDir, 0o770);
    return { uid: coreUid, gid: coreGid };
  }
  fs.chmodSync(dataDir, 0o2770);
  // What core saved there before plugins had their own users stays core's
  // until handed over, and the plugin can't write it. Done once per user.
  const adopted = readAdopted(adoptedFile);
  if (adopted[pluginId] !== uid) {
    try {
      const changed = adoptDataDir(dataDir, uid, coreGid);
      if (changed > 0) log(`gave ${pluginId} ${changed} existing file(s)`);
      writeAdopted(adoptedFile, { ...adopted, [pluginId]: uid });
    } catch (error) {
      log(
        `could not hand over ${pluginId}'s files: ${(error as Error).message}`,
      );
    }
  }
  return { uid, gid: uid };
}

function startPlugin(
  core: ChildProcess,
  request: Record<string, unknown>,
): void {
  const id = String(request.id ?? "");
  const verdict = validateSpawn(request, {
    hardenUrl: pathToFileURL(harden).href,
    dataRoot,
  });
  if (!verdict.ok) {
    log(`refused a plugin start: ${verdict.reason}`);
    reply(core, { op: "error", id, message: verdict.reason });
    return;
  }
  const pluginId = String(request.pluginId);
  const dataDir = String(request.dataDir);
  let uid: number;
  let gid: number;
  try {
    ({ uid, gid } = prepareUser(pluginId, dataDir));
  } catch (error) {
    // One plugin that can't start must never take the server down with it.
    const message = (error as Error).message;
    log(`could not start ${pluginId}: ${message}`);
    reply(core, { op: "error", id, message });
    return;
  }
  if (uid !== coreUid) {
    firewall(uid, request.firewall === "allow-all" ? "allow-all" : "deny");
  }

  // Files the plugin makes stay readable by core's group and nobody else.
  process.umask(0o007);
  const child = fork(runtime, [], {
    execArgv: request.execArgv as string[],
    // Already checked by validateSpawn: NODE_ENV, the plugin id and the
    // variables the plugin's manifest lists, never one of core's.
    env: request.env as Record<string, string>,
    uid,
    gid,
    cwd: dataDir,
    serialization: "advanced",
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.set(id, child);
  child.once("spawn", () => reply(core, { op: "spawned", id, pid: child.pid }));
  // Every error, not just the first: a dead channel errors on each write.
  child.on("error", (error) =>
    reply(core, { op: "error", id, message: error.message }),
  );
  child.on("message", (m) => reply(core, { op: "msg", id, m }));
  for (const [stream, name] of [
    [child.stdout, "out"],
    [child.stderr, "err"],
  ] as const) {
    let buffer = "";
    stream?.setEncoding("utf8");
    stream?.on("data", (chunk: string) => {
      buffer += chunk;
      let index = buffer.indexOf("\n");
      while (index >= 0) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);
        if (line)
          reply(core, {
            op: "log",
            id,
            stream: name,
            line: line.slice(0, 4000),
          });
        index = buffer.indexOf("\n");
      }
      if (buffer.length > 64 * 1024) buffer = "";
    });
  }
  child.once("exit", (code, signal) => {
    children.delete(id);
    reply(core, { op: "exit", id, code, signal });
  });
}

function main(): void {
  if (!script) {
    log("nothing to run");
    process.exit(2);
  }
  if (process.getuid?.() !== 0) {
    log("not root, so plugins share core's user");
  }
  setupFirewall();
  // Core's files (the database, keys, settings) are its user's only.
  process.umask(0o077);
  const core = spawn(script, scriptArgs, {
    uid: coreUid,
    gid: coreGid,
    env: { ...process.env, TERMIX_PLUGIN_LAUNCHER: "1" },
    stdio: ["inherit", "inherit", "inherit", "ipc"],
    serialization: "advanced",
  });
  core.on("message", (raw) => {
    const message = raw as Record<string, unknown>;
    if (!message || message.type !== SANDBOX_MESSAGE) return;
    const id = String(message.id ?? "");
    switch (message.op) {
      case "spawn":
        if (children.has(id) || !isPluginId(String(message.pluginId ?? ""))) {
          reply(core, { op: "error", id, message: "bad request" });
          return;
        }
        try {
          startPlugin(core, message);
        } catch (error) {
          log(`could not start a plugin: ${(error as Error).message}`);
          reply(core, { op: "error", id, message: "spawn failed" });
        }
        return;
      case "msg":
        sendToPlugin(children.get(id), message.m);
        return;
      case "kill":
        children.get(id)?.kill("SIGKILL");
        return;
    }
  });
  for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) {
    process.on(signal, () => core.kill(signal));
  }
  core.on("error", (error) => log(`core channel: ${error.message}`));
  core.once("exit", (code, signal) => {
    for (const child of children.values()) child.kill("SIGKILL");
    process.exit(code ?? (signal ? 128 + 15 : 1));
  });
}

main();
