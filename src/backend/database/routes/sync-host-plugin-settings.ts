/**
 * Host plugin settings over remote sync. A host row travels with a
 * pluginSettings map of its non-secret values; a plugin whose value refers to
 * one of its own rows by local id translates it with a registered
 * ctx.registry.provide("<id>.hostSettingsSync", { exportValue, importValue }).
 */

import { consume } from "../../plugins/registry.js";
import {
  declaredFields,
  getAllSettings,
  setSetting,
} from "../../plugins/settings.js";
import { databaseLogger } from "../../utils/logger.js";
import {
  hostSettingsPlugins,
  type HostPluginSettings,
} from "./host-plugin-settings.js";

export interface PluginHostSettingsSync {
  exportValue?: (key: string, value: unknown) => unknown | Promise<unknown>;
  importValue?: (key: string, value: unknown) => unknown | Promise<unknown>;
}

/** What a host carries to the other side of a sync pair. */
export async function exportHostPluginSettings(
  hostId: number,
): Promise<HostPluginSettings> {
  const result: HostPluginSettings = {};
  for (const manifest of hostSettingsPlugins()) {
    const fields = declaredFields(manifest, "host").filter(
      (field) => field.type !== "secret",
    );
    if (fields.length === 0) continue;
    const values = await getAllSettings(manifest, "host", hostId, {
      redactSecrets: true,
    });
    const hook = consume<PluginHostSettingsSync>(
      `${manifest.id}.hostSettingsSync`,
    );
    const own: Record<string, unknown> = {};
    for (const field of fields) {
      const value = values[field.key];
      own[field.key] = hook?.exportValue
        ? await hook.exportValue(field.key, value)
        : value;
    }
    result[manifest.id] = own;
  }
  return result;
}

/** Writes what a synced host carried, translated back to local ids. */
export async function importHostPluginSettings(
  hostId: number,
  carried: unknown,
): Promise<void> {
  if (!carried || typeof carried !== "object") return;
  const byPlugin = carried as HostPluginSettings;
  for (const manifest of hostSettingsPlugins()) {
    const own = byPlugin[manifest.id];
    if (!own || typeof own !== "object") continue;
    const hook = consume<PluginHostSettingsSync>(
      `${manifest.id}.hostSettingsSync`,
    );
    for (const field of declaredFields(manifest, "host")) {
      if (field.type === "secret" || !(field.key in own)) continue;
      try {
        const value = hook?.importValue
          ? await hook.importValue(field.key, own[field.key])
          : own[field.key];
        await setSetting(manifest, "host", hostId, field.key, value);
      } catch (error) {
        databaseLogger.warn("Could not apply a synced host plugin setting", {
          operation: "sync_host_plugin_settings",
          pluginId: manifest.id,
          hostId,
          key: field.key,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}
