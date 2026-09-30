/**
 * The keys the host editor can show a default for: core's own, and every
 * running plugin's host fields that can have one.
 */

import { useEffect, useMemo, useState } from "react";
import {
  CORE_HOST_DEFAULTS,
  CORE_NAMESPACE,
  HOST_DEFAULTS_LEVELS,
  type HostDefaultsLevel,
} from "@/types/host-defaults";
import {
  getPlugins,
  type PluginSettingsField,
  type PluginSummary,
} from "@/api/plugins-api";

export interface EditorDefaultKey {
  fullKey: string;
  namespace: string;
  key: string;
  levels: readonly HostDefaultsLevel[];
}

export function isDefaultableField(field: PluginSettingsField): boolean {
  if (field.type === "secret") return false;
  if (field.type === "json" && field.secretKeys?.length) return false;
  return field.defaultable !== false;
}

export function pluginDefaultKeys(
  plugins: PluginSummary[],
): EditorDefaultKey[] {
  const keys: EditorDefaultKey[] = [];
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    const host = plugin.contributes?.settings?.host;
    if (!host) continue;
    if (host.enableKey) {
      keys.push({
        fullKey: `${plugin.id}.${host.enableKey}`,
        namespace: plugin.id,
        key: host.enableKey,
        levels: HOST_DEFAULTS_LEVELS,
      });
    }
    for (const field of host.fields) {
      if (!isDefaultableField(field)) continue;
      keys.push({
        fullKey: `${plugin.id}.${field.key}`,
        namespace: plugin.id,
        key: field.key,
        levels: field.defaultLevels?.length
          ? field.defaultLevels
          : HOST_DEFAULTS_LEVELS,
      });
    }
  }
  return keys;
}

export const CORE_EDITOR_KEYS: EditorDefaultKey[] = CORE_HOST_DEFAULTS.map(
  (entry) => ({
    fullKey: `${CORE_NAMESPACE}.${entry.key}`,
    namespace: CORE_NAMESPACE,
    key: entry.key,
    levels: entry.levels,
  }),
);

/** Every key, by full key. Refreshed when the plugin list is. */
export function useEditorDefaultKeys(): Map<string, EditorDefaultKey> {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    void getPlugins()
      .then((loaded) => {
        if (!cancelled) setPlugins(loaded);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return useMemo(
    () =>
      new Map(
        [...CORE_EDITOR_KEYS, ...pluginDefaultKeys(plugins)].map((entry) => [
          entry.fullKey,
          entry,
        ]),
      ),
    [plugins],
  );
}
