/**
 * Installing, updating, uninstalling and switching plugins at runtime.
 *
 * The official registry is the one real source. With developer mode on, an
 * admin can also install a .tmxplug from a file; that skips the download,
 * sha256 and signature checks and stays marked unverified. Bundled plugins ship in the
 * image and can still be uninstalled: their files are deleted and the id is
 * recorded in the settings table, so the shipped copy is ignored from then
 * on and a reinstall downloads the plugin like any other.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import semver from "semver";
import { pluginLogger } from "../utils/logger.js";
import {
  activatePlugin,
  deactivatePlugin,
  getPluginRuntime,
  registerLoadedPlugins,
  unloadPlugin,
} from "./index.js";
import type { LoadedPlugin, PluginLoader } from "./loader.js";
import {
  getBundledPluginsDir,
  getPluginDataDir,
  getPluginsDir,
  getUnpackedPluginsDir,
} from "./paths.js";
import {
  OFFICIAL_REGISTRY_ID,
  downloadRelease,
  fetchRegistryIndex,
  findRelease,
  getDownloadsDir,
  getRegistryStatus,
  isApiCompatible,
  type RegistryIndex,
  type RegistryVersion,
} from "./registry-index.js";
import { invalidatePluginPermissionCache } from "./permissions.js";
import { moveWithRetry } from "./fs-retry.js";
import { readInstallCounts } from "./install-counts.js";
import { readArtifactManifest, sameCapabilities } from "./artifact-manifest.js";
import {
  parseManifest,
  pluginFeatures,
  type PluginManifest,
} from "./manifest.js";
import { requireSignedPlugins } from "./trust.js";
import {
  parseChangelog,
  parseReleaseNotes,
  type ChangelogRelease,
  type ReleaseNotes,
} from "@termix-ssh/plugin-sdk/changelog";

const UNINSTALLED_KEY = "plugins_uninstalled";
const DEVELOPER_MODE_KEY = "plugins_developer_mode";
/** Installed from a file with no registry signature behind it. Never cleared. */
export const UNVERIFIED_TIER = "unverified";

export class PluginManageError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

let queue: Promise<unknown> = Promise.resolve();

/** One change at a time: dependencies make concurrent changes unsafe. */
export function serialized<T>(fn: () => Promise<T>): Promise<T> {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function repos() {
  return import("../database/repositories/factory.js");
}

export async function readUninstalled(): Promise<Set<string>> {
  const { createCurrentSettingsRepository } = await repos();
  const raw = await createCurrentSettingsRepository().get(UNINSTALLED_KEY);
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw);
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

async function writeUninstalled(ids: Set<string>): Promise<void> {
  const { createCurrentSettingsRepository } = await repos();
  await createCurrentSettingsRepository().set(
    UNINSTALLED_KEY,
    JSON.stringify([...ids].sort()),
  );
  getPluginRuntime().loader.setUninstalled(ids);
}

async function readPins(): Promise<Map<string, string>> {
  const { createCurrentPluginRepository } = await repos();
  const pins = new Map<string, string>();
  for (const record of await createCurrentPluginRepository().listAll()) {
    if (record.pinnedVersion) pins.set(record.id, record.pinnedVersion);
  }
  return pins;
}

/** Called once before the boot scan, so it honours uninstalls and pins. */
export async function applyStoredPluginChoices(
  loader: PluginLoader,
): Promise<void> {
  try {
    loader.setUninstalled(await readUninstalled());
    loader.setPinned(await readPins());
  } catch (error) {
    pluginLogger.warn(
      `Could not read stored plugin choices: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { operation: "plugin_init" },
    );
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

function isBundledOnDisk(pluginId: string): boolean {
  return fs.existsSync(
    path.join(getBundledPluginsDir(), pluginId, "manifest.json"),
  );
}

/** Whether `target` is a folder strictly inside `root`. */
function isStrictlyInside(root: string, target: string): boolean {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

/** A plugin dropped in as a plain folder under the plugins directory. */
async function removeUserFolder(
  pluginId: string,
  live: LoadedPlugin | undefined,
): Promise<void> {
  const root = getPluginsDir();
  const candidates = new Set([path.join(root, pluginId)]);
  if (live?.source === "user" && !live.artifact) candidates.add(live.dir);
  for (const dir of candidates) {
    if (!isStrictlyInside(root, dir)) continue;
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}

/**
 * Deletes the copy that shipped in the image. A read-only install keeps the
 * files, which is fine: the id is on the ignore list either way.
 */
async function removeShippedCopy(pluginId: string): Promise<void> {
  const root = getBundledPluginsDir();
  const dir = path.join(root, pluginId);
  if (!isStrictlyInside(root, dir)) return;
  try {
    await fs.promises.rm(dir, { recursive: true, force: true });
  } catch (error) {
    pluginLogger.warn(
      `Could not delete the shipped copy of ${pluginId}, it stays ignored: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { operation: "plugin_uninstall" },
    );
  }
}

export async function isLinkedDesktop(): Promise<boolean> {
  if (process.env.ELECTRON_EMBEDDED !== "true") return false;
  const { getLink } = await import("../sync/client/link-store.js");
  return Boolean(await getLink());
}

function latestCompatible(versions: RegistryVersion[]): RegistryVersion | null {
  return versions.find((entry) => isApiCompatible(entry.api)) ?? null;
}

function addedCapabilities(
  current: readonly string[],
  next: readonly string[],
): string[] {
  const have = new Set(current);
  return next.filter((capability) => !have.has(capability));
}

export interface RegistryListing {
  registry: ReturnType<typeof getRegistryStatus> & { id: string };
  /** A linked desktop runs what its server runs, so nothing here can change. */
  managedByServer: boolean;
  plugins: Array<{
    id: string;
    name: string;
    description: string;
    author: string;
    category: string;
    repository?: string;
    icon?: string;
    videoId?: string;
    features: string[];
    versions: Array<{
      version: string;
      compatible: boolean;
      capabilities: string[];
      publishedAt?: string;
      releaseNotesUrl?: string;
      notes?: ReleaseNotes;
      size: number;
    }>;
    latestVersion: string | null;
    installed: boolean;
    installedVersion: string | null;
    updateAvailable: boolean;
    addedCapabilities: string[];
    pinnedVersion: string | null;
    autoUpdate: boolean;
    bundled: boolean;
    /** See install-counts.ts for what this number does and does not mean. */
    installCount: number | null;
    installCountSource: string | null;
  }>;
}

export async function listRegistry(
  options: { force?: boolean } = {},
): Promise<RegistryListing> {
  const index = await fetchRegistryIndex(options);
  const { createCurrentPluginRepository } = await repos();
  const records = new Map(
    (await createCurrentPluginRepository().listAll()).map((r) => [r.id, r]),
  );
  const counts = await readInstallCounts();
  const { loader } = getPluginRuntime();
  const shipped = loader.bundledIds();

  return {
    registry: { id: OFFICIAL_REGISTRY_ID, ...getRegistryStatus() },
    managedByServer: await isLinkedDesktop(),
    plugins: index.plugins.map((plugin) => {
      const record = records.get(plugin.id);
      const live = loader.get(plugin.id);
      const latest = latestCompatible(plugin.versions);
      const installedVersion =
        live?.manifest.version ?? record?.version ?? null;
      const updateAvailable = Boolean(
        installedVersion &&
        latest &&
        semver.valid(installedVersion) &&
        semver.gt(latest.version, installedVersion),
      );
      return {
        id: plugin.id,
        name: plugin.name,
        description: plugin.description,
        author: plugin.author,
        category: plugin.category,
        repository: plugin.repository,
        icon: plugin.icon,
        videoId: plugin.videoId,
        features: plugin.features,
        versions: plugin.versions.map((entry) => ({
          version: entry.version,
          compatible: isApiCompatible(entry.api),
          capabilities: entry.capabilities,
          publishedAt: entry.publishedAt,
          releaseNotesUrl: entry.releaseNotesUrl,
          notes: readReleaseNotes(entry.notes),
          size: entry.size,
        })),
        latestVersion: latest?.version ?? null,
        installed: Boolean(record),
        installedVersion: record ? installedVersion : null,
        updateAvailable: Boolean(record) && updateAvailable,
        addedCapabilities:
          updateAvailable && latest
            ? addedCapabilities(
                live?.manifest.capabilities ?? [],
                latest.capabilities,
              )
            : [],
        pinnedVersion: record?.pinnedVersion ?? null,
        autoUpdate: Boolean(record?.autoUpdate),
        bundled: shipped.has(plugin.id),
        installCount: counts.get(plugin.id)?.count ?? null,
        installCountSource: counts.get(plugin.id)?.source ?? null,
      };
    }),
  };
}

async function removeArtifactFiles(
  pluginId: string,
  extra?: string,
): Promise<void> {
  const candidates = new Set<string>([
    path.join(getPluginsDir(), `${pluginId}.tmxplug`),
  ]);
  if (extra) candidates.add(extra);
  for (const file of candidates) {
    await fs.promises.rm(file, { force: true });
    await fs.promises.rm(`${file}.sig`, { force: true });
  }
}

/** Grants every capability the manifest declares, after the admin agreed. */
async function grantDeclared(
  plugin: LoadedPlugin,
  userId: string | null,
): Promise<void> {
  if (plugin.source === "bundled") return;
  const { createCurrentPluginPermissionGrantRepository } = await repos();
  const repository = createCurrentPluginPermissionGrantRepository();
  const granted = new Set(
    (await repository.listByPlugin(plugin.id)).map((g) => g.capability),
  );
  for (const capability of plugin.manifest.capabilities) {
    if (granted.has(capability)) continue;
    await repository.grant({
      pluginId: plugin.id,
      capability,
      grantedBy: userId,
      source: "admin",
    });
  }
  invalidatePluginPermissionCache(plugin.id);
}

type SwapSource = { release: RegistryVersion } | { upload: string };

/**
 * Puts a registry release, or an uploaded file, in place of whatever copy of
 * the plugin is loaded. On a failed load the previous copy comes back.
 */
async function swapIn(
  pluginId: string,
  source: SwapSource,
): Promise<LoadedPlugin> {
  const { loader } = getPluginRuntime();
  const previous = loader.get(pluginId);
  const bundledVersion = loader.bundledVersion(pluginId);
  const useBundled =
    "release" in source &&
    bundledVersion !== undefined &&
    bundledVersion === source.release.version &&
    isBundledOnDisk(pluginId);

  // Fetched before anything stops, so a bad download changes nothing.
  const staged = useBundled
    ? null
    : "release" in source
      ? await downloadRelease(pluginId, source.release)
      : { file: source.upload, signatureFile: `${source.upload}.sig` };

  const finalFile = path.join(getPluginsDir(), `${pluginId}.tmxplug`);
  const backupDir = path.join(getDownloadsDir(), `${pluginId}.previous`);
  const previousArtifact = previous?.artifact;

  await unloadPlugin(pluginId);

  if (previousArtifact && fs.existsSync(previousArtifact)) {
    await fs.promises.mkdir(backupDir, { recursive: true });
    await fs.promises.copyFile(
      previousArtifact,
      path.join(backupDir, "plugin.tmxplug"),
    );
    if (fs.existsSync(`${previousArtifact}.sig`)) {
      await fs.promises.copyFile(
        `${previousArtifact}.sig`,
        path.join(backupDir, "plugin.tmxplug.sig"),
      );
    }
  }

  try {
    await removeArtifactFiles(pluginId, previousArtifact);
    let plugin: LoadedPlugin;
    if (staged) {
      await fs.promises.mkdir(getPluginsDir(), { recursive: true });
      await moveWithRetry(staged.file, finalFile);
      if (fs.existsSync(staged.signatureFile)) {
        await moveWithRetry(staged.signatureFile, `${finalFile}.sig`);
      }
      plugin = await loader.loadArtifact(finalFile, loader.bundledIds());
    } else {
      plugin = await loader.loadBundled(pluginId);
    }
    await registerLoadedPlugins([plugin]);
    return plugin;
  } catch (error) {
    await removeArtifactFiles(pluginId);
    await restorePrevious(pluginId, previousArtifact, backupDir);
    throw error;
  } finally {
    await fs.promises.rm(backupDir, { recursive: true, force: true });
    if (staged) {
      await fs.promises.rm(staged.file, { force: true });
      await fs.promises.rm(staged.signatureFile, { force: true });
    }
  }
}

async function restorePrevious(
  pluginId: string,
  previousArtifact: string | undefined,
  backupDir: string,
): Promise<void> {
  const { loader } = getPluginRuntime();
  if (loader.get(pluginId)) return;
  try {
    const backup = path.join(backupDir, "plugin.tmxplug");
    if (previousArtifact && fs.existsSync(backup)) {
      await fs.promises.copyFile(backup, previousArtifact);
      if (fs.existsSync(`${backup}.sig`)) {
        await fs.promises.copyFile(`${backup}.sig`, `${previousArtifact}.sig`);
      }
      await loader.loadArtifact(previousArtifact, loader.bundledIds());
    } else if (
      loader.bundledVersion(pluginId) !== undefined &&
      isBundledOnDisk(pluginId)
    ) {
      await loader.loadBundled(pluginId);
    }
  } catch (error) {
    pluginLogger.error(
      `Could not restore the previous copy of ${pluginId}`,
      error instanceof Error ? error : new Error(String(error)),
      { operation: "plugin_install" },
    );
  }
}

async function recordState(
  pluginId: string,
  state: string,
  lastError: string | null,
): Promise<void> {
  const { createCurrentPluginRepository } = await repos();
  await createCurrentPluginRepository().update(pluginId, { state, lastError });
}

/** Starts a plugin and records how it went. Never throws on a failed start. */
async function startAndRecord(pluginId: string): Promise<string> {
  try {
    await recordState(pluginId, "enabled", null);
    await activatePlugin(pluginId);
    return "active";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordState(pluginId, "failed", message);
    return "failed";
  }
}

async function enabledIds(): Promise<Set<string>> {
  const { createCurrentPluginRepository } = await repos();
  return new Set(
    (await createCurrentPluginRepository().listAll())
      .filter((record) => record.state === "enabled")
      .map((record) => record.id),
  );
}

/** Hard dependencies to start first, deepest first. */
function dependencyChain(pluginId: string): {
  order: string[];
  missing: string[];
} {
  const { loader } = getPluginRuntime();
  const order: string[] = [];
  const missing: string[] = [];
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    const plugin = loader.get(id);
    if (!plugin) {
      missing.push(id);
      return;
    }
    for (const [dependency, range] of Object.entries(
      plugin.manifest.dependencies ?? {},
    )) {
      const found = loader.get(dependency);
      if (found && !semver.satisfies(found.manifest.version, range)) {
        missing.push(`${dependency}@${range}`);
        continue;
      }
      visit(dependency);
    }
    if (id !== pluginId) order.push(id);
  };
  visit(pluginId);
  return { order, missing };
}

/** Running plugins that hard-depend on this one, outermost first. */
function dependentChain(pluginId: string, enabled: Set<string>): string[] {
  const { loader } = getPluginRuntime();
  const result: string[] = [];
  const visit = (id: string) => {
    for (const plugin of loader.list()) {
      if (!enabled.has(plugin.id) || result.includes(plugin.id)) continue;
      if (!(id in (plugin.manifest.dependencies ?? {}))) continue;
      visit(plugin.id);
      result.push(plugin.id);
    }
  };
  visit(pluginId);
  return result;
}

export interface StateChangePlan {
  enable: string[];
  disable: string[];
  missing: string[];
}

export async function planStateChange(
  pluginId: string,
  enabled: boolean,
): Promise<StateChangePlan> {
  const current = await enabledIds();
  if (enabled) {
    const { order, missing } = dependencyChain(pluginId);
    return {
      enable: order.filter((id) => !current.has(id)),
      disable: [],
      missing,
    };
  }
  return {
    enable: [],
    disable: dependentChain(pluginId, current),
    missing: [],
  };
}

export function setPluginState(
  pluginId: string,
  enabled: boolean,
): Promise<StateChangePlan & { state: string }> {
  return serialized(() => setPluginStateUnlocked(pluginId, enabled));
}

/** setPluginState for a caller already inside serialized(). */
export async function setPluginStateUnlocked(
  pluginId: string,
  enabled: boolean,
): Promise<StateChangePlan & { state: string }> {
  const { loader } = getPluginRuntime();
  if (!loader.get(pluginId)) {
    throw new PluginManageError("Plugin not found", 404, "NOT_FOUND");
  }
  const plan = await planStateChange(pluginId, enabled);

  if (enabled) {
    if (plan.missing.length > 0) {
      throw new PluginManageError(
        "Some dependencies are not installed",
        409,
        "MISSING_DEPENDENCIES",
        { missing: plan.missing },
      );
    }
    for (const id of plan.enable) {
      if ((await startAndRecord(id)) === "failed") {
        await recordState(
          pluginId,
          "blocked",
          `requires plugin "${id}", which could not start`,
        );
        return { ...plan, state: "blocked" };
      }
    }
    return { ...plan, state: await startAndRecord(pluginId) };
  }

  for (const id of [...plan.disable, pluginId]) {
    await recordState(id, "disabled", null);
    await deactivatePlugin(id);
  }
  return { ...plan, state: "stopped" };
}

export interface InstallOptions {
  version?: string;
  userId: string | null;
  acceptCapabilities?: boolean;
  /**
   * The capabilities the consent prompt showed: every one for an install,
   * the added ones for an update. Must match what the release asks for.
   */
  capabilities?: string[];
}

function assertConsent(
  consented: string[] | undefined,
  asked: readonly string[],
): void {
  if (consented === undefined) {
    throw new PluginManageError(
      "The capabilities agreed to were not sent",
      400,
      "CONSENT_REQUIRED",
    );
  }
  if (!sameCapabilities(consented, asked)) {
    throw new PluginManageError(
      "The capabilities agreed to do not match what this release asks for",
      409,
      "CONSENT_MISMATCH",
      { capabilities: [...asked] },
    );
  }
}

async function requireRelease(
  pluginId: string,
  version: string | undefined,
): Promise<{
  index: RegistryIndex;
  release: RegistryVersion;
  latest: RegistryVersion | null;
}> {
  let index: RegistryIndex;
  try {
    index = await fetchRegistryIndex();
  } catch (error) {
    throw new PluginManageError(
      `Could not reach the plugin registry: ${
        error instanceof Error ? error.message : String(error)
      }`,
      502,
      "REGISTRY_UNREACHABLE",
    );
  }
  const found = findRelease(index, pluginId, version);
  if (!found) {
    throw new PluginManageError(
      version
        ? `${pluginId} ${version} is not in the official registry`
        : `${pluginId} is not in the official registry`,
      404,
      "NOT_IN_REGISTRY",
    );
  }
  if (!isApiCompatible(found.release.api)) {
    throw new PluginManageError(
      `${pluginId} ${found.release.version} does not run on this version of Termix`,
      409,
      "INCOMPATIBLE",
    );
  }
  return {
    index,
    release: found.release,
    latest: latestCompatible(found.plugin.versions),
  };
}

/** The version to hold at: an explicit pick that is not the newest. */
function pinFor(
  release: RegistryVersion,
  latest: RegistryVersion | null,
  requested: string | undefined,
): string | null {
  if (!requested) return null;
  return latest && latest.version === release.version ? null : release.version;
}

async function applyPin(pluginId: string, pin: string | null): Promise<void> {
  const { loader } = getPluginRuntime();
  const pins = await readPins();
  if (pin) pins.set(pluginId, pin);
  else pins.delete(pluginId);
  loader.setPinned(pins);
}

export function installPlugin(
  pluginId: string,
  options: InstallOptions,
): Promise<{ id: string; version: string; state: string }> {
  return serialized(async () => {
    const { createCurrentPluginRepository } = await repos();
    const repository = createCurrentPluginRepository();
    if (await repository.findById(pluginId)) {
      throw new PluginManageError(
        "Plugin is already installed",
        409,
        "ALREADY_INSTALLED",
      );
    }

    const { release, latest } = await requireRelease(pluginId, options.version);
    assertConsent(options.capabilities, release.capabilities);
    const pin = pinFor(release, latest, options.version);
    await applyPin(pluginId, pin);

    let plugin: LoadedPlugin;
    try {
      plugin = await swapIn(pluginId, { release });
    } catch (error) {
      await applyPin(pluginId, null);
      throw new PluginManageError(
        error instanceof Error ? error.message : String(error),
        500,
        "INSTALL_FAILED",
      );
    }

    await repository.update(pluginId, {
      registryId: OFFICIAL_REGISTRY_ID,
      tier: plugin.source === "bundled" ? "bundled" : "official",
      pinnedVersion: pin,
    });
    await grantDeclared(plugin, options.userId);

    const { missing } = dependencyChain(pluginId);
    if (missing.length > 0) {
      await recordState(
        pluginId,
        "blocked",
        `requires ${missing.map((id) => `"${id}"`).join(", ")}, which is not installed`,
      );
      return { id: pluginId, version: release.version, state: "blocked" };
    }
    for (const id of (await planStateChange(pluginId, true)).enable) {
      await startAndRecord(id);
    }
    const state = await startAndRecord(pluginId);
    pluginLogger.info(`Installed plugin ${pluginId}@${release.version}`, {
      operation: "plugin_install",
    });
    return { id: pluginId, version: release.version, state };
  });
}

export function updatePlugin(
  pluginId: string,
  options: InstallOptions,
): Promise<{ id: string; version: string; state: string }> {
  return serialized(() => updateUnlocked(pluginId, options));
}

async function updateUnlocked(
  pluginId: string,
  options: InstallOptions,
): Promise<{ id: string; version: string; state: string }> {
  const { createCurrentPluginRepository } = await repos();
  const repository = createCurrentPluginRepository();
  const record = await repository.findById(pluginId);
  const { loader } = getPluginRuntime();
  const live = loader.get(pluginId);
  if (!record || !live) {
    throw new PluginManageError("Plugin not found", 404, "NOT_FOUND");
  }

  const { release, latest } = await requireRelease(pluginId, options.version);
  if (release.version === live.manifest.version) {
    throw new PluginManageError(
      `${pluginId} ${release.version} is already installed`,
      409,
      "SAME_VERSION",
    );
  }

  const added = addedCapabilities(
    live.manifest.capabilities,
    release.capabilities,
  );
  if (added.length > 0) {
    if (!options.acceptCapabilities) {
      throw new PluginManageError(
        "This version asks for new capabilities",
        409,
        "CAPABILITIES_ADDED",
        { capabilities: added },
      );
    }
    assertConsent(options.capabilities, added);
  }

  const wasEnabled = record.state !== "disabled";
  const pin = pinFor(release, latest, options.version);
  await applyPin(pluginId, pin);

  let plugin: LoadedPlugin;
  try {
    plugin = await swapIn(pluginId, { release });
  } catch (error) {
    await applyPin(pluginId, record.pinnedVersion ?? null);
    if (wasEnabled && loader.get(pluginId)) await startAndRecord(pluginId);
    throw new PluginManageError(
      error instanceof Error ? error.message : String(error),
      500,
      "UPDATE_FAILED",
    );
  }

  await repository.update(pluginId, {
    registryId: OFFICIAL_REGISTRY_ID,
    tier: plugin.source === "bundled" ? "bundled" : "official",
    pinnedVersion: pin,
  });
  await grantDeclared(plugin, options.userId);

  const state = wasEnabled ? await startAndRecord(pluginId) : "stopped";
  pluginLogger.info(
    `Updated plugin ${pluginId} from ${live.manifest.version} to ${release.version}`,
    { operation: "plugin_update" },
  );
  return { id: pluginId, version: release.version, state };
}

export interface UpdateAllResult {
  updated: Array<{ id: string; version: string }>;
  needsReview: Array<{ id: string; capabilities: string[] }>;
  failed: Array<{ id: string; error: string }>;
}

/**
 * Updates every plugin with a newer compatible release. One that asks for
 * new capabilities is never updated here: it waits for an admin to review.
 */
export function updateAllPlugins(options: {
  userId: string | null;
  onlyAutoUpdate?: boolean;
}): Promise<UpdateAllResult> {
  return serialized(async () => {
    const result: UpdateAllResult = {
      updated: [],
      needsReview: [],
      failed: [],
    };
    const listing = await listRegistry({ force: true });
    for (const entry of listing.plugins) {
      if (!entry.updateAvailable || entry.pinnedVersion) continue;
      if (options.onlyAutoUpdate && !entry.autoUpdate) continue;
      if (entry.addedCapabilities.length > 0) {
        result.needsReview.push({
          id: entry.id,
          capabilities: entry.addedCapabilities,
        });
        continue;
      }
      try {
        const done = await updateUnlocked(entry.id, { userId: options.userId });
        result.updated.push({ id: done.id, version: done.version });
      } catch (error) {
        result.failed.push({
          id: entry.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return result;
  });
}

export function uninstallPlugin(
  pluginId: string,
): Promise<{ id: string; removed: { tables: string[]; kvKeys: number } }> {
  return serialized(() => uninstallPluginUnlocked(pluginId));
}

/** uninstallPlugin for a caller already inside serialized(). */
export async function uninstallPluginUnlocked(
  pluginId: string,
): Promise<{ id: string; removed: { tables: string[]; kvKeys: number } }> {
  if (!ID_PATTERN.test(pluginId)) {
    throw new PluginManageError("Invalid plugin id", 400, "INVALID_ID");
  }
  const { createCurrentPluginRepository } = await repos();
  const repository = createCurrentPluginRepository();
  const record = await repository.findById(pluginId);
  const { loader } = getPluginRuntime();
  const live = loader.get(pluginId);
  if (!record && !live) {
    throw new PluginManageError("Plugin not found", 404, "NOT_FOUND");
  }
  const shipped = loader.bundledIds().has(pluginId);

  const dependents = dependentChain(pluginId, await enabledIds());
  if (dependents.length > 0) {
    throw new PluginManageError(
      "Other plugins depend on this one",
      409,
      "HAS_DEPENDENTS",
      { dependents },
    );
  }

  if (live) await deactivatePlugin(pluginId);

  const { removePluginData } = await import("./data.js");
  const removed = await removePluginData(pluginId, {
    knownPluginIds: loader.list().map((plugin) => plugin.id),
  });

  if (live) loader.forget(pluginId);
  await removeArtifactFiles(pluginId, live?.artifact);
  await removeUserFolder(pluginId, live);
  await fs.promises.rm(path.join(getUnpackedPluginsDir(), pluginId), {
    recursive: true,
    force: true,
  });
  await fs.promises.rm(getPluginDataDir(pluginId), {
    recursive: true,
    force: true,
  });
  await repository.delete(pluginId);
  await applyPin(pluginId, null);

  // Ignored even when the files are gone: a recreated container brings
  // the image's copy back, and it must not load in place of a reinstall.
  if (shipped) {
    const uninstalled = await readUninstalled();
    uninstalled.add(pluginId);
    await writeUninstalled(uninstalled);
    await removeShippedCopy(pluginId);
  }

  pluginLogger.info(`Uninstalled plugin ${pluginId}`, {
    operation: "plugin_uninstall",
  });
  return {
    id: pluginId,
    removed: { tables: removed.tables, kvKeys: removed.kvKeys },
  };
}

export function setPluginOptions(
  pluginId: string,
  options: { autoUpdate?: boolean; pinned?: boolean },
): Promise<{ autoUpdate: boolean; pinnedVersion: string | null }> {
  return serialized(async () => {
    const { createCurrentPluginRepository } = await repos();
    const repository = createCurrentPluginRepository();
    const record = await repository.findById(pluginId);
    if (!record) {
      throw new PluginManageError("Plugin not found", 404, "NOT_FOUND");
    }
    const live = getPluginRuntime().loader.get(pluginId);
    const pinnedVersion =
      options.pinned === undefined
        ? record.pinnedVersion
        : options.pinned
          ? (live?.manifest.version ?? record.version)
          : null;
    const updated = await repository.update(pluginId, {
      autoUpdate: options.autoUpdate,
      pinnedVersion,
    });
    await applyPin(pluginId, pinnedVersion);
    return {
      autoUpdate: Boolean(updated?.autoUpdate),
      pinnedVersion: updated?.pinnedVersion ?? null,
    };
  });
}

const MAX_CHANGELOG_BYTES = 512 * 1024;

/** A registry version's Markdown notes, parsed. Undefined when empty. */
export function readReleaseNotes(
  markdown: string | undefined,
): ReleaseNotes | undefined {
  if (!markdown) return undefined;
  const { summary, changes } = parseReleaseNotes(markdown);
  if (!summary && changes.length === 0) return undefined;
  return { ...(summary ? { summary } : {}), changes };
}

/**
 * The releases in an installed plugin's CHANGELOG.md, newest first. Empty when
 * the plugin ships none or it cannot be read.
 */
export async function getPluginChangelog(
  pluginId: string,
): Promise<ChangelogRelease[]> {
  const plugin = getPluginRuntime().loader.get(pluginId);
  if (!plugin) {
    throw new PluginManageError("Plugin not found", 404, "NOT_FOUND");
  }
  const file = path.join(plugin.dir, "CHANGELOG.md");
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > MAX_CHANGELOG_BYTES) return [];
    return parseChangelog(await fs.promises.readFile(file, "utf8")).changelog
      .releases;
  } catch {
    return [];
  }
}

async function directorySize(dir: string): Promise<number> {
  let total = 0;
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += await directorySize(full);
    else if (entry.isFile()) {
      total += (await fs.promises.stat(full).catch(() => null))?.size ?? 0;
    }
  }
  return total;
}

export interface PluginDataSummary {
  tables: Array<{ name: string; rows: number | null }>;
  kvKeys: number;
  settings: { admin: number; user: number; host: number; secret: number };
  migrations: Array<{ id: string; appliedAt: string | null }>;
  grants: Array<{
    capability: string;
    source: string;
    grantedAt: string | null;
  }>;
  filesBytes: number;
}

export async function getPluginDataSummary(
  pluginId: string,
): Promise<PluginDataSummary> {
  const {
    createCurrentPluginRepository,
    createCurrentPluginStorageRepository,
    createCurrentPluginSettingsRepository,
    createCurrentPluginMigrationRepository,
    createCurrentPluginPermissionGrantRepository,
  } = await repos();
  if (!(await createCurrentPluginRepository().findById(pluginId))) {
    throw new PluginManageError("Plugin not found", 404, "NOT_FOUND");
  }
  const { describePluginTables } = await import("./data.js");
  const knownPluginIds = getPluginRuntime()
    .loader.list()
    .map((plugin) => plugin.id);

  const [tables, kvKeys, settings, migrations, grants, filesBytes] =
    await Promise.all([
      describePluginTables(pluginId, { knownPluginIds }),
      createCurrentPluginStorageRepository().countKeys(pluginId),
      createCurrentPluginSettingsRepository().countByScope(pluginId),
      createCurrentPluginMigrationRepository().listByPlugin(pluginId),
      createCurrentPluginPermissionGrantRepository().listByPlugin(pluginId),
      directorySize(getPluginDataDir(pluginId)),
    ]);

  return {
    tables,
    kvKeys,
    settings,
    migrations: migrations.map((row) => ({
      id: row.migrationId,
      appliedAt: row.appliedAt ?? null,
    })),
    grants: grants.map((grant) => ({
      capability: grant.capability,
      source: grant.source,
      grantedAt: grant.grantedAt ?? null,
    })),
    filesBytes,
  };
}

/** Clears a plugin's data and leaves it installed but switched off. */
export function deletePluginData(
  pluginId: string,
  userId: string | null,
): Promise<{ tables: string[]; kvKeys: number; migrations: number }> {
  return serialized(async () => {
    const { loader } = getPluginRuntime();
    const live = loader.get(pluginId);
    if (live) {
      await recordState(pluginId, "disabled", null);
      await deactivatePlugin(pluginId);
    }
    const { removePluginData } = await import("./data.js");
    const removed = await removePluginData(pluginId, {
      knownPluginIds: loader.list().map((plugin) => plugin.id),
    });
    await fs.promises.rm(getPluginDataDir(pluginId), {
      recursive: true,
      force: true,
    });
    // Grants went with the data. A bundled plugin gets them straight back.
    if (live) {
      await registerLoadedPlugins([live]);
      await grantDeclared(live, userId);
    }
    return removed;
  });
}

export async function getDeveloperMode(): Promise<boolean> {
  const { createCurrentSettingsRepository } = await repos();
  return (
    (await createCurrentSettingsRepository().get(DEVELOPER_MODE_KEY)) === "true"
  );
}

export async function setDeveloperMode(enabled: boolean): Promise<boolean> {
  const { createCurrentSettingsRepository } = await repos();
  await createCurrentSettingsRepository().set(
    DEVELOPER_MODE_KEY,
    enabled ? "true" : "false",
  );
  if (!enabled) await clearUploads();
  return enabled;
}

/** 50 MB, the most nginx lets through to /plugins. */
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;
const UPLOAD_TTL_MS = 30 * 60_000;

interface StagedUpload {
  file: string;
  manifest: PluginManifest;
  expiresAt: number;
}

const uploads = new Map<string, StagedUpload>();

async function clearUploads(now = Infinity): Promise<void> {
  for (const [token, upload] of uploads) {
    if (upload.expiresAt > now) continue;
    uploads.delete(token);
    await fs.promises.rm(upload.file, { force: true });
  }
}

export interface UploadPreview {
  token: string;
  id: string;
  name: string;
  version: string;
  description: string;
  author: string;
  features: string[];
  capabilities: string[];
  /** The version of an earlier upload this one replaces. */
  replaces: string | null;
}

async function assertUploadsAllowed(): Promise<void> {
  if (!(await getDeveloperMode())) {
    throw new PluginManageError(
      "Installing from a file needs developer mode",
      403,
      "DEVELOPER_MODE_OFF",
    );
  }
  if (requireSignedPlugins()) {
    throw new PluginManageError(
      "TERMIX_REQUIRE_SIGNED_PLUGINS is on, so unsigned files cannot be installed",
      403,
      "SIGNED_ONLY",
    );
  }
}

function validateUpload(buffer: Buffer): PluginManifest {
  let raw: Record<string, unknown>;
  try {
    raw = readArtifactManifest(buffer);
  } catch (error) {
    throw new PluginManageError(
      error instanceof Error ? error.message : String(error),
      400,
      "INVALID_ARTIFACT",
    );
  }
  const { manifest, errors } = parseManifest(raw);
  if (!manifest) {
    throw new PluginManageError(
      `The manifest is not valid: ${errors.join("; ")}`,
      400,
      "INVALID_MANIFEST",
    );
  }
  if (!isApiCompatible(String(manifest.engine.api))) {
    throw new PluginManageError(
      `${manifest.id} ${manifest.version} does not run on this version of Termix`,
      409,
      "INCOMPATIBLE",
    );
  }
  return manifest;
}

/** Only another upload of the same id can be replaced from a file. */
async function assertReplaceable(pluginId: string): Promise<string | null> {
  const { loader } = getPluginRuntime();
  if (loader.bundledIds().has(pluginId)) {
    throw new PluginManageError(
      `${pluginId} ships with Termix and can only be replaced by a signed release`,
      409,
      "BUNDLED_ID",
    );
  }
  const { createCurrentPluginRepository } = await repos();
  const record = await createCurrentPluginRepository().findById(pluginId);
  if (!record) return null;
  if (record.tier !== UNVERIFIED_TIER) {
    throw new PluginManageError(
      "A plugin with this id is already installed from another source",
      409,
      "ALREADY_INSTALLED",
    );
  }
  return record.version;
}

/**
 * Checks an uploaded .tmxplug and holds it until the admin agrees to what
 * it asks for. Nothing is loaded yet.
 */
export async function stageUpload(buffer: Buffer): Promise<UploadPreview> {
  await assertUploadsAllowed();
  await clearUploads(Date.now());
  const manifest = validateUpload(buffer);
  const replaces = await assertReplaceable(manifest.id);

  const token = crypto.randomBytes(16).toString("hex");
  const dir = getDownloadsDir();
  await fs.promises.mkdir(dir, { recursive: true });
  const file = path.join(dir, `upload-${token}.tmxplug`);
  await fs.promises.writeFile(file, buffer);
  uploads.set(token, {
    file,
    manifest,
    expiresAt: Date.now() + UPLOAD_TTL_MS,
  });

  return {
    token,
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    description: manifest.description ?? "",
    author: manifest.author?.name ?? "",
    features: pluginFeatures(manifest.features),
    capabilities: [...manifest.capabilities],
    replaces,
  };
}

/** Installs a staged upload. It stays marked unverified for good. */
export function installUpload(
  token: string,
  options: { userId: string | null; capabilities?: string[] },
): Promise<{ id: string; version: string; state: string }> {
  return serialized(async () => {
    await assertUploadsAllowed();
    const upload = uploads.get(token);
    if (!upload || upload.expiresAt < Date.now()) {
      throw new PluginManageError(
        "The uploaded file has expired, upload it again",
        404,
        "UPLOAD_EXPIRED",
      );
    }
    const pluginId = upload.manifest.id;
    // Read again: the staged file is what gets loaded, not the first look.
    const manifest = validateUpload(await fs.promises.readFile(upload.file));
    if (manifest.id !== pluginId) {
      throw new PluginManageError(
        "The staged file changed",
        409,
        "UPLOAD_CHANGED",
      );
    }
    assertConsent(options.capabilities, manifest.capabilities);
    await assertReplaceable(pluginId);

    const { createCurrentPluginRepository } = await repos();
    const repository = createCurrentPluginRepository();
    const before = await repository.findById(pluginId);
    const wasEnabled = !before || before.state !== "disabled";

    uploads.delete(token);
    let plugin: LoadedPlugin;
    try {
      plugin = await swapIn(pluginId, { upload: upload.file });
    } catch (error) {
      await fs.promises.rm(upload.file, { force: true });
      const { loader } = getPluginRuntime();
      if (before && wasEnabled && loader.get(pluginId)) {
        await startAndRecord(pluginId);
      }
      throw new PluginManageError(
        error instanceof Error ? error.message : String(error),
        500,
        "INSTALL_FAILED",
      );
    }

    await repository.update(pluginId, {
      tier: UNVERIFIED_TIER,
      registryId: null,
      pinnedVersion: null,
      autoUpdate: false,
    });
    await grantDeclared(plugin, options.userId);

    if (!wasEnabled) {
      return { id: pluginId, version: manifest.version, state: "stopped" };
    }
    const { missing } = dependencyChain(pluginId);
    if (missing.length > 0) {
      await recordState(
        pluginId,
        "blocked",
        `requires ${missing.map((id) => `"${id}"`).join(", ")}, which is not installed`,
      );
      return { id: pluginId, version: manifest.version, state: "blocked" };
    }
    for (const id of (await planStateChange(pluginId, true)).enable) {
      await startAndRecord(id);
    }
    const state = await startAndRecord(pluginId);
    pluginLogger.warn(
      `Installed unverified plugin ${pluginId}@${manifest.version} from a file`,
      { operation: "plugin_install" },
    );
    return { id: pluginId, version: manifest.version, state };
  });
}

/**
 * Loads the copy in the bundled folder again after it was rebuilt, for the
 * dev runner. Running dependents stop first and start again after.
 */
export function reloadBundledPlugin(
  pluginId: string,
): Promise<{ id: string; version: string; state: string }> {
  return serialized(async () => {
    const { loader } = getPluginRuntime();
    const previous = loader.get(pluginId);
    if (previous && previous.source !== "bundled") {
      throw new PluginManageError(
        `${pluginId} is not loaded from the bundled folder`,
        409,
        "NOT_BUNDLED",
      );
    }
    const dependents = previous
      ? dependentChain(pluginId, await enabledIds()).filter(
          (id) => loader.get(id)?.state === "active",
        )
      : [];
    for (const id of dependents) await deactivatePlugin(id);
    await unloadPlugin(pluginId);

    const plugin = await loader.loadBundled(pluginId);
    await registerLoadedPlugins([plugin]);

    let state = "stopped";
    if ((await enabledIds()).has(pluginId)) {
      const { missing } = dependencyChain(pluginId);
      state = missing.length > 0 ? "blocked" : await startAndRecord(pluginId);
    }
    for (const id of [...dependents].reverse()) await startAndRecord(id);
    return { id: pluginId, version: plugin.manifest.version, state };
  });
}

/** Test seam. */
export function resetUploads(): void {
  uploads.clear();
}
