/**
 * npm run dev, one command for manual testing. Run with --help for the targets
 * and options.
 *
 * Every target builds the SDK and stages plugins (local builds from
 * ../Termix-Plugins when it exists), then:
 *
 * - web: compiles the backend in watch mode, starts it, then starts Vite. A
 *   backend or SDK change restarts the backend. A plugin change rebuilds that
 *   plugin and reloads it inside the running backend, and the browser swaps
 *   it in.
 * - electron: web, plus the desktop app, restarted when electron/ changes.
 * - docker: builds the production image and runs it with dist/plugins
 *   mounted. A plugin change rebuilds it and restarts the container. Core
 *   changes wait for "r", since an image build is slow.
 *
 * --db postgres|mysql and --guacd run those in Docker next to it.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync, fork } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  HELP,
  createDebouncer,
  createSerialQueue,
  dataDirFor,
  findBuildablePlugins,
  isPluginEdit,
  needsDocker,
  parseDevArgs,
  parseTscStatus,
} from "./lib/dev-runner.mjs";
import {
  APP_CONTAINER,
  APP_IMAGE,
  NETWORK,
  SERVICES,
  appRunArgs,
  serviceEnv,
  serviceRunArgs,
} from "./lib/dev-docker.mjs";

const require = createRequire(import.meta.url);
const {
  copyLocalBuild,
  localSdkBuildCommand,
} = require("./lib/bundled-plugins.cjs");

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(
  root,
  "dist",
  "backend",
  "backend",
  "starter.js",
);
const STAGED_PLUGINS = path.join(root, "dist", "plugins");
const SDK_SRC = path.join(root, "packages", "plugin-sdk", "src");
const ELECTRON_DIR = path.join(root, "electron");
const RELOAD_TIMEOUT_MS = 60_000;
const SHUTDOWN_TIMEOUT_MS = 10_000;
const DOCKER_READY_TIMEOUT_MS = 180_000;

const log = (message) => console.log(`\x1b[36m[dev]\x1b[0m ${message}`);
const warn = (message) => console.log(`\x1b[33m[dev]\x1b[0m ${message}`);

let options;
const queue = createSerialQueue();
const startedServices = [];
const watchers = [];
let shuttingDown = false;
let plugins = [];
let vite = null;
let backend = null;
let electron = null;
let tsc = null;
let dockerLogs = null;
let backendEnv = {};

function run(command, args, cwd = root) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: ["ignore", "inherit", "inherit"],
      // npm is a .cmd on Windows and needs the shell, but the shell splits
      // arguments on spaces, so a path like "Personal Projects" gets cut.
      shell: process.platform === "win32" && !path.isAbsolute(command),
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${command} ${args.join(" ")} exited with ${code}`)),
    );
  });
}

function docker(args, { quiet = false } = {}) {
  const result = spawnSync("docker", args, {
    cwd: root,
    encoding: "utf8",
    stdio: quiet ? "pipe" : ["ignore", "inherit", "inherit"],
  });
  return { ok: result.status === 0, out: (result.stdout ?? "").trim() };
}

function watch(target, recursive, onChange) {
  watchers.push(fs.watch(target, { recursive }, onChange));
}

function appUrl() {
  if (options.target === "docker") return `http://localhost:${options.port}`;
  return vite?.resolvedUrls?.local?.[0] ?? "http://localhost:5173";
}

function openBrowser(url) {
  const [command, args] =
    process.platform === "win32"
      ? ["cmd", ["/c", "start", "", url]]
      : process.platform === "darwin"
        ? ["open", [url]]
        : ["xdg-open", [url]];
  spawn(command, args, { stdio: "ignore", detached: true }).unref();
}

// Docker side containers

function assertDocker() {
  if (!docker(["info"], { quiet: true }).ok) {
    throw new Error(
      "Docker is not running. Start it, or drop --db, --guacd and the docker target.",
    );
  }
  if (!docker(["network", "inspect", NETWORK], { quiet: true }).ok) {
    docker(["network", "create", NETWORK], { quiet: true });
  }
}

function containerState(name) {
  const result = docker(["inspect", "-f", "{{.State.Running}}", name], {
    quiet: true,
  });
  if (!result.ok) return "missing";
  return result.out === "true" ? "running" : "stopped";
}

async function waitForService(service) {
  if (!service.ready) return;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    if (
      docker(["exec", service.container, ...service.ready], { quiet: true }).ok
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`${service.container} did not become ready`);
}

async function startService(name) {
  const service = SERVICES[name];
  if (options.fresh && service.volume) {
    docker(["rm", "-f", service.container], { quiet: true });
    docker(["volume", "rm", service.volume[0]], { quiet: true });
  }
  const state = containerState(service.container);
  if (state === "running") {
    log(`${service.container} is already running`);
  } else {
    log(`starting ${service.container}`);
    const result =
      state === "stopped"
        ? docker(["start", service.container], { quiet: true })
        : docker(serviceRunArgs(service), { quiet: true });
    if (!result.ok) throw new Error(`could not start ${service.container}`);
    startedServices.push(service.container);
  }
  await waitForService(service);
}

async function startServices() {
  if (options.db !== "sqlite") await startService(options.db);
  if (options.guacd) await startService("guacd");
}

// Local backend, Vite and Electron

function notifyBrowser(data) {
  vite?.ws.send({ type: "custom", event: "termix:plugins-reloaded", data });
}

function startBackend() {
  const child = fork(BACKEND_ENTRY, [], {
    cwd: root,
    env: { ...process.env, ...backendEnv, TERMIX_DEV_RELOAD: "true" },
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  const pending = new Map();
  const state = { child, pending, ready: false, stopping: false };
  state.readyPromise = new Promise((resolve, reject) => {
    child.on("message", (msg) => {
      if (msg?.type === "backend-ready") {
        state.ready = true;
        resolve();
        return;
      }
      if (msg?.type === "backend-request") {
        relayToElectron(child, msg);
        return;
      }
      if (
        msg?.type === "plugin-reloaded" ||
        msg?.type === "plugin-reload-failed"
      ) {
        pending.get(msg.id)?.(msg);
        pending.delete(msg.id);
      }
    });
    child.on("exit", (code) => {
      for (const done of pending.values()) {
        done({ type: "plugin-reload-failed", error: "backend exited" });
      }
      pending.clear();
      if (backend === state) backend = null;
      if (!state.ready) reject(new Error(`backend exited with ${code}`));
      else if (!shuttingDown && !state.stopping) {
        warn(
          `backend exited with ${code}, press r or save a file to restart it`,
        );
      }
    });
  });
  backend = state;
  return state;
}

function stopChild(child, message) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      return resolve();
    }
    const timer = setTimeout(() => child.kill("SIGKILL"), SHUTDOWN_TIMEOUT_MS);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    try {
      if (message && child.connected) child.send(message);
      else child.kill();
    } catch {
      child.kill();
    }
  });
}

function stopBackend() {
  const state = backend;
  if (!state) return Promise.resolve();
  backend = null;
  state.stopping = true;
  return stopChild(state.child, state.ready ? { type: "shutdown" } : null);
}

async function restartBackend(reason) {
  log(reason);
  await stopBackend();
  if (shuttingDown) return;
  fs.copyFileSync(
    path.join(root, "src", "backend", "package.json"),
    path.join(root, "dist", "backend", "package.json"),
  );
  const state = startBackend();
  try {
    await state.readyPromise;
  } catch (error) {
    warn(`${error.message}, press r or save a file to restart it`);
    return;
  }
  log("backend ready");
  if (!vite) {
    await startVite();
    if (options.target === "electron") startElectron();
    printKeys();
  } else {
    notifyBrowser({});
  }
}

async function startVite() {
  const { createServer } = await import("vite");
  vite = await createServer({
    root,
    configFile: path.join(root, "vite.config.ts"),
  });
  await vite.listen();
  vite.printUrls();
}

// The packaged app forks the backend from Electron's main process, and they
// talk over that IPC channel (opening sign-in windows, the linked server's
// proxy settings). Here both are children of the runner, so it passes those
// messages along. The last proxy settings are kept for an app (re)started
// after the backend sent them.
let lastProxyConfig = null;
const REPLAY_PREFIX = "dev-replay-";

function relayToElectron(backendChild, msg) {
  if (msg.channel === "sync-proxy-config") lastProxyConfig = msg;
  if (electron?.connected) {
    electron.send(msg);
    return;
  }
  const ok = msg.channel === "sync-proxy-config";
  try {
    backendChild.send({
      type: "backend-response",
      id: msg.id,
      ok,
      ...(ok
        ? { result: { success: true } }
        : { error: "The desktop app is not running" }),
    });
  } catch {
    // backend gone
  }
}

function relayToBackend(msg) {
  if (msg?.type !== "backend-response") return;
  if (String(msg.id).startsWith(REPLAY_PREFIX)) return;
  if (backend?.child.connected) backend.child.send(msg);
}

function startElectron() {
  const env = {
    ...process.env,
    NODE_ENV: "development",
    TERMIX_DEV_RUNNER: "true",
  };
  // Set by some editors' terminals; Electron would start as plain Node.
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require("electron"), ["."], {
    cwd: root,
    env,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  });
  electron = child;
  child.on("message", relayToBackend);
  if (lastProxyConfig) {
    child.send({ ...lastProxyConfig, id: `${REPLAY_PREFIX}${Date.now()}` });
  }
  log("desktop app started");
  child.on("exit", () => {
    if (electron !== child) return;
    electron = null;
    if (!shuttingDown) {
      log("desktop app closed");
      void shutdown();
    }
  });
}

async function restartElectron() {
  const child = electron;
  electron = null;
  log("electron changed, restarting the desktop app");
  await stopChild(child);
  if (!shuttingDown) startElectron();
}

function reloadInBackend(id) {
  const state = backend;
  if (!state?.ready || !state.child.connected) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      state.pending.delete(id);
      resolve({ type: "plugin-reload-failed", error: "timed out" });
    }, RELOAD_TIMEOUT_MS);
    state.pending.set(id, (msg) => {
      clearTimeout(timer);
      resolve(msg);
    });
    state.child.send({ type: "plugin-reload", id });
  });
}

function watchBackend() {
  tsc = spawn(
    process.execPath,
    [
      require.resolve("typescript/bin/tsc"),
      "-p",
      "tsconfig.node.json",
      "--watch",
      "--preserveWatchOutput",
      "--pretty",
      "false",
    ],
    { cwd: root, stdio: ["ignore", "pipe", "inherit"] },
  );
  let first = true;
  let buffer = "";
  tsc.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop();
    for (const line of lines) {
      const errors = parseTscStatus(line);
      if (errors === null) {
        if (line.includes("error TS")) console.log(line);
        continue;
      }
      if (errors > 0) {
        warn(`backend has ${errors} type error(s), fix them to restart it`);
        continue;
      }
      const reason = first
        ? "starting the backend"
        : "backend changed, restarting it";
      first = false;
      void queue(() => restartBackend(reason));
    }
  });
}

function watchSdk() {
  const changed = createDebouncer(300, () =>
    queue(async () => {
      try {
        await run("npm", ["run", "build:sdk"]);
      } catch (error) {
        warn(`SDK failed to build: ${error.message}`);
        return;
      }
      await restartBackend("SDK changed, restarting the backend");
    }),
  );
  watch(SDK_SRC, true, () => changed("sdk"));
}

function watchElectron() {
  const changed = createDebouncer(300, () => restartElectron());
  watch(ELECTRON_DIR, false, (_event, filename) => {
    if (/\.(c?js)$/.test(String(filename)) && electron) changed("electron");
  });
}

// Docker target

function dockerDataMount() {
  if (options.data) return path.resolve(root, options.data);
  const volume = options.fresh ? "termix-dev-data-fresh" : "termix-dev-data";
  if (options.fresh) docker(["volume", "rm", "-f", volume], { quiet: true });
  return volume;
}

async function buildImage() {
  log(`building ${APP_IMAGE}, this takes a while`);
  await run("docker", [
    "build",
    "-f",
    "docker/Dockerfile",
    "-t",
    APP_IMAGE,
    ...(options.noCache ? ["--no-cache"] : []),
    ".",
  ]);
}

function followDockerLogs(since) {
  dockerLogs?.kill();
  dockerLogs = spawn(
    "docker",
    ["logs", "-f", ...(since ? ["--since", since] : []), APP_CONTAINER],
    { cwd: root, stdio: ["ignore", "inherit", "inherit"] },
  );
}

async function waitForApp() {
  const deadline = Date.now() + DOCKER_READY_TIMEOUT_MS;
  while (Date.now() < deadline && !shuttingDown) {
    try {
      const response = await fetch(appUrl());
      if (response.ok) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return false;
}

let dockerMount = null;

async function runAppContainer() {
  docker(["rm", "-f", APP_CONTAINER], { quiet: true });
  dockerMount ??= dockerDataMount();
  const result = docker(
    appRunArgs({
      port: options.port,
      env: serviceEnv(options, true),
      dataMount: dockerMount,
      pluginsDir: STAGED_PLUGINS,
    }),
    { quiet: true },
  );
  if (!result.ok) throw new Error(`could not start ${APP_CONTAINER}`);
  followDockerLogs();
  if (await waitForApp()) log(`ready on ${appUrl()}`);
  else warn(`${APP_CONTAINER} is not answering on ${appUrl()} yet`);
}

async function restartAppContainer(reason) {
  log(reason);
  const since = new Date().toISOString();
  docker(["restart", APP_CONTAINER], { quiet: true });
  followDockerLogs(since);
  if (await waitForApp()) log(`ready on ${appUrl()}`);
}

async function rebuildAndRunImage() {
  try {
    await buildImage();
  } catch (error) {
    warn(error.message);
    return;
  }
  await runAppContainer();
}

function watchCoreForDocker() {
  const changed = createDebouncer(500, () =>
    warn("core changed, press r to rebuild the image"),
  );
  for (const dir of [path.join(root, "src"), SDK_SRC]) {
    watch(dir, true, () => changed("core"));
  }
}

// Plugins

async function rebuildPlugin({ id, repo }) {
  log(`building ${id}`);
  try {
    await run(...localSdkBuildCommand(), repo);
  } catch (error) {
    warn(`${id} failed to build: ${error.message}`);
    return;
  }
  const destination = path.join(STAGED_PLUGINS, id);
  fs.rmSync(destination, { recursive: true, force: true });
  copyLocalBuild(repo, destination);

  if (options.target === "docker") {
    await restartAppContainer(`${id} rebuilt, restarting ${APP_CONTAINER}`);
    return;
  }
  const result = await reloadInBackend(id);
  if (!result) {
    log(`${id} staged, it loads when the backend starts`);
    return;
  }
  if (result.type === "plugin-reload-failed") {
    warn(`${id} did not reload: ${result.error}`);
    return;
  }
  log(`${id} reloaded (${result.state})`);
  notifyBrowser({ id });
}

function watchPlugins(dir) {
  plugins = findBuildablePlugins(dir);
  const byId = new Map(plugins.map((plugin) => [plugin.id, plugin]));
  const changed = createDebouncer(300, (id) =>
    queue(() => rebuildPlugin(byId.get(id))),
  );
  for (const plugin of plugins) {
    watch(plugin.repo, true, (_event, filename) => {
      if (isPluginEdit(plugin.repo, filename)) changed(plugin.id);
    });
  }
  log(`watching ${plugins.length} plugin(s) in ${dir}`);
}

// Keys and shutdown

function printKeys() {
  if (!process.stdin.isTTY) return;
  log("keys: r restart, p rebuild plugins, o open browser, q quit");
}

function listenForKeys() {
  if (!process.stdin.isTTY) return;
  process.stdin.setRawMode(true);
  process.stdin.setEncoding("utf8");
  process.stdin.resume();
  process.stdin.on("data", (key) => {
    if (key === "\u0003" || key === "q") {
      void shutdown();
    } else if (key === "r") {
      void queue(() =>
        options.target === "docker"
          ? rebuildAndRunImage()
          : restartBackend("restarting the backend"),
      );
    } else if (key === "p") {
      if (plugins.length === 0) warn("no local plugins to rebuild");
      for (const plugin of plugins) void queue(() => rebuildPlugin(plugin));
    } else if (key === "o") {
      openBrowser(appUrl());
    }
  });
}

async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log("shutting down");
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
  for (const watcher of watchers) watcher.close();
  tsc?.kill();
  dockerLogs?.kill();
  await Promise.allSettled([stopBackend(), stopChild(electron), vite?.close()]);
  if (options.target === "docker") {
    docker(["rm", "-f", APP_CONTAINER], { quiet: true });
  }
  for (const container of startedServices) {
    docker(["stop", container], { quiet: true });
  }
  process.exit(code);
}

async function main() {
  try {
    options = parseDevArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  if (options.help) {
    console.log(HELP);
    return;
  }

  process.on("SIGINT", () => shutdown());
  process.on("SIGTERM", () => shutdown());

  const pluginsDir = options.local
    ? path.resolve(
        root,
        options.pluginsDir ??
          process.env.TERMIX_LOCAL_PLUGINS ??
          "../Termix-Plugins",
      )
    : null;
  const localPlugins =
    pluginsDir && fs.existsSync(pluginsDir) ? pluginsDir : null;
  if (pluginsDir && !localPlugins)
    warn(`${pluginsDir} not found, using pinned plugins`);

  if (needsDocker(options)) {
    assertDocker();
    await startServices();
  }

  log("building the SDK");
  await run("npm", ["run", "build:sdk"]);
  log(
    localPlugins
      ? `staging plugins with local builds from ${localPlugins}`
      : "staging pinned plugins",
  );
  await run(process.execPath, [
    "scripts/build-plugins.cjs",
    ...(localPlugins ? ["--local", localPlugins] : []),
  ]);

  listenForKeys();
  if (localPlugins) watchPlugins(localPlugins);

  if (options.target === "docker") {
    await buildImage();
    await runAppContainer();
    watchCoreForDocker();
    printKeys();
    return;
  }

  const dataDir = dataDirFor(options);
  if (dataDir) {
    const full = path.resolve(root, dataDir);
    if (options.fresh) fs.rmSync(full, { recursive: true, force: true });
    fs.mkdirSync(full, { recursive: true });
    log(`data folder ${full}`);
  }
  backendEnv = {
    ...serviceEnv(options, false),
    // The desktop app runs against its own embedded backend, which is what
    // turns on the local profile, sync and the desktop-only routes.
    ...(options.target === "electron" ? { ELECTRON_EMBEDDED: "true" } : {}),
    // A folder the runner picked starts empty on purpose, so the guard
    // against a mistyped DATA_DIR must not stop it.
    ...(dataDir
      ? { DATA_DIR: path.resolve(root, dataDir), ALLOW_EMPTY_DATA_DIR: "true" }
      : {}),
  };

  log("compiling the backend");
  watchBackend();
  watchSdk();
  if (options.target === "electron") watchElectron();
}

main().catch(async (error) => {
  console.error(error?.message ?? error);
  await shutdown(1);
});
