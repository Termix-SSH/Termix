import type { TFunction } from "i18next";

/**
 * Where a plugin's i18n keys resolve from.
 *
 * A manifest writes plugin-relative keys ("permissions.devices.view.title") so
 * it never has to know where the strings live. They live in the plugin's own
 * locales/en.json, loaded into an i18next namespace named after the plugin,
 * so the qualified key is "<pluginId>:<key>". A key that already names a
 * namespace is left alone. Missing keys fall back to core strings.
 */
export function pluginKey(pluginId: string, key: string): string;
export function pluginKey(
  pluginId: string,
  key: string | undefined,
): string | undefined;
export function pluginKey(
  pluginId: string,
  key: string | undefined,
): string | undefined {
  if (!key) return key;
  return key.includes(":") ? key : `${pluginId}:${key}`;
}

/**
 * A plugin's name in the UI language: "plugin.name" from its own locales,
 * else the manifest's. A plugin whose strings are not loaded, like one only
 * listed in a registry, shows the manifest name.
 */
export function pluginName(
  t: TFunction,
  plugin: { id: string; name: string },
): string {
  return t(pluginKey(plugin.id, "plugin.name"), { defaultValue: plugin.name });
}

/** Same as pluginName, for "plugin.description". */
export function pluginDescription(
  t: TFunction,
  plugin: { id: string; description?: string | null },
): string {
  return t(pluginKey(plugin.id, "plugin.description"), {
    defaultValue: plugin.description ?? "",
  });
}
