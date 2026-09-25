/**
 * The pluginSettings map attached to a host on its way out.
 *
 * Without this the host editor would need one request per plugin per host,
 * which is the shape that makes a list of a few hundred hosts slow. One query
 * covers the whole list instead.
 *
 * Kept out of transformHostResponse because that function is synchronous and
 * shared by every host read path. Secrets are always redacted here, so nothing
 * on this path has to decrypt and the async work stays in one place.
 */

import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import { createCurrentPluginSettingsRepository } from "../repositories/factory.js";
import type { PluginSettingsRecord } from "../repositories/plugin-settings-repository.js";
import {
  declaredFields,
  resolveFieldValue,
  setSetting,
} from "../../plugins/settings.js";
import { getPluginRuntime } from "../../plugins/index.js";
import { consume } from "../../plugins/registry.js";
import { sshLogger } from "../../utils/logger.js";

export type HostPluginSettings = Record<string, Record<string, unknown>>;

/**
 * Marks a host changed after one of its plugin settings did, so remote sync,
 * which pulls by updated_at, carries the new value across.
 */
export async function touchHost(hostId: number): Promise<void> {
  try {
    const { sql } = await import("drizzle-orm");
    const { runStatement } =
      await import("../../utils/crypto-migration/raw-rows.js");
    await runStatement(
      sql`UPDATE ssh_data SET updated_at = ${new Date().toISOString()} WHERE id = ${hostId}`,
    );
  } catch {
    // Only a sync hint; the setting itself is already saved.
  }
}

/** Enabled plugins that declare host-scope settings, with their manifests. */
export function hostSettingsPlugins(): PluginManifest[] {
  try {
    const { loader } = getPluginRuntime();
    return loader
      .list()
      .filter((plugin) => plugin.state === "active")
      .map((plugin) => plugin.manifest)
      .filter(
        (manifest): manifest is PluginManifest =>
          !!manifest && !!manifest.contributes?.settings?.host,
      );
  } catch {
    // The runtime is not up in every context that renders a host.
    return [];
  }
}

/**
 * Builds the map for a set of hosts in one query.
 *
 * Returns an empty map when no enabled plugin declares host settings, so the
 * common case costs nothing.
 */
export async function loadHostPluginSettings(
  hostIds: number[],
): Promise<Map<number, HostPluginSettings>> {
  const result = new Map<number, HostPluginSettings>();
  const manifests = hostSettingsPlugins();
  if (manifests.length === 0 || hostIds.length === 0) return result;

  let rows: PluginSettingsRecord[] = [];
  try {
    rows = await createCurrentPluginSettingsRepository().getAllForScopeIds(
      "host",
      hostIds.map(String),
    );
  } catch (error) {
    // A host list must not fail because a settings read did.
    sshLogger.warn("Failed to load host plugin settings", {
      operation: "host_plugin_settings",
      error: error instanceof Error ? error.message : String(error),
    });
    return result;
  }

  const byHostAndPlugin = new Map<string, PluginSettingsRecord[]>();
  for (const row of rows) {
    const key = `${row.scopeId}:${row.pluginId}`;
    const list = byHostAndPlugin.get(key);
    if (list) list.push(row);
    else byHostAndPlugin.set(key, [row]);
  }

  for (const hostId of hostIds) {
    const perPlugin: HostPluginSettings = {};

    for (const manifest of manifests) {
      const fields = declaredFields(manifest, "host");
      if (fields.length === 0) continue;

      const stored = new Map(
        (byHostAndPlugin.get(`${hostId}:${manifest.id}`) ?? []).map((row) => [
          row.key,
          row,
        ]),
      );

      const values: Record<string, unknown> = {};
      for (const field of fields) {
        values[field.key] = await resolveFieldValue(
          field,
          stored.get(field.key),
          { redactSecrets: true },
        );
      }
      perPlugin[manifest.id] = values;
    }

    if (Object.keys(perPlugin).length > 0) result.set(hostId, perPlugin);
  }

  return result;
}

const SHARE_LEVELS = ["connect", "view", "edit", "manage"];

/**
 * Drops the fields a shared host's recipient may not read: a field declares
 * the lowest share level that sees it with shareRead. The owner sees all.
 */
function visibleHostPluginSettings(
  values: HostPluginSettings,
  host: Record<string, unknown>,
): HostPluginSettings {
  if (!host.isShared) return values;
  const level = SHARE_LEVELS.indexOf(
    typeof host.permissionLevel === "string" ? host.permissionLevel : "connect",
  );
  const result: HostPluginSettings = {};
  for (const manifest of hostSettingsPlugins()) {
    const own = values[manifest.id];
    if (!own) continue;
    const copy = { ...own };
    for (const field of declaredFields(manifest, "host")) {
      if (
        field.shareRead &&
        SHARE_LEVELS.indexOf(field.shareRead) > Math.max(level, 0)
      ) {
        delete copy[field.key];
      }
    }
    result[manifest.id] = copy;
  }
  return result;
}

/**
 * Fields a plugin still puts on the host payload in their pre-2.9 shape, for
 * clients outside Termix (Termix-Mobile) that have not moved to
 * pluginSettings yet. Registered as ctx.registry.provide(
 * "<id>.hostPayloadLegacy", fn); the function gets the plugin's own host
 * values and the host, and never overwrites a field core already set.
 */
export type PluginHostPayloadLegacy = (
  values: Record<string, unknown>,
  host: Record<string, unknown>,
) => Record<string, unknown> | null;

function applyLegacyFields(
  host: Record<string, unknown>,
  values: HostPluginSettings,
): void {
  for (const manifest of hostSettingsPlugins()) {
    const own = values[manifest.id];
    if (!own) continue;
    const legacy = consume<PluginHostPayloadLegacy>(
      `${manifest.id}.hostPayloadLegacy`,
    );
    if (!legacy) continue;
    try {
      for (const [key, value] of Object.entries(legacy(own, host) ?? {})) {
        if (!(key in host)) host[key] = value;
      }
    } catch {
      // A plugin's compat shape must never break a host read.
    }
  }
}

/** Attaches the map to already-transformed host objects, in place. */
export function attachHostPluginSettings(
  hosts: Record<string, unknown>[],
  settings: Map<number, HostPluginSettings>,
): void {
  if (settings.size === 0) return;
  for (const host of hosts) {
    const hostId = Number(host.id);
    const values = settings.get(hostId);
    if (!values) continue;
    host.pluginSettings = visibleHostPluginSettings(values, host);
    applyLegacyFields(host, host.pluginSettings as HostPluginSettings);
  }
}

/** The single-host convenience wrapper. */
export async function withHostPluginSettings(
  host: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const hostId = Number(host.id);
  if (!Number.isInteger(hostId)) return host;

  const settings = await loadHostPluginSettings([hostId]);
  const values = settings.get(hostId);
  if (!values) return host;
  const result: Record<string, unknown> = {
    ...host,
    pluginSettings: visibleHostPluginSettings(values, host),
  };
  applyLegacyFields(result, result.pluginSettings as HostPluginSettings);
  return result;
}

/**
 * Writes a set of host-scope plugin settings in one call, for a core route
 * that still accepts a plugin's fields inline on the host create/update body
 * (the fields haven't grown their own editor UI flow yet). Values are
 * JSON-stringified the same way ctx.settings.setHost stores them.
 */
export async function writeHostPluginSettings(
  pluginId: string,
  hostId: number,
  values: Record<string, unknown>,
): Promise<void> {
  const repository = createCurrentPluginSettingsRepository();
  const scopeId = String(hostId);
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) continue;
    await repository.set(pluginId, "host", scopeId, key, JSON.stringify(value));
  }
}

/**
 * A plugin's own validator for the fields it accepts inline on a bulk host
 * import row (host-bulk-routes.ts's Termix-JSON import path). Registered
 * through ctx.registry.provide("<pluginId>.hostImportNormalizer", fn) - not
 * part of the SDK's typed ctx surface, because only this one bulk-import
 * path calls it and a full contract is speculative until a second caller
 * needs it. Returns the fields to write (JSON-serializable, matching
 * writeHostPluginSettings's input), or null to write nothing for this row.
 */
export type PluginHostImportNormalizer = (
  raw: Record<string, unknown>,
) => Record<string, unknown> | null;

/**
 * Runs every enabled plugin's registered import normalizer over one imported
 * host row and writes whatever each one returns, so a plugin's host-scope
 * settings are validated the same way on bulk import as they are anywhere
 * else - instead of host-bulk-routes.ts hardcoding one plugin's shape.
 *
 * Best-effort per plugin: one plugin's normalizer throwing must not fail the
 * whole import, so it is logged and skipped rather than propagated.
 */
export async function applyPluginHostImportSettings(
  hostId: number,
  raw: Record<string, unknown>,
): Promise<void> {
  const exported =
    raw.pluginSettings && typeof raw.pluginSettings === "object"
      ? (raw.pluginSettings as HostPluginSettings)
      : {};

  for (const manifest of hostSettingsPlugins()) {
    try {
      // What an export carried for this plugin, validated like any other
      // write. Secrets never leave the server, so there are none to restore.
      const carried = exported[manifest.id];
      if (carried && typeof carried === "object") {
        for (const field of declaredFields(manifest, "host")) {
          if (field.type === "secret" || !(field.key in carried)) continue;
          await setSetting(
            manifest,
            "host",
            hostId,
            field.key,
            carried[field.key],
          );
        }
      }

      const normalizer = consume<PluginHostImportNormalizer>(
        `${manifest.id}.hostImportNormalizer`,
      );
      const values = normalizer?.(raw);
      if (values) await writeHostPluginSettings(manifest.id, hostId, values);
    } catch (error) {
      sshLogger.warn("Plugin host import normalizer failed", {
        operation: "host_import_plugin_settings",
        pluginId: manifest.id,
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Turns one plugin's host switch on or off for a set of hosts. Returns false
 * when the plugin is not running or declares no enableKey.
 */
export async function setHostPluginEnabled(
  pluginId: string,
  hostIds: number[],
  enabled: boolean,
): Promise<boolean> {
  const manifest = hostSettingsPlugins().find((m) => m.id === pluginId);
  const enableKey = manifest?.contributes?.settings?.host?.enableKey;
  if (!manifest || !enableKey) return false;
  for (const hostId of hostIds) {
    await setSetting(manifest, "host", hostId, enableKey, enabled);
    await touchHost(hostId);
  }
  return true;
}
