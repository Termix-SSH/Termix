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
