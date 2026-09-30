/**
 * Writes resolved defaults into the hosts that follow them.
 *
 * A host keeps its effective values in its own columns and plugin setting
 * rows, so every reader (connect, export, sync, a 2.8 downgrade) sees plain
 * values. What changes when a default does is this pass: every host that
 * inherits the key gets the new value written, and nothing else is touched.
 *
 * A namespace a host has never been classified for (a host from before host
 * defaults, from an older sync peer, or a plugin enabled later) is classified
 * first: a value equal to what resolves inherits, anything else is the
 * host's own.
 */

import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  createCurrentHostDefaultsRepository,
  createCurrentPluginSettingsRepository,
} from "../../database/repositories/factory.js";
import type { HostRow } from "../../database/repositories/host-defaults-repository.js";
import type { PluginSettingsRecord } from "../../database/repositories/plugin-settings-repository.js";
import {
  CORE_NAMESPACE,
  defaultValuesEqual,
  parseDefaultOverrides,
  type DefaultOverrides,
  type HostDefaultsLevel,
  type ResolvedHostDefault,
} from "../../../types/host-defaults.js";
import { hostSettingsPlugins } from "../../database/routes/host-plugin-settings.js";
import { notifySettingChange } from "../../plugins/settings.js";
import { databaseLogger } from "../../utils/logger.js";
import {
  buildCatalog,
  catalogNamespaces,
  type DefaultKeyInfo,
  type DefaultsCatalog,
} from "./catalog.js";
import { readCoreDefault, writeCoreDefault } from "./core-columns.js";
import {
  loadDefaultsIndex,
  levelsForHost,
  type DefaultsIndex,
} from "./levels.js";
import {
  effectiveFolderPath,
  isOwnValue,
  resolveKey,
  withoutSelfJump,
  type HostLevels,
  type HostPlacement,
} from "./resolve.js";

export interface HostDefaultsTarget {
  hostIds?: number[];
  userIds?: string[];
  all?: boolean;
}

/** A level change that has not been saved yet, for a preview. */
export interface LevelOverlay {
  level: HostDefaultsLevel;
  userId?: string;
  folderId?: number;
  set: Map<string, unknown>;
  unset: Set<string>;
}

export interface MaterializeOptions {
  /** Only these keys are rewritten. Classification still covers every key. */
  keys?: Set<string>;
  dryRun?: boolean;
  overlay?: LevelOverlay;
}

export interface MaterializeResult {
  changedHostIds: number[];
}

export interface PluginWrite {
  hostId: number;
  pluginId: string;
  key: string;
  /** undefined deletes the row, so the host reads the manifest default. */
  value: unknown;
}

export interface HostPlan {
  columns: Record<string, unknown>;
  pluginWrites: PluginWrite[];
  overrides: DefaultOverrides;
  overridesChanged: boolean;
  coreKeysChanged: string[];
}

type PluginRows = Map<string, Map<string, PluginSettingsRecord>>;

function decode(raw: string | null | undefined): unknown {
  if (raw === null || raw === undefined) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function currentPluginValue(
  info: DefaultKeyInfo,
  rows: PluginRows | undefined,
): unknown {
  const row = rows?.get(info.namespace)?.get(info.key);
  return info.normalize(row ? decode(row.value) : undefined);
}

export function applyOverlay(
  index: DefaultsIndex,
  overlay: LevelOverlay | undefined,
): DefaultsIndex {
  if (!overlay) return index;
  const patch = (values: Map<string, unknown>) => {
    const next = new Map(values);
    for (const key of overlay.unset) next.delete(key);
    for (const [key, value] of overlay.set) next.set(key, value);
    return next;
  };
  if (overlay.level === "admin") {
    return { ...index, admin: patch(index.admin) };
  }
  if (overlay.level === "user" && overlay.userId) {
    const users = new Map(index.users);
    users.set(overlay.userId, patch(users.get(overlay.userId) ?? new Map()));
    return { ...index, users };
  }
  if (overlay.level === "folder" && overlay.folderId !== undefined) {
    const folders = new Map(index.folders);
    for (const [userId, byPath] of folders) {
      for (const [path, folder] of byPath) {
        if (folder.folderId !== overlay.folderId) continue;
        const copy = new Map(byPath);
        copy.set(path, { ...folder, values: patch(folder.values) });
        folders.set(userId, copy);
      }
    }
    return { ...index, folders };
  }
  return index;
}

/** What one key resolves to for one host, with the jump-host guard applied. */
export function resolveForHost(
  info: DefaultKeyInfo,
  levels: HostLevels,
  hostId: number | null,
): ResolvedHostDefault | undefined {
  const resolved = resolveKey(info, levels);
  if (!resolved || hostId === null || info.fullKey !== "core.jumpHosts") {
    return resolved;
  }
  return { ...resolved, value: withoutSelfJump(resolved.value, hostId) };
}

/**
 * Plans one host: which namespaces get classified, and what each inheriting
 * key has to be rewritten to. Pure, apart from the catalog it is handed.
 */
export function planHost(
  row: HostRow,
  levels: HostLevels,
  catalog: DefaultsCatalog,
  pluginRows: PluginRows | undefined,
  options: { keys?: Set<string> } = {},
): HostPlan {
  const stored = parseDefaultOverrides(row.defaultOverrides);
  const overrides: DefaultOverrides = { ...(stored ?? {}) };
  let overridesChanged = stored === null;

  const byNamespace = new Map<string, DefaultKeyInfo[]>();
  for (const info of catalog.values()) {
    const list = byNamespace.get(info.namespace);
    if (list) list.push(info);
    else byNamespace.set(info.namespace, [info]);
  }

  const current = (info: DefaultKeyInfo) =>
    info.namespace === CORE_NAMESPACE
      ? readCoreDefault(info.key, row as unknown as Record<string, unknown>)
      : currentPluginValue(info, pluginRows);

  for (const namespace of catalogNamespaces(catalog)) {
    if (overrides[namespace]) continue;
    overrides[namespace] = (byNamespace.get(namespace) ?? [])
      .filter((info) =>
        isOwnValue(info, current(info), resolveForHost(info, levels, row.id)),
      )
      .map((info) => info.key)
      .sort();
    overridesChanged = true;
  }

  let columns: Record<string, unknown> = {};
  const pluginWrites: PluginWrite[] = [];
  const coreKeysChanged: string[] = [];

  for (const info of catalog.values()) {
    if (options.keys && !options.keys.has(info.fullKey)) continue;
    if (overrides[info.namespace]?.includes(info.key)) continue;
    const resolved = resolveForHost(info, levels, row.id);
    if (!resolved) continue;
    const desired = info.normalize(resolved.value);
    if (defaultValuesEqual(current(info), desired)) continue;

    if (info.namespace === CORE_NAMESPACE) {
      const base = { ...row, ...columns } as Record<string, unknown>;
      columns = { ...columns, ...writeCoreDefault(info.key, desired, base) };
      coreKeysChanged.push(info.key);
    } else {
      const manifestDefault = info.normalize(undefined);
      pluginWrites.push({
        hostId: row.id,
        pluginId: info.namespace,
        key: info.key,
        value: defaultValuesEqual(desired, manifestDefault)
          ? undefined
          : desired,
      });
    }
  }

  if (overridesChanged) columns.defaultOverrides = JSON.stringify(overrides);
  return {
    columns,
    pluginWrites,
    overrides,
    overridesChanged,
    coreKeysChanged,
  };
}

/** The running plugins' manifests, and the catalog they make with core's. */
export function currentCatalog(): {
  manifests: PluginManifest[];
  catalog: DefaultsCatalog;
} {
  const manifests = hostSettingsPlugins();
  return { manifests, catalog: buildCatalog(manifests) };
}

export async function loadPluginRows(
  hostIds: number[],
): Promise<Map<number, PluginRows>> {
  const result = new Map<number, PluginRows>();
  const repository = createCurrentPluginSettingsRepository();
  for (let i = 0; i < hostIds.length; i += 500) {
    const part = hostIds.slice(i, i + 500).map(String);
    for (const row of await repository.getAllForScopeIds("host", part)) {
      const hostId = Number(row.scopeId);
      let byPlugin = result.get(hostId);
      if (!byPlugin) {
        byPlugin = new Map();
        result.set(hostId, byPlugin);
      }
      let byKey = byPlugin.get(row.pluginId);
      if (!byKey) {
        byKey = new Map();
        byPlugin.set(row.pluginId, byKey);
      }
      byKey.set(row.key, row);
    }
  }
  return result;
}

export async function loadPlacement(
  userIds: string[],
): Promise<Map<number, HostPlacement>> {
  const rows =
    await createCurrentHostDefaultsRepository().listHostPlacement(userIds);
  return new Map(
    rows.map((row) => [
      row.id,
      { folder: row.folder, parentHostId: row.parentHostId },
    ]),
  );
}

/** Runs the side effects every changed host needs, after its write. */
async function afterHostsChanged(
  changed: Array<{ row: HostRow; plan: HostPlan }>,
): Promise<void> {
  if (changed.length === 0) return;
  try {
    const { markChanged } = await import("../../sync/server/feed.js");
    markChanged();
  } catch {
    // Sync is not loaded in every context.
  }

  const { pluginEvents, TOPICS } = await import("../../plugins/events.js");
  const notified = new Map<string, unknown>();
  let secrets: {
    resyncHost: (hostId: number) => Promise<unknown>;
  } | null = null;
  for (const { row, plan } of changed) {
    try {
      pluginEvents.emit(TOPICS.hostUpdated, {
        hostId: row.id,
        userId: row.userId,
      });
    } catch {
      // A subscriber must not fail the write that already happened.
    }
    for (const write of plan.pluginWrites) {
      notified.set(`${write.pluginId}\u0000${write.key}`, write.value);
    }
    if (
      plan.coreKeysChanged.includes("auth") ||
      plan.coreKeysChanged.includes("username")
    ) {
      try {
        if (!secrets) {
          const { SharedHostSecretsManager } =
            await import("../../utils/shared-host-secrets-manager.js");
          secrets = SharedHostSecretsManager.getInstance();
        }
        await secrets.resyncHost(row.id);
      } catch (error) {
        databaseLogger.warn("Failed to resync shared host after defaults", {
          operation: "host_defaults_resync",
          hostId: row.id,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  for (const [pair, value] of notified) {
    const [pluginId, key] = pair.split("\u0000");
    notifySettingChange(pluginId, key, value);
  }
}

/**
 * Classifies and rewrites a set of hosts. Returns the hosts whose values or
 * overrides changed; with `dryRun` nothing is written.
 */
export async function materializeHosts(
  target: HostDefaultsTarget,
  options: MaterializeOptions = {},
): Promise<MaterializeResult> {
  const repository = createCurrentHostDefaultsRepository();
  const rows = (await repository.listHosts(target)).filter(
    // A desktop's read-only copy of a shared host follows its owner's server.
    (row) => !row.sharedSource,
  );
  if (rows.length === 0) return { changedHostIds: [] };

  const { catalog } = currentCatalog();
  const userIds = [...new Set(rows.map((row) => row.userId))];
  const [index, placement, pluginRows] = await Promise.all([
    loadDefaultsIndex(userIds),
    loadPlacement(userIds),
    loadPluginRows(rows.map((row) => row.id)),
  ]);
  const withOverlay = applyOverlay(index, options.overlay);

  const changed: Array<{ row: HostRow; plan: HostPlan }> = [];
  for (const row of rows) {
    const levels = levelsForHost(
      withOverlay,
      row.userId,
      effectiveFolderPath(row.id, placement),
    );
    const plan = planHost(row, levels, catalog, pluginRows.get(row.id), {
      keys: options.keys,
    });
    const valuesChanged =
      Object.keys(plan.columns).some((key) => key !== "defaultOverrides") ||
      plan.pluginWrites.length > 0;
    if (options.dryRun) {
      if (valuesChanged) changed.push({ row, plan });
      continue;
    }
    if (valuesChanged || plan.overridesChanged) changed.push({ row, plan });
  }

  if (options.dryRun) {
    return { changedHostIds: changed.map(({ row }) => row.id) };
  }

  await repository.updateHosts(
    changed.map(({ row, plan }) => ({
      id: row.id,
      values: plan.columns as Partial<HostRow>,
    })),
  );
  const settings = createCurrentPluginSettingsRepository();
  for (const { plan } of changed) {
    for (const write of plan.pluginWrites) {
      if (write.value === undefined) {
        await settings.delete(
          write.pluginId,
          "host",
          String(write.hostId),
          write.key,
        );
      } else {
        await settings.set(
          write.pluginId,
          "host",
          String(write.hostId),
          write.key,
          JSON.stringify(write.value),
        );
      }
    }
  }

  const valueChanges = changed.filter(
    ({ plan }) =>
      plan.pluginWrites.length > 0 ||
      Object.keys(plan.columns).some((key) => key !== "defaultOverrides"),
  );
  await afterHostsChanged(valueChanges);
  return { changedHostIds: valueChanges.map(({ row }) => row.id) };
}
