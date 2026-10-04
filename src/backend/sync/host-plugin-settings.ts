/**
 * Host plugin settings over sync. A host row travels with a
 * pluginSettings map of its non-secret values; a plugin whose value refers to
 * one of its own rows by local id translates it with a registered
 * ctx.registry.provide("<id>.hostSettingsSync", { exportValue, importValue }).
 */

import { consume } from "../plugins/registry.js";
import {
  declaredFields,
  getAllSettings,
  setSetting,
} from "../plugins/settings.js";
import { databaseLogger } from "../utils/logger.js";
import type { DefaultOverrides } from "../../types/host-defaults.js";
import {
  hostSettingsPlugins,
  withHostPluginSettings,
  type HostPluginSettings,
} from "../database/routes/host-plugin-settings.js";

export interface PluginHostSettingsSync {
  exportValue?: (key: string, value: unknown) => unknown | Promise<unknown>;
  importValue?: (key: string, value: unknown) => unknown | Promise<unknown>;
}

/** Who a shared host's copy is for, and at what share level. */
export interface SharedHostViewer {
  userId: string;
  permissionLevel: string;
}

/**
 * What a host carries to the other side of a sync pair. With a viewer, only
 * what that user sees of a host shared with them, as the host routes show it.
 */
export async function exportHostPluginSettings(
  hostId: number,
  viewer?: SharedHostViewer,
): Promise<HostPluginSettings> {
  const visible = viewer
    ? (((
        await withHostPluginSettings(
          {
            id: hostId,
            isShared: true,
            permissionLevel: viewer.permissionLevel,
          },
          viewer.userId,
        )
      ).pluginSettings as HostPluginSettings | undefined) ?? {})
    : null;
  const result: HostPluginSettings = {};
  for (const manifest of hostSettingsPlugins()) {
    const fields = declaredFields(manifest, "host").filter(
      (field) =>
        field.type !== "secret" &&
        (!visible || field.key in (visible[manifest.id] ?? {})),
    );
    if (fields.length === 0) continue;
    const values = visible
      ? visible[manifest.id]
      : await getAllSettings(manifest, "host", hostId, {
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

/**
 * Writes what a synced host carried, translated back to local ids. With
 * `only`, a classified namespace takes just the keys the host sets itself;
 * the rest follow this side's defaults and are written by the materialize
 * pass that follows.
 */
export async function importHostPluginSettings(
  hostId: number,
  carried: unknown,
  only?: DefaultOverrides | null,
): Promise<void> {
  if (!carried || typeof carried !== "object") return;
  const byPlugin = carried as HostPluginSettings;
  for (const manifest of hostSettingsPlugins()) {
    const own = byPlugin[manifest.id];
    if (!own || typeof own !== "object") continue;
    const hook = consume<PluginHostSettingsSync>(
      `${manifest.id}.hostSettingsSync`,
    );
    const ownKeys = only?.[manifest.id];
    for (const field of declaredFields(manifest, "host")) {
      if (field.type === "secret" || !(field.key in own)) continue;
      if (ownKeys && !ownKeys.includes(field.key)) continue;
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
