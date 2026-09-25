/**
 * Discovers plugins, resolves their dependency order, and owns their
 * lifecycle.
 *
 * One tier. Every plugin, bundled or installed, is imported into the server
 * process and handed a ctx built by ctx.ts. There is no worker boundary and
 * no allowlist, because the worker tier had no users and the allowlist was a
 * hardcoded set of twelve ids that every real plugin was already on.
 *
 * What that means honestly: a plugin has the same reach as core. The
 * capability gate on ctx makes privileged calls declared and auditable, not
 * impossible. See ARCHITECTURE.md.
 */

import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { pluginLogger } from "../utils/logger.js";
import { parseManifest } from "./manifest.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  getBundledPluginsDir,
  getPluginBackendEntry,
  getPluginManifestPath,
  getPluginsDir,
} from "./paths.js";
import {
  createPluginContext,
  createPluginHandle,
  disposePluginHandle,
  type PluginHandle,
  type PluginModule,
} from "./ctx.js";
import { resolveRequirements } from "./service-registry.js";
import { resolveSecretRequirements } from "./secret-registry.js";

export type PluginState =
  | "loaded"
  | "activating"
  | "active"
  | "stopping"
  | "stopped"
  | "blocked"
  | "failed";

export type PluginSource = "bundled" | "user";

const ACTIVATION_TIMEOUT_MS = 30_000;

/** Defaults for the runtime error budget. Both are configurable. */
const DEFAULT_ERROR_THRESHOLD = 5;
const DEFAULT_ERROR_WINDOW_MS = 60_000;

export interface LoadedPlugin {
  id: string;
  dir: string;
  source: PluginSource;
  manifest: PluginManifest;
  state: PluginState;
  handle: PluginHandle | null;
  lastError: string | null;
  /** Timestamps of recent runtime errors, trimmed to the window. */
  errorTimestamps: number[];
}

export interface PluginLoaderOptions {
  errorThreshold?: number;
  errorWindowMs?: number;
  /** Called when a plugin trips the error budget and is torn down. */
  onFailed?: (plugin: LoadedPlugin) => void;
}

export class PluginLoader {
  private readonly plugins = new Map<string, LoadedPlugin>();
  /** Activation order, so shutdown can run it backwards. */
  private activationOrder: string[] = [];

  constructor(private readonly options: PluginLoaderOptions = {}) {}

  list(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /** Reads and validates one plugin directory. Starts nothing. */
  async load(dir: string, source: PluginSource): Promise<LoadedPlugin> {
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

    const entry = getPluginBackendEntry(dir, manifest);
    if (!fs.existsSync(entry)) {
      throw new Error(
        `Plugin ${manifest.id} backend entry ${entry} is missing`,
      );
    }

    const plugin: LoadedPlugin = {
      id: manifest.id,
      dir,
      source,
      manifest,
      state: "loaded",
      handle: null,
      lastError: null,
      errorTimestamps: [],
    };

    this.plugins.set(manifest.id, plugin);
    pluginLogger.info(`Loaded plugin ${manifest.id}@${manifest.version}`, {
      operation: "plugin_load",
    });
    return plugin;
  }

  /**
   * Scans both roots. A user-installed plugin can never shadow a bundled one:
   * the collision is rejected with an error rather than silently skipped, so
   * dropping a folder with a bundled plugin's id into the data directory is visibly
   * refused instead of quietly ignored.
   *
   * The check is on the parsed manifest id, not the directory name, because a
   * directory can be named anything.
   */
  async loadAll(): Promise<LoadedPlugin[]> {
    this.plugins.clear();
    const loaded: LoadedPlugin[] = [];

    const roots: Array<{ root: string; source: PluginSource }> = [
      { root: getBundledPluginsDir(), source: "bundled" },
      { root: getPluginsDir(), source: "user" },
    ];

    for (const { root, source } of roots) {
      if (!fs.existsSync(root)) continue;

      const entries = await fs.promises.readdir(root, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;

        const dir = path.join(root, entry.name);
        try {
          const existing = this.plugins.get(entry.name);
          if (existing && source === "user") {
            throw new Error(
              `a bundled plugin already uses the id "${entry.name}"; a plugin in the data directory cannot replace it`,
            );
          }

          const plugin = await this.load(dir, source);
          loaded.push(plugin);
        } catch (error) {
          pluginLogger.error(
            `Skipping plugin directory ${entry.name} in ${root}`,
            error instanceof Error ? error : new Error(String(error)),
            { operation: "plugin_load" },
          );
        }
      }
    }

    return loaded;
  }

  /**
   * Orders plugins so a dependency always activates before its dependents.
   *
   * Returns the order plus the plugins that cannot run: one with a missing
   * hard dependency is blocked (recoverable, the dependency may be installed
   * later), one in a cycle is failed (nothing to wait for).
   */
  resolveOrder(candidates: string[]): {
    order: string[];
    blocked: Map<string, string>;
    cycles: Map<string, string>;
  } {
    const wanted = new Set(candidates);
    const blocked = new Map<string, string>();
    const cycles = new Map<string, string>();
    const order: string[] = [];

    const state = new Map<string, "visiting" | "done">();

    const visit = (id: string, trail: string[]): boolean => {
      if (state.get(id) === "done") return true;

      if (state.get(id) === "visiting") {
        const cycle = [...trail.slice(trail.indexOf(id)), id].join(" -> ");
        for (const member of trail.slice(trail.indexOf(id))) {
          cycles.set(member, `dependency cycle: ${cycle}`);
        }
        return false;
      }

      const plugin = this.plugins.get(id);
      if (!plugin) return false;

      state.set(id, "visiting");

      for (const [dependencyId, range] of Object.entries(
        plugin.manifest.dependencies ?? {},
      )) {
        const dependency = this.plugins.get(dependencyId);

        if (!dependency) {
          blocked.set(
            id,
            `requires plugin "${dependencyId}", which is not installed`,
          );
          state.set(id, "done");
          return false;
        }
        if (!semver.satisfies(dependency.manifest.version, range)) {
          blocked.set(
            id,
            `requires "${dependencyId}" ${range}, but ${dependency.manifest.version} is installed`,
          );
          state.set(id, "done");
          return false;
        }
        if (!wanted.has(dependencyId)) {
          blocked.set(
            id,
            `requires plugin "${dependencyId}", which is not enabled`,
          );
          state.set(id, "done");
          return false;
        }

        if (!visit(dependencyId, [...trail, id])) {
          if (!cycles.has(id)) {
            blocked.set(
              id,
              `requires plugin "${dependencyId}", which could not start`,
            );
          }
          state.set(id, "done");
          return false;
        }
      }

      // Optional dependencies only affect ordering. A missing one is normal,
      // and the plugin must keep working without it.
      for (const dependencyId of Object.keys(
        plugin.manifest.optionalDependencies ?? {},
      )) {
        if (wanted.has(dependencyId) && this.plugins.has(dependencyId)) {
          visit(dependencyId, [...trail, id]);
        }
      }

      state.set(id, "done");
      if (!blocked.has(id) && !cycles.has(id)) order.push(id);
      return !blocked.has(id) && !cycles.has(id);
    };

    for (const id of candidates) visit(id, []);

    return { order, blocked, cycles };
  }

  async activate(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);

    if (plugin.state === "active" || plugin.state === "activating") return;

    plugin.state = "activating";
    plugin.lastError = null;

    const entry = pathToFileUrlString(
      getPluginBackendEntry(plugin.dir, plugin.manifest),
    );

    try {
      const imported = (await import(entry)) as {
        activate?: PluginModule["activate"];
        deactivate?: PluginModule["deactivate"];
        default?: PluginModule;
      };

      const activate = imported.activate ?? imported.default?.activate;
      const deactivate = imported.deactivate ?? imported.default?.deactivate;

      if (typeof activate !== "function") {
        throw new Error(
          `Plugin ${plugin.id} backend entry does not export an activate(ctx) function`,
        );
      }

      // Structural only: is the service present at a satisfying version. A
      // user's permission is checked per call instead, because activation is
      // per-instance and permissions are per-user.
      const resolution = resolveRequirements(plugin.manifest);
      if (!resolution.satisfied) {
        throw new Error(`Plugin ${plugin.id} ${resolution.errors.join("; ")}`);
      }
      for (const service of resolution.missingOptional) {
        pluginLogger.info(
          `Plugin ${plugin.id} optional service "${service}" is not available`,
          { operation: "plugin_activate" },
        );
      }

      // A borrowed secret resolves per call and returns null when absent, so a
      // provider installed later starts working with no restart. Refusing to
      // start here would turn a recoverable gap into an install ordering rule.
      for (const reference of resolveSecretRequirements(plugin.manifest)
        .unavailable) {
        pluginLogger.info(
          `Plugin ${plugin.id} shared secret "${reference}" is not currently offered; reads will resolve to null`,
          { operation: "plugin_activate" },
        );
      }

      // Before activate, not inside it: a plugin's first line may query its
      // own tables, and a migration that fails should stop it starting rather
      // than leave it half-running against a schema that is not there. A
      // throw here lands in the catch below, which fails this plugin only.
      const { migratePlugin } = await import("./data.js");
      const applied = await migratePlugin(plugin.id, plugin.dir);
      // A new table may be where core data is waiting to move.
      if (applied.length > 0) {
        const { runPluginDataMoves } =
          await import("../upgrade/plugin-data-moves.js");
        await runPluginDataMoves();
      }

      const handle = createPluginHandle(plugin.id, { activate, deactivate });
      const ctx = createPluginContext(plugin.manifest, handle);

      // Attached before activate runs, not after: a plugin that registers a
      // few things and then throws still has to be cleaned up, and the catch
      // below can only do that if it can reach the handle.
      plugin.handle = handle;

      await withTimeout(
        Promise.resolve(activate(ctx)),
        ACTIVATION_TIMEOUT_MS,
        `Plugin ${plugin.id} did not activate within ${ACTIVATION_TIMEOUT_MS}ms`,
      );

      plugin.state = "active";
      plugin.errorTimestamps = [];
      if (!this.activationOrder.includes(plugin.id)) {
        this.activationOrder.push(plugin.id);
      }

      pluginLogger.success(`Activated plugin ${plugin.id}`, {
        operation: "plugin_activate",
      });
    } catch (error) {
      plugin.lastError = error instanceof Error ? error.message : String(error);
      plugin.state = "failed";

      // Activation may have registered things before it threw. Dispose them
      // rather than leaving a half-started plugin holding resources, but do
      // not call the plugin's own deactivate: it never finished starting.
      if (plugin.handle) {
        await disposePluginHandle(plugin.handle, plugin.id, {
          runDeactivate: false,
        });
        plugin.handle = null;
      }
      throw error instanceof Error ? error : new Error(plugin.lastError);
    }
  }

  /** Activates a set of plugins in dependency order. */
  async activateAll(pluginIds: string[]): Promise<{
    activated: string[];
    blocked: Map<string, string>;
    failed: Map<string, string>;
  }> {
    const { order, blocked, cycles } = this.resolveOrder(pluginIds);
    const activated: string[] = [];
    const failed = new Map<string, string>(cycles);

    for (const [id, reason] of blocked) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        plugin.state = "blocked";
        plugin.lastError = reason;
      }
      pluginLogger.warn(`Plugin ${id} is blocked: ${reason}`, {
        operation: "plugin_activate",
      });
    }

    for (const [id, reason] of cycles) {
      const plugin = this.plugins.get(id);
      if (plugin) {
        plugin.state = "failed";
        plugin.lastError = reason;
      }
      pluginLogger.error(`Plugin ${id} cannot start`, new Error(reason), {
        operation: "plugin_activate",
      });
    }

    for (const id of order) {
      try {
        await this.activate(id);
        activated.push(id);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.set(id, message);
        pluginLogger.error(
          `Failed to activate plugin ${id}`,
          error instanceof Error ? error : new Error(message),
          { operation: "plugin_activate" },
        );
      }
    }

    return { activated, blocked, failed };
  }

  async deactivate(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);

    this.activationOrder = this.activationOrder.filter((id) => id !== pluginId);

    if (!plugin.handle) {
      plugin.state = "stopped";
      return;
    }

    plugin.state = "stopping";
    const handle = plugin.handle;
    plugin.handle = null;

    // Disposal never throws, so a plugin whose deactivate() misbehaves still
    // ends up stopped rather than stuck in "stopping" forever.
    await disposePluginHandle(handle, plugin.id);
    plugin.state = "stopped";
  }

  /**
   * Records a runtime error against a plugin. Past the threshold inside the
   * window the plugin is marked failed and torn down, because a plugin
   * throwing on every call is worse than one that is off.
   */
  async reportError(pluginId: string, error: unknown): Promise<void> {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) return;

    const message = error instanceof Error ? error.message : String(error);
    plugin.lastError = message;

    pluginLogger.error(
      `Plugin ${pluginId} threw at runtime`,
      error instanceof Error ? error : new Error(message),
      { operation: "plugin_runtime" },
    );

    const windowMs = this.options.errorWindowMs ?? DEFAULT_ERROR_WINDOW_MS;
    const threshold = this.options.errorThreshold ?? DEFAULT_ERROR_THRESHOLD;
    const now = Date.now();

    plugin.errorTimestamps = [
      ...plugin.errorTimestamps.filter((at) => now - at < windowMs),
      now,
    ];

    if (plugin.errorTimestamps.length < threshold) return;

    pluginLogger.error(
      `Plugin ${pluginId} failed ${plugin.errorTimestamps.length} times in ${windowMs}ms and has been stopped`,
      new Error(message),
      { operation: "plugin_runtime" },
    );

    await this.deactivate(pluginId);
    plugin.state = "failed";
    plugin.lastError = message;
    plugin.errorTimestamps = [];
    this.options.onFailed?.(plugin);
  }

  /**
   * Wraps a plugin callback so a throw is counted rather than escaping into
   * whichever core call site invoked it.
   */
  wrap<Args extends unknown[], Result>(
    pluginId: string,
    fn: (...args: Args) => Result | Promise<Result>,
  ): (...args: Args) => Promise<Result | undefined> {
    return async (...args: Args) => {
      try {
        return await fn(...args);
      } catch (error) {
        await this.reportError(pluginId, error);
        return undefined;
      }
    };
  }

  /** Clears the error budget and starts the plugin again. */
  async retry(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    plugin.errorTimestamps = [];
    plugin.lastError = null;
    plugin.state = "loaded";
    await this.activate(pluginId);
  }

  /** Stops everything, reverse activation order. */
  async shutdown(): Promise<void> {
    for (const id of [...this.activationOrder].reverse()) {
      try {
        await this.deactivate(id);
      } catch (error) {
        pluginLogger.error(
          `Failed to deactivate plugin ${id} during shutdown`,
          error instanceof Error ? error : new Error(String(error)),
          { operation: "plugin_shutdown" },
        );
      }
    }
    this.activationOrder = [];
  }

  private requirePlugin(pluginId: string): LoadedPlugin {
    const plugin = this.plugins.get(pluginId);
    if (!plugin) throw new Error(`Plugin ${pluginId} is not loaded`);
    return plugin;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function pathToFileUrlString(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return `file://${resolved.startsWith("/") ? "" : "/"}${resolved}`;
}
