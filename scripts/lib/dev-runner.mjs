import fs from "node:fs";
import path from "node:path";

const ID = /^[a-z0-9][a-z0-9-]*$/;
const SOURCE_DIRS = new Set(["src", "locales", "migrations"]);
const SOURCE_FILES = new Set(["manifest.json", "package.json"]);

/** The error count from tsc --watch's "Found N errors" line, else null. */
export function parseTscStatus(line) {
  const match = /Found (\d+) errors?\b.*Watching for file changes/.exec(line);
  return match ? Number(match[1]) : null;
}

/** True when a changed path (relative to a plugin repo) feeds its build. */
export function isPluginSourceChange(filename) {
  if (!filename) return false;
  const parts = String(filename).replaceAll("\\", "/").split("/");
  if (parts.length === 1) return SOURCE_FILES.has(parts[0]);
  return SOURCE_DIRS.has(parts[0]);
}

/** Plugin repos under dir that can be built (manifest.json and node_modules). */
export function findBuildablePlugins(dir) {
  const plugins = [];
  if (!dir || !fs.existsSync(dir)) return plugins;
  for (const name of fs.readdirSync(dir)) {
    const repo = path.join(dir, name);
    if (!fs.existsSync(path.join(repo, "node_modules"))) continue;
    try {
      const { id } = JSON.parse(
        fs.readFileSync(path.join(repo, "manifest.json"), "utf8"),
      );
      if (typeof id === "string" && ID.test(id)) plugins.push({ id, repo });
    } catch {
      // not a plugin repo
    }
  }
  return plugins.sort((a, b) => a.id.localeCompare(b.id));
}

/** Runs tasks one after another; a failed task does not stop the next. */
export function createSerialQueue() {
  let tail = Promise.resolve();
  return (task) => {
    const run = tail.then(task, task);
    tail = run.catch(() => {});
    return run;
  };
}

/**
 * Calls fn(key) once a key has gone quiet for ms. A key that changes again
 * while fn is still running for it runs once more afterwards.
 */
export function createDebouncer(ms, fn) {
  const timers = new Map();
  const running = new Set();
  const again = new Set();
  const fire = async (key) => {
    timers.delete(key);
    if (running.has(key)) {
      again.add(key);
      return;
    }
    running.add(key);
    try {
      await fn(key);
    } finally {
      running.delete(key);
      if (again.delete(key)) trigger(key);
    }
  };
  const trigger = (key) => {
    clearTimeout(timers.get(key));
    timers.set(
      key,
      setTimeout(() => void fire(key), ms),
    );
  };
  trigger.cancel = () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  };
  return trigger;
}

export const TARGETS = ["web", "electron", "docker"];
export const DATABASES = ["sqlite", "postgres", "mysql"];

export const HELP = `Usage: npm run dev:all -- [target] [options]

Targets
  web        Backend and Vite on http://localhost:5173 (default)
  electron   Backend, Vite and the desktop app
  docker     Build the production image and run it with your local plugins

Options
  --plugins <dir>  Plugin repos to build and watch (default ../Termix-Plugins)
  --no-local       Use only the plugins pinned in docker/bundled-plugins.json
  --db <engine>    sqlite (default), postgres or mysql. Postgres and MySQL run in Docker
  --guacd          Run guacd in Docker for remote desktop
  --fresh          Start from empty data (first run, onboarding)
  --data <dir>     Data folder for the backend (default db/data, db/data-desktop for
                   electron, plus -<engine> for postgres or mysql)
  --port <n>       docker target: port on this machine (default 8081)
  --no-cache       docker target: build the image without the layer cache
  -h, --help       Show this

Keys while running
  r  restart the backend (docker: rebuild the image)
  p  rebuild every local plugin
  o  open the app in a browser
  q  quit`;

/** Reads dev:all arguments. Throws on anything it does not know. */
export function parseDevArgs(argv) {
  const options = {
    target: "web",
    pluginsDir: null,
    local: true,
    db: "sqlite",
    guacd: false,
    fresh: false,
    data: null,
    port: 8081,
    noCache: false,
    help: false,
  };
  const value = (i, name) => {
    const next = argv[i + 1];
    if (!next || next.startsWith("--"))
      throw new Error(`${name} needs a value`);
    return next;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (TARGETS.includes(arg)) options.target = arg;
    else if (arg === "-h" || arg === "--help") options.help = true;
    else if (arg === "--no-local") options.local = false;
    else if (arg === "--guacd") options.guacd = true;
    else if (arg === "--fresh") options.fresh = true;
    else if (arg === "--no-cache") options.noCache = true;
    else if (arg === "--plugins") options.pluginsDir = value(i++, arg);
    else if (arg === "--data") options.data = value(i++, arg);
    else if (arg === "--db") {
      options.db = value(i++, arg).toLowerCase();
      if (!DATABASES.includes(options.db)) {
        throw new Error(`--db must be one of ${DATABASES.join(", ")}`);
      }
    } else if (arg === "--port") {
      options.port = Number(value(i++, arg));
      if (!Number.isInteger(options.port) || options.port < 1) {
        throw new Error("--port must be a port number");
      }
    } else throw new Error(`Unknown option ${arg}. Run with --help.`);
  }
  if (options.fresh && options.data) {
    throw new Error("--fresh and --data cannot be used together");
  }
  return options;
}

/**
 * The data folder the local backend uses, or null for its own default. The
 * desktop, each database engine and fresh runs get their own, so a desktop's
 * local profile or another engine's keys never land in the everyday data.
 */
export function dataDirFor(options) {
  if (options.data) return options.data;
  const suffix = [
    options.target === "electron" ? "desktop" : null,
    options.db === "sqlite" ? null : options.db,
  ]
    .filter(Boolean)
    .map((part) => `-${part}`)
    .join("");
  if (options.fresh) return `db/data-fresh${suffix}`;
  return suffix ? `db/data${suffix}` : null;
}

export function needsDocker(options) {
  return (
    options.target === "docker" || options.db !== "sqlite" || options.guacd
  );
}
