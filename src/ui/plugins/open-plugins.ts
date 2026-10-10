/** Asks the shell to open the Plugins tab. */
export const OPEN_PLUGINS_EVENT = "termix:open-plugins";

/** Asks the shell to open Settings at a plugin's page; detail is the plugin id. */
export const OPEN_PLUGIN_SETTINGS_EVENT = "termix:open-plugin-settings";

export function openPluginSettings(pluginId: string): void {
  window.dispatchEvent(
    new CustomEvent(OPEN_PLUGIN_SETTINGS_EVENT, { detail: pluginId }),
  );
}
