import {
  CORE_NAMESPACE,
  splitDefaultKey,
  type ResolvedHostDefault,
} from "@/types/host-defaults";
import type { Host } from "@/types/ui-types";

type PluginValues = Record<string, Record<string, unknown>>;

/** The plugin keys of a resolved set, in the host payload's shape. */
export function pluginSettingsFrom(
  resolved: Record<string, ResolvedHostDefault>,
): PluginValues {
  const result: PluginValues = {};
  for (const [fullKey, entry] of Object.entries(resolved)) {
    const [namespace, key] = splitDefaultKey(fullKey);
    if (namespace === CORE_NAMESPACE) continue;
    result[namespace] = { ...(result[namespace] ?? {}), [key]: entry.value };
  }
  return result;
}

/** A quick connect host with the defaults under whatever it set itself. */
export function withDefaultPluginSettings(
  host: Host,
  defaults: PluginValues,
): Host {
  const own = host.pluginSettings ?? {};
  const merged: PluginValues = { ...defaults };
  for (const [pluginId, values] of Object.entries(own)) {
    merged[pluginId] = { ...(defaults[pluginId] ?? {}), ...values };
  }
  return { ...host, pluginSettings: merged };
}
