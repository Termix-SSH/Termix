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
 * impossible.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import * as tar from "tar";
import { pluginLogger } from "../utils/logger.js";
import { isTermixCompatible, parseManifest } from "./manifest.js";
import { getLocalVersion } from "../utils/app-version.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  getBundledPluginsDir,
  getPluginBackendEntry,
  getPluginManifestPath,
  getPluginsDir,
  getUnpackedPluginsDir,
} from "./paths.js";
import { requireSignedPlugins, verifyPluginArtifact } from "./trust.js";
import {
  createPluginContext,
  createPluginHandle,
  disposePluginHandle,
  type PluginHandle,
  type PluginModule,
} from "./ctx.js";
import { resolveRequirements } from "./service-registry.js";
import { resolveSecretRequirements } from "./secret-registry.js";
import { recordConflict } from "./conflicts.js";
import { tablePrefix } from "@termix/plugin-sdk/db";

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
  /**
   * The .tmxplug this copy was unpacked from. Set for user plugins and for a
   * signed update that replaced a bundled plugin.
   */
  artifact?: string;
  /** Key id that signed the artifact, when a trusted key signed it. */
  signedBy?: string;
}

export interface PluginLoaderOptions {
  errorThreshold?: number;
  errorWindowMs?: number;
  /** Called when a plugin trips the error budget and is torn down. */
  onFailed?: (plugin: LoadedPlugin) => void;
}

export class PluginLoader {
  private readonly plugins = new Map<string, LoadedPlugin>();
  /** Version of each bundled plugin as shipped, the floor for any update. */
  private readonly bundledVersions = new Map<string, string>();
  /** Activation order, so shutdown can run it backwards. */
  private activationOrder: string[] = [];

  constructor(private readonly options: PluginLoaderOptions = {}) {}

  list(): LoadedPlugin[] {
    return [...this.plugins.values()];
  }

  get(pluginId: string): LoadedPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /** Ids of the plugins that ship with this install, loaded or replaced. */
  bundledIds(): Set<string> {
    return new Set([
      ...this.bundledVersions.keys(),
      ...this.list()
        .filter((plugin) => plugin.source === "bundled")
        .map((plugin) => plugin.id),
    ]);
  }

  /** Drops a stopped plugin from the list, so a new copy can load in its place. */
  forget(pluginId: string): void {
    const plugin = this.plugins.get(pluginId);
    if (plugin?.state === "active" || plugin?.state === "activating") {
      throw new Error(`Plugin ${pluginId} is still running`);
    }
    this.plugins.delete(pluginId);
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

    if (!isTermixCompatible(manifest.engine.termix, getLocalVersion())) {
      throw new Error(
        `Plugin ${manifest.id} needs Termix ${manifest.engine.termix}, but this is ${getLocalVersion()}`,
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
    // A symlink can point anywhere, so the real path has to stay inside too.
    if (!isRealPathInside(dir, entry)) {
      throw new Error(
        `Plugin ${manifest.id} backend entry resolves outside the plugin directory`,
      );
    }

    if (this.plugins.has(manifest.id)) {
      throw new Error(`another plugin already uses the id "${manifest.id}"`);
    }

    const overlap = [...this.plugins.values()].find((other) =>
      prefixesOverlap(other.id, manifest.id),
    );
    if (overlap) {
      recordConflict({
        kind: "id",
        pluginId: manifest.id,
        heldBy: overlap.id,
        name: tablePrefix(manifest.id),
      });
      throw new Error(
        `Plugin id "${manifest.id}" overlaps "${overlap.id}": their table names would share the prefix ${tablePrefix(overlap.id)}`,
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
   * Scans both roots. A user plugin folder can never shadow a bundled one: the
   * collision is rejected with an error rather than silently skipped.
   *
   * The one way to replace a bundled plugin is a .tmxplug signed by a trusted
   * key with a higher version (see loadArtifact). That is how one official
   * plugin ships an update without a core release.
   */
  async loadAll(): Promise<LoadedPlugin[]> {
    this.plugins.clear();
    this.bundledVersions.clear();
    const loaded: LoadedPlugin[] = [];
    // Every bundled folder name, loaded or not: a bundled plugin that fails
    // to load must not leave its id free for a user plugin to take.
    const bundledIds = new Set<string>();

    const roots: Array<{ root: string; source: PluginSource }> = [
      { root: getBundledPluginsDir(), source: "bundled" },
      { root: getPluginsDir(), source: "user" },
    ];

    for (const { root, source } of roots) {
      if (!fs.existsSync(root)) continue;

      const entries = await fs.promises.readdir(root, { withFileTypes: true });
      if (source === "bundled") {
        for (const entry of entries) {
          if (entry.isDirectory()) bundledIds.add(entry.name);
        }
      }

      for (const entry of entries) {
        const isArtifact =
          source === "user" &&
          entry.isFile() &&
          entry.name.endsWith(".tmxplug");
        if (!entry.isDirectory() && !isArtifact) continue;
        if (entry.isDirectory() && entry.name.startsWith(".")) continue;

        const dir = path.join(root, entry.name);
        try {
          if (isArtifact) {
            const plugin = await this.loadArtifact(dir, bundledIds);
            const index = loaded.findIndex((other) => other.id === plugin.id);
            if (index >= 0) loaded[index] = plugin;
            else loaded.push(plugin);
            continue;
          }

          if (source === "user" && bundledIds.has(entry.name)) {
            throw new Error(
              `a bundled plugin already uses the id "${entry.name}"; only a signed .tmxplug with a higher version can replace it`,
            );
          }

          // A folder carries no signature, so with signing required only a
          // signed .tmxplug can install a plugin. Bundled plugins are trusted
          // by shipping in the image.
          if (source === "user" && requireSignedPlugins()) {
            throw new Error(
              "TERMIX_REQUIRE_SIGNED_PLUGINS is on and a plugin folder carries no signature; install it as a signed .tmxplug",
            );
          }

          const plugin = await this.load(dir, source);
          if (source === "bundled") {
            this.bundledVersions.set(plugin.id, plugin.manifest.version);
          }
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
   * Loads a user-installed <name>.tmxplug. A .sig next to it must verify
   * against a pinned key; with TERMIX_REQUIRE_SIGNED_PLUGINS=true it must
   * also exist. The archive is unpacked fresh on every load, so the file
   * stays the only source of truth.
   *
   * An artifact with a bundled plugin's id is an update to it. It replaces
   * the bundled copy only when a trusted key signed it and its version is
   * higher; if it then fails to load the bundled copy stays.
   */
  async loadArtifact(
    file: string,
    bundledIds: ReadonlySet<string> = new Set(),
  ): Promise<LoadedPlugin> {
    const buffer = await fs.promises.readFile(file);
    const sigFile = `${file}.sig`;
    let signedBy: string | undefined;

    if (fs.existsSync(sigFile)) {
      const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
      const result = verifyPluginArtifact(
        buffer,
        sha256,
        await fs.promises.readFile(sigFile, "utf8"),
      );
      if (result.ok === false) {
        throw new Error(`signature check failed: ${result.reason}`);
      }
      signedBy = result.keyId;
    } else if (requireSignedPlugins()) {
      throw new Error(
        `TERMIX_REQUIRE_SIGNED_PLUGINS is on and ${path.basename(file)} has no .sig next to it`,
      );
    }

    const unpackedRoot = getUnpackedPluginsDir();
    const staging = path.join(
      unpackedRoot,
      `.staging-${crypto.randomBytes(6).toString("hex")}`,
    );
    await fs.promises.mkdir(staging, { recursive: true });
    try {
      await tar.x({
        file,
        cwd: staging,
        strict: true,
        // Plain files and folders only. tar already refuses absolute and
        // ".." paths unless preservePaths is set.
        filter: (_entryPath, entry) =>
          "type" in entry &&
          (entry.type === "File" || entry.type === "Directory"),
      });

      const raw = JSON.parse(
        await fs.promises.readFile(getPluginManifestPath(staging), "utf8"),
      );
      const id = typeof raw?.id === "string" ? raw.id : "";
      if (!PLUGIN_ID_PATTERN.test(id)) {
        throw new Error(`${path.basename(file)} has no valid manifest id`);
      }

      const isUpdate = bundledIds.has(id);
      const replaced = isUpdate ? this.plugins.get(id) : undefined;
      if (isUpdate) {
        assertBundledUpdate(
          id,
          raw?.version,
          signedBy,
          this.bundledVersions.get(id) ?? replaced?.manifest.version,
        );
      } else if (this.plugins.has(id)) {
        throw new Error(`another plugin already uses the id "${id}"`);
      }
      if (replaced && replaced.state !== "loaded") {
        throw new Error(`plugin ${id} is running; stop it before updating`);
      }

      const target = path.join(unpackedRoot, id);
      await fs.promises.rm(target, { recursive: true, force: true });
      await fs.promises.rename(staging, target);

      if (replaced) this.plugins.delete(id);
      try {
        // A signed update keeps the bundled trust it replaces.
        const plugin = await this.load(target, isUpdate ? "bundled" : "user");
        plugin.artifact = file;
        plugin.signedBy = signedBy;
        if (replaced) {
          pluginLogger.info(
            `Plugin ${id} updated from ${replaced.manifest.version} to ${plugin.manifest.version}`,
            { operation: "plugin_load" },
          );
        }
        return plugin;
      } catch (error) {
        if (replaced) this.plugins.set(id, replaced);
        throw error;
      }
    } finally {
      await fs.promises.rm(staging, { recursive: true, force: true });
    }
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

    const entryPath = getPluginBackendEntry(plugin.dir, plugin.manifest);
    // Node caches ESM by URL, so a plugin replaced without a restart would
    // otherwise keep running the old code.
    const entry = `${pathToFileUrlString(entryPath)}?v=${encodeURIComponent(
      `${plugin.manifest.version}-${fileStamp(entryPath)}`,
    )}`;

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
      const applied = await migratePlugin(plugin.id, plugin.dir, {
        bundled: plugin.source === "bundled",
      });
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

  /** Clears the error budget and starts the plugin again. */
  async retry(pluginId: string): Promise<void> {
    const plugin = this.requirePlugin(pluginId);
    if (plugin.state === "activating") {
      throw new Error(`Plugin ${pluginId} is still activating`);
    }
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

const PLUGIN_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Throws unless an artifact may replace the bundled plugin with the same id:
 * a trusted key signed it and its version is strictly higher, so an old
 * signed build can never be replayed as a downgrade.
 */
export function assertBundledUpdate(
  id: string,
  version: unknown,
  signedBy: string | undefined,
  bundledVersion: string | undefined,
): void {
  if (!signedBy) {
    throw new Error(
      `a bundled plugin already uses the id "${id}"; only a signed update can replace it`,
    );
  }
  if (typeof version !== "string" || !semver.valid(version)) {
    throw new Error(`update for "${id}" has no valid version`);
  }
  if (bundledVersion && !semver.gt(version, bundledVersion)) {
    throw new Error(
      `update for "${id}" is ${version}, which is not newer than the bundled ${bundledVersion}`,
    );
  }
}

function fileStamp(filePath: string): string {
  try {
    const stat = fs.statSync(filePath);
    return `${stat.size}-${Math.round(stat.mtimeMs)}`;
  } catch {
    return "0";
  }
}

function pathToFileUrlString(filePath: string): string {
  const resolved = path.resolve(filePath).replace(/\\/g, "/");
  return `file://${resolved.startsWith("/") ? "" : "/"}${resolved}`;
}

/**
 * True when one id's table prefix starts with the other's: "foo" owns
 * p_foo_*, which already covers every table "foo-bar" (p_foo_bar_*) creates.
 */
export function prefixesOverlap(a: string, b: string): boolean {
  if (a === b) return false;
  const left = tablePrefix(a);
  const right = tablePrefix(b);
  return left.startsWith(right) || right.startsWith(left);
}

/** Whether `target` really lives under `root`, following symlinks. */
export function isRealPathInside(root: string, target: string): boolean {
  try {
    const realRoot = fs.realpathSync(root);
    const relative = path.relative(realRoot, fs.realpathSync(target));
    return (
      relative === "" ||
      (!relative.startsWith("..") && !path.isAbsolute(relative))
    );
  } catch {
    return false;
  }
}
