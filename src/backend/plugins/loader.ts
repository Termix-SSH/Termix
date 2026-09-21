/**
 * Loads unpacked plugins and owns their worker lifecycle.
 *
 * ## What the worker boundary actually buys you
 *
 * Be precise about this, because it is easy to overclaim.
 *
 * ENFORCED:
 *   - The plugin is handed a `ctx` object and nothing else. It gets no db
 *     handle, no fs module, no socket, and no credential. Everything it can do
 *     goes through a postMessage round trip to the broker, which checks the
 *     plugin's grants first and writes an audit line after.
 *   - Only structured-cloneable values cross the boundary, so a live object
 *     cannot leak by reference even by mistake.
 *   - The worker does not inherit process.env, so it cannot read secrets that
 *     were passed to the server that way. Only TMPDIR/TMP/TEMP are forwarded.
 *   - resourceLimits caps the worker heap, so a runaway allocation kills the
 *     worker instead of the server.
 *
 * NOT ENFORCED, and not claimed:
 *   - A worker_threads worker is NOT a security sandbox. It shares the process.
 *     A plugin that wants to can `import("node:fs")` and read whatever the
 *     server user can read. It can burn CPU. It can crash the process through
 *     native addons.
 *   - Node's permission model (--permission) is the only thing that would
 *     actually restrict builtins, and it is process-wide, not per-worker, so it
 *     cannot be turned on for plugin workers alone. execArgv on a Worker does
 *     not accept it.
 *
 * So the honest boundary is: plugins are code you chose to install, and this
 * design guarantees they cannot QUIETLY reach data they were not granted --
 * every privileged path is gated and audited. It does not guarantee
 * containment. If containment is ever required, the answer is a child process
 * with --permission, or a WASM/vm isolate, not worker_threads.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { pluginLogger } from "../utils/logger.js";
import { parseManifest, type PluginManifest } from "./manifest.js";
import {
  getPluginBackendEntry,
  getPluginManifestPath,
  getPluginsDir,
} from "./paths.js";
import type { PluginBootstrapData } from "./protocol.js";

export type PluginState =
  | "loaded"
  | "activating"
  | "active"
  | "stopping"
  | "stopped"
  | "crashed"
  | "disabled";

export const MAX_RESTART_ATTEMPTS = 3;
const RESTART_BACKOFF_MS = [1000, 5000, 15000];
const ACTIVATION_TIMEOUT_MS = 30_000;
const STABILITY_WINDOW_MS = 60_000;
const WORKER_MAX_OLD_HEAP_MB = 256;

export interface LoadedPlugin {
  id: string;
  dir: string;
  manifest: PluginManifest;
  state: PluginState;
  worker: Worker | null;
  /** Consecutive crashes since the last successful activation. */
  restartAttempts: number;
  lastError: string | null;
  /** The user whose authority this plugin acts under. Set at activate time. */
  ownerUserId: string | null;
}

export interface PluginLoaderOptions {
  /**
   * Called with each worker's port right after spawn so the broker can attach.
   * Kept as a hook rather than a hard import so the loader stays testable on
   * its own, before the broker exists.
   */
  onWorkerReady?: (plugin: LoadedPlugin, worker: Worker) => void;
  onWorkerGone?: (plugin: LoadedPlugin) => void;
  /** Overridable so tests do not have to wait out the real backoff. */
  restartBackoffMs?: number[];
  /** How long a plugin must stay up before its crash counter resets. */
  stabilityWindowMs?: number;
}

/**
 * Resolved from this module's own location, never from process.cwd(): the build
 * emits to dist/backend/backend/, and cwd is wherever the server was started
 * from.
 *
 * Under vitest this module is the .ts source, so the sibling is
 * worker-bootstrap.ts and the worker needs the tsx loader to run it. In a built
 * server both are plain .js and no loader is involved.
 */
function resolveWorkerBootstrap(): { entry: string; execArgv?: string[] } {
  const here = path.dirname(fileURLToPath(import.meta.url));

  const compiled = path.join(here, "worker-bootstrap.js");
  if (fs.existsSync(compiled)) return { entry: compiled };

  const source = path.join(here, "worker-bootstrap.ts");
  if (fs.existsSync(source)) {
    return { entry: source, execArgv: ["--import", "tsx"] };
  }

  throw new Error(`Could not locate the plugin worker bootstrap near ${here}`);
}

export class PluginLoader {
  private readonly plugins = new Map<string, LoadedPlugin>();
  private readonly restartTimers = new Map<string, NodeJS.Timeout>();
  private readonly stabilityTimers = new Map<string, NodeJS.Timeout>();

  constructor(private readonly options: PluginLoaderOptions = {}) {}

  list(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * Reads and validates a plugin directory. Does not start anything.
   */
  async load(dir: string): Promise<LoadedPlugin> {
    const manifestPath = getPluginManifestPath(dir);

    let raw: unknown;
    try {
      raw = JSON.parse(await fs.promises.readFile(manifestPath, "utf8"));
    } catch (error) {
      throw new Error(
        `Could not read plugin manifest at ${manifestPath}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const { manifest, errors } = parseManifest(raw);
    if (!manifest) {
      throw new Error(
        `Invalid plugin manifest at ${manifestPath}:\n  - ${errors.join("\n  - ")}`,
      );
    }

    if (path.basename(dir) !== manifest.id) {
      throw new Error(
        `Plugin directory "${path.basename(dir)}" does not match manifest id "${manifest.id}"`,
      );
    }

    if (manifest.capabilities.backend) {
      const entry = getPluginBackendEntry(dir);
      if (!fs.existsSync(entry)) {
        throw new Error(
          `Plugin ${manifest.id} declares a backend but ${entry} is missing`,
        );
      }
    }

    const plugin: LoadedPlugin = {
      id: manifest.id,
      dir,
      manifest,
      state: "loaded",
      worker: null,
      restartAttempts: 0,
      lastError: null,
      ownerUserId: null,
    };

    this.plugins.set(manifest.id, plugin);
    pluginLogger.info(`Loaded plugin ${manifest.id}@${manifest.version}`, {
      operation: "plugin_load",
    });
    return plugin;
  }

  /** Scans the plugins directory, loading every valid plugin it finds. */
  async loadAll(): Promise<LoadedPlugin[]> {
    const root = getPluginsDir();
    if (!fs.existsSync(root)) return [];

    const entries = await fs.promises.readdir(root, { withFileTypes: true });
    const loaded: LoadedPlugin[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      try {
        loaded.push(await this.load(path.join(root, entry.name)));
      } catch (error) {
        pluginLogger.error(
          `Skipping plugin directory ${entry.name}`,
          error instanceof Error ? error : new Error(String(error)),
          { operation: "plugin_load" },
        );
      }
    }

    return loaded;
  }

  async activate(pluginId: string, ownerUserId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);

    if (plugin.state === "active" || plugin.state === "activating") return;
    if (!plugin.manifest.capabilities.backend) {
      throw new Error(`Plugin ${pluginId} has no backend to activate`);
    }

    plugin.ownerUserId = ownerUserId;
    await this.spawn(plugin);
  }

  private async spawn(plugin: LoadedPlugin): Promise<void> {
    plugin.state = "activating";
    plugin.lastError = null;

    const bootstrap: PluginBootstrapData = {
      pluginId: plugin.id,
      pluginDir: plugin.dir,
      // file:// so the worker's dynamic import works on Windows too.
      entryPath: pathToFileUrlString(getPluginBackendEntry(plugin.dir)),
      manifest: plugin.manifest,
    };

    const { entry, execArgv } = resolveWorkerBootstrap();
    const worker = new Worker(entry, {
      workerData: bootstrap,
      // Deliberately not process.env: the worker must not inherit secrets
      // passed to the server that way. Only the temp-dir vars are forwarded,
      // because tooling that writes a cache falls back to the literal string
      // "undefined" without them.
      env: pickTempEnv(),
      resourceLimits: { maxOldGenerationSizeMb: WORKER_MAX_OLD_HEAP_MB },
      stdout: true,
      stderr: true,
      ...(execArgv ? { execArgv } : {}),
    });

    plugin.worker = worker;
    this.options.onWorkerReady?.(plugin, worker);

    worker.on("error", (error: Error) => {
      plugin.lastError = error.message;
      pluginLogger.error(`Plugin ${plugin.id} worker error`, error, {
        operation: "plugin_worker",
      });
    });

    worker.on("exit", (code: number) => {
      this.handleExit(plugin, code);
    });

    await this.awaitActivation(plugin, worker);
  }

  private awaitActivation(plugin: LoadedPlugin, worker: Worker): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        void this.terminate(plugin);
        reject(
          new Error(
            `Plugin ${plugin.id} did not activate within ${ACTIVATION_TIMEOUT_MS}ms`,
          ),
        );
      }, ACTIVATION_TIMEOUT_MS);

      const onMessage = (message: unknown) => {
        const m = message as {
          id?: number;
          ok?: boolean;
          error?: { message: string };
        };
        // id 0 is reserved for the bootstrap's activation result.
        if (!m || m.id !== 0) return;
        cleanup();

        if (m.ok) {
          plugin.state = "active";
          this.scheduleStabilityReset(plugin);
          pluginLogger.success(`Activated plugin ${plugin.id}`, {
            operation: "plugin_activate",
          });
          resolve();
        } else {
          plugin.lastError = m.error?.message ?? "activation failed";
          void this.terminate(plugin);
          reject(new Error(plugin.lastError));
        }
      };

      const onExit = () => {
        cleanup();
        reject(
          new Error(
            `Plugin ${plugin.id} worker exited before activating${
              plugin.lastError ? `: ${plugin.lastError}` : ""
            }`,
          ),
        );
      };

      function cleanup() {
        clearTimeout(timer);
        worker.off("message", onMessage);
        worker.off("exit", onExit);
      }

      worker.on("message", onMessage);
      worker.on("exit", onExit);
    });
  }

  /**
   * Clears the crash counter only once a plugin has stayed up for a while.
   * Resetting it on activation alone would let a plugin that activates cleanly
   * and then dies restart forever, because each attempt would look like the
   * first one.
   */
  private scheduleStabilityReset(plugin: LoadedPlugin): void {
    const existing = this.stabilityTimers.get(plugin.id);
    if (existing) clearTimeout(existing);

    const timer = setTimeout(() => {
      this.stabilityTimers.delete(plugin.id);
      if (plugin.state === "active") plugin.restartAttempts = 0;
    }, this.options.stabilityWindowMs ?? STABILITY_WINDOW_MS);

    timer.unref?.();
    this.stabilityTimers.set(plugin.id, timer);
  }

  private handleExit(plugin: LoadedPlugin, code: number): void {
    const stabilityTimer = this.stabilityTimers.get(plugin.id);
    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      this.stabilityTimers.delete(plugin.id);
    }

    plugin.worker = null;
    this.options.onWorkerGone?.(plugin);

    // A deliberate stop is not a crash.
    if (plugin.state === "stopping" || plugin.state === "stopped") {
      plugin.state = "stopped";
      return;
    }
    if (plugin.state === "disabled") return;

    plugin.state = "crashed";
    plugin.restartAttempts += 1;

    if (plugin.restartAttempts > MAX_RESTART_ATTEMPTS) {
      plugin.state = "disabled";
      pluginLogger.error(
        `Plugin ${plugin.id} crashed ${MAX_RESTART_ATTEMPTS} times and has been disabled`,
        new Error(plugin.lastError ?? `worker exited with code ${code}`),
        { operation: "plugin_crash" },
      );
      return;
    }

    const backoff = this.options.restartBackoffMs ?? RESTART_BACKOFF_MS;
    const delay =
      backoff[plugin.restartAttempts - 1] ?? backoff[backoff.length - 1];

    pluginLogger.warn(
      `Plugin ${plugin.id} crashed, restarting in ${delay}ms (attempt ${plugin.restartAttempts}/${MAX_RESTART_ATTEMPTS})`,
      { operation: "plugin_crash" },
    );

    const timer = setTimeout(() => {
      this.restartTimers.delete(plugin.id);
      if (plugin.state !== "crashed") return;
      this.spawn(plugin).catch((error) => {
        plugin.lastError =
          error instanceof Error ? error.message : String(error);
      });
    }, delay);

    this.restartTimers.set(plugin.id, timer);
  }

  /**
   * Clears the crash counter and starts the plugin again. This is what the
   * Retry button calls once a plugin has been auto-disabled.
   */
  async retry(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    plugin.restartAttempts = 0;
    plugin.state = "loaded";
    plugin.lastError = null;

    if (!plugin.ownerUserId) {
      throw new Error(
        `Plugin ${pluginId} has never been activated, so there is nothing to retry`,
      );
    }
    await this.spawn(plugin);
  }

  async deactivate(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);

    const timer = this.restartTimers.get(pluginId);
    if (timer) {
      clearTimeout(timer);
      this.restartTimers.delete(pluginId);
    }
    const stabilityTimer = this.stabilityTimers.get(pluginId);
    if (stabilityTimer) {
      clearTimeout(stabilityTimer);
      this.stabilityTimers.delete(pluginId);
    }

    if (!plugin.worker) {
      plugin.state = "stopped";
      return;
    }

    plugin.state = "stopping";
    await this.terminate(plugin);
    plugin.state = "stopped";
  }

  private async terminate(plugin: LoadedPlugin): Promise<void> {
    const worker = plugin.worker;
    if (!worker) return;
    plugin.worker = null;
    try {
      await worker.terminate();
    } catch {
      // Already gone.
    }
  }

  /** Stops everything. Called on shutdown and by tests. */
  async shutdown(): Promise<void> {
    for (const timer of this.restartTimers.values()) clearTimeout(timer);
    this.restartTimers.clear();
    for (const timer of this.stabilityTimers.values()) clearTimeout(timer);
    this.stabilityTimers.clear();

    await Promise.all(
      [...this.plugins.values()].map(async (plugin) => {
        plugin.state = "stopping";
        await this.terminate(plugin);
        plugin.state = "stopped";
      }),
    );
  }

  private requirePlugin(pluginId: string): LoadedPlugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} is not loaded`);
    return plugin;
  }
}

function pickTempEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ["TMPDIR", "TMP", "TEMP"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

function pathToFileUrlString(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return `file://${resolved.startsWith("/") ? "" : "/"}${resolved}`;
}
