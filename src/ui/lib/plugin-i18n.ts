/**
 * Where a plugin's i18n keys resolve from.
 *
 * A manifest writes plugin-relative keys ("permissions.devices.view.title") so
 * it never has to know where the strings live. Today they live in core
 * en.json under `plugins.<pluginId>.`, because the frontend does not load
 * plugin locale bundles yet. When it does, that subtree moves into
 * plugins/<id>/locales/en.json as the plugin's own namespace and only this
 * function changes; no manifest is touched.
 */
export function pluginKey(pluginId: string, key: string): string {
  return `plugins.${pluginId}.${key}`;
}
