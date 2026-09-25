/**
 * Gives every feature with manifest-declared host settings its own host editor
 * tab, named after the feature. A plugin that registered its own host editor
 * section already edits its settings there, so it gets no generated tab.
 *
 * Re-run whenever the plugin list changes so tabs come and go without a reload.
 */

import { PluginIcon } from "@/lib/plugin-icon";
import {
  hostEditorSectionList,
  registerHostEditorSection,
  unregisterHostEditorSection,
} from "@/sidebar/HostManagerTabs";
import type { PluginSummary } from "@/api/plugins-api";
import {
  HostPluginSections,
  type HostPluginSettings,
} from "./HostPluginSections";
import { hasVisibleFields } from "./settings-fields-util";

const TAB_PREFIX = "feature:";

export function hostFeatureTabId(pluginId: string): string {
  return `${TAB_PREFIX}${pluginId}`;
}

interface HostFormLike {
  pluginSettings?: HostPluginSettings;
}

/** Adds, updates and removes generated tabs to match the plugin list. */
export function syncHostFeatureTabs(plugins: PluginSummary[]): string[] {
  const existing = hostEditorSectionList();
  const ownSections = new Set(
    existing
      .filter(
        (section) => section.pluginId && !section.id.startsWith(TAB_PREFIX),
      )
      .map((section) => section.pluginId),
  );

  const contributors = plugins.filter((plugin) => {
    if (!plugin.enabled || ownSections.has(plugin.id)) return false;
    const host = plugin.contributes?.settings?.host;
    return !!host && (hasVisibleFields(host.fields) || !!host.enableKey);
  });

  const wanted = new Set(
    contributors.map((plugin) => hostFeatureTabId(plugin.id)),
  );
  for (const section of existing) {
    if (section.id.startsWith(TAB_PREFIX) && !wanted.has(section.id)) {
      unregisterHostEditorSection(section.id);
    }
  }

  for (const plugin of contributors) {
    const host = plugin.contributes!.settings!.host!;
    const icon = plugin.icon;
    registerHostEditorSection({
      id: hostFeatureTabId(plugin.id),
      pluginId: plugin.id,
      group: host.editorGroup ?? "top",
      order: host.editorOrder ?? 100,
      labelKey: plugin.name,
      label: plugin.name,
      icon: icon
        ? ({ className }: { className?: string }) => (
            <PluginIcon name={icon} className={className} />
          )
        : undefined,
      component: ({ form, setField }) => (
        <HostPluginSections
          plugins={[plugin]}
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
  }

  return [...wanted];
}
