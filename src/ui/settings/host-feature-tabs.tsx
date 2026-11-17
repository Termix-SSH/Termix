/**
 * Gives every feature with manifest-declared host settings its own host editor
 * tab, named after the feature. A plugin that registered its own host editor
 * section already edits its settings there, so it gets no generated tab.
 *
 * Re-run whenever the plugin list changes so tabs come and go without a reload.
 */

import { PluginIcon } from "@/lib/plugin-icon";
import { pluginKey } from "@/lib/plugin-i18n";
import {
  getHostEditorSection,
  hostEditorSectionList,
  registerHostEditorSection,
  subscribeHostEditorSections,
  unregisterHostEditorSection,
  type HostEditorSectionDef,
} from "@/sidebar/HostManagerTabs";
import type { PluginSettingsField, PluginSummary } from "@/api/plugins-api";
import {
  HostPluginSections,
  type HostPluginSettings,
} from "./HostPluginSections";
import { hasVisibleFields } from "./settings-fields-util";
import { isDefaultableField } from "@/sidebar/host-defaults/catalog";

const TAB_PREFIX = "feature:";

export function hostFeatureTabId(pluginId: string): string {
  return `${TAB_PREFIX}${pluginId}`;
}

interface HostFormLike {
  pluginSettings?: HostPluginSettings;
}

function hasDefaultableFields(host: {
  enableKey?: string;
  fields: PluginSettingsField[];
}): boolean {
  return (
    !!host.enableKey ||
    host.fields.some((field) => !field.hidden && isDefaultableField(field))
  );
}

function registeredOwnSections(): HostEditorSectionDef[] {
  return hostEditorSectionList().filter(
    (section) => section.pluginId && !section.id.startsWith(TAB_PREFIX),
  );
}

function ownKey(own: HostEditorSectionDef[]): string {
  return JSON.stringify(
    own.map((s) => [s.id, s.pluginId, s.group, s.order, s.defaults]),
  );
}

let lastPlugins: PluginSummary[] | null = null;
let lastOwnKey = "";
const tabKeys = new Map<string, string>();
let unwatch: (() => void) | null = null;

// Framed plugins register their sections after the plugin list is synced,
// so look again when a plugin's own sections change.
function watchOwnSections(): void {
  if (unwatch) return;
  unwatch = subscribeHostEditorSections(() => {
    if (!lastPlugins || ownKey(registeredOwnSections()) === lastOwnKey) return;
    syncHostFeatureTabs(lastPlugins);
  });
}

/** Stops following section changes. For tests. */
export function resetHostFeatureTabs(): void {
  unwatch?.();
  unwatch = null;
  lastPlugins = null;
  lastOwnKey = "";
  tabKeys.clear();
}

/** Adds, updates and removes generated tabs to match the plugin list. */
export function syncHostFeatureTabs(plugins: PluginSummary[]): string[] {
  const existing = hostEditorSectionList();
  const own = registeredOwnSections();
  lastPlugins = plugins;
  lastOwnKey = ownKey(own);
  watchOwnSections();
  const ownSections = new Set(own.map((section) => section.pluginId));
  // The defaults tab sits where the plugin's own section does on a host.
  const ownPlacement = new Map<
    string,
    { group: "top" | "ssh"; order?: number }
  >();
  for (const section of own) {
    if (!ownPlacement.has(section.pluginId!)) {
      ownPlacement.set(section.pluginId!, {
        group: section.group,
        order: section.order,
      });
    }
  }
  // A plugin whose own sections are all about one host still gets its
  // switches in the defaults editor, through a generated tab shown only there.
  const ownDefaultsSections = new Set(
    own
      .filter((section) => section.defaults)
      .map((section) => section.pluginId),
  );

  const contributors = plugins.filter((plugin) => {
    if (!plugin.enabled || ownDefaultsSections.has(plugin.id)) return false;
    const host = plugin.contributes?.settings?.host;
    if (!host) return false;
    // Its own section edits it per host, so only a default is left to offer.
    if (ownSections.has(plugin.id)) return hasDefaultableFields(host);
    return hasVisibleFields(host.fields) || !!host.enableKey;
  });

  const wanted = new Set(
    contributors.map((plugin) => hostFeatureTabId(plugin.id)),
  );
  for (const section of existing) {
    if (section.id.startsWith(TAB_PREFIX) && !wanted.has(section.id)) {
      tabKeys.delete(section.id);
      unregisterHostEditorSection(section.id);
    }
  }

  for (const plugin of contributors) {
    const host = plugin.contributes!.settings!.host!;
    const icon = plugin.icon;
    const placement = ownPlacement.get(plugin.id);
    const id = hostFeatureTabId(plugin.id);
    // Registering again remounts the tab, so skip one that has not changed.
    const key = JSON.stringify([
      plugin.name,
      icon,
      host,
      placement,
      ownSections.has(plugin.id),
    ]);
    if (tabKeys.get(id) === key && getHostEditorSection(id)) continue;
    tabKeys.set(id, key);
    registerHostEditorSection({
      id,
      pluginId: plugin.id,
      group: placement?.group ?? host.editorGroup ?? "top",
      order: placement?.order ?? host.editorOrder ?? 100,
      labelKey: pluginKey(plugin.id, "plugin.name"),
      label: plugin.name,
      // Nothing but the plugin's host settings, so it works for defaults too.
      defaults: ownSections.has(plugin.id) ? "only" : true,
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
