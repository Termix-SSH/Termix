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
import { declaredFields, resolveFieldValue } from "../../plugins/settings.js";
import { getPluginRuntime } from "../../plugins/index.js";
import { sshLogger } from "../../utils/logger.js";

export type HostPluginSettings = Record<string, Record<string, unknown>>;

/** Enabled plugins that declare host-scope settings, with their manifests. */
function hostSettingsPlugins(): PluginManifest[] {
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

/** Attaches the map to already-transformed host objects, in place. */
export function attachHostPluginSettings(
  hosts: Record<string, unknown>[],
  settings: Map<number, HostPluginSettings>,
): void {
  if (settings.size === 0) return;
  for (const host of hosts) {
    const hostId = Number(host.id);
    const values = settings.get(hostId);
    if (values) host.pluginSettings = values;
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
  return values ? { ...host, pluginSettings: values } : host;
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
