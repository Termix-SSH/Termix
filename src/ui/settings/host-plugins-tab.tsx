/**
 * Registers the host editor's "Plugins" tab.
 *
 * Goes through the host editor section registry rather than a case in the
 * editor, so the tab genuinely appears and disappears with the plugins that
 * fill it. Nothing is registered when no enabled plugin declares
 * host settings, which is what stops an empty tab from showing up.
 *
 * Re-run whenever the plugin list changes: enabling a plugin from the settings
 * screen has to put the tab there without a reload.
 */

import { Puzzle } from "lucide-react";
import {
  registerHostEditorSection,
  unregisterHostEditorSection,
} from "@/sidebar/HostManagerTabs";
import type { PluginSummary } from "@/api/plugins-api";
import {
  HostPluginSections,
  type HostPluginSettings,
} from "./HostPluginSections";

export const HOST_PLUGINS_TAB_ID = "plugins";

/** Only these two fields are read, so a test can pass a plain object. */
interface HostFormLike {
  pluginSettings?: HostPluginSettings;
}

/**
 * Adds or removes the tab to match the current plugin list.
 *
 * Returns whether the tab is now present, for a caller that needs to redirect
 * away from it when the last contributor goes.
 */
export function syncHostPluginsTab(plugins: PluginSummary[]): boolean {
  const contributors = plugins.filter((plugin) => {
    if (!plugin.enabled) return false;
    const host = plugin.contributes?.settings?.host;
    return !!host && (host.fields.length > 0 || !!host.enableKey);
  });

  if (contributors.length === 0) {
    unregisterHostEditorSection(HOST_PLUGINS_TAB_ID);
    return false;
  }

  registerHostEditorSection({
    id: HOST_PLUGINS_TAB_ID,
    // In the main strip, so hosts without SSH reach it too.
    group: "top",
    order: 100,
    labelKey: "settings.pluginsGroupLabel",
    icon: Puzzle,
    component: ({ form, setField }) => (
      <HostPluginSections
        plugins={contributors}
        values={(form as HostFormLike)?.pluginSettings ?? {}}
        setValue={(pluginId, key, value) => {
          const current = (form as HostFormLike)?.pluginSettings ?? {};
          setField("pluginSettings", {
            ...current,
            [pluginId]: { ...(current[pluginId] ?? {}), [key]: value },
          });
        }}
      />
    ),
  });

  return true;
}
