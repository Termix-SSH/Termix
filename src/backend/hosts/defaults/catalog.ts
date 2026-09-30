/**
 * Every key a host can inherit: core's own catalog plus each running
 * plugin's host fields, in one shape the resolver and materializer share.
 */

import type {
  PluginManifest,
  PluginSettingsField,
} from "@termix/plugin-sdk/manifest";
import { coerceSettingValue } from "@termix/plugin-sdk/settings";
import {
  CORE_HOST_DEFAULTS,
  CORE_NAMESPACE,
  HOST_DEFAULTS_LEVELS,
  joinDefaultKey,
  type HostDefaultsLevel,
} from "../../../types/host-defaults.js";
import { declaredFields } from "../../plugins/settings.js";

export interface DefaultKeyInfo {
  namespace: string;
  key: string;
  fullKey: string;
  levels: readonly HostDefaultsLevel[];
  /** Undefined when nothing is inherited unless some level sets it. */
  builtin: unknown;
  normalize: (value: unknown) => unknown;
  personal: boolean;
  /** Plugin keys only. */
  field?: PluginSettingsField;
}

export type DefaultsCatalog = Map<string, DefaultKeyInfo>;

/** Whether a plugin's host field can have a default. */
export function isDefaultableField(field: PluginSettingsField): boolean {
  if (field.type === "secret") return false;
  if (field.type === "json" && field.secretKeys?.length) return false;
  return field.defaultable !== false;
}

/** A plugin's host fields that can have a default, enable switch included. */
export function defaultableHostFields(
  manifest: PluginManifest,
): PluginSettingsField[] {
  return declaredFields(manifest, "host").filter(isDefaultableField);
}

function isUnset(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

export function normalizePluginValue(
  field: PluginSettingsField,
  value: unknown,
): unknown {
  // A row with no value reads as the manifest default, so compare that way.
  if (isUnset(value)) return field.default ?? null;
  try {
    const coerced = coerceSettingValue(field, value);
    return isUnset(coerced) ? (field.default ?? null) : coerced;
  } catch {
    return value;
  }
}

export function coreCatalogEntries(): DefaultKeyInfo[] {
  return CORE_HOST_DEFAULTS.map((entry) => ({
    namespace: CORE_NAMESPACE,
    key: entry.key,
    fullKey: joinDefaultKey(CORE_NAMESPACE, entry.key),
    levels: entry.levels,
    builtin: entry.builtin,
    normalize: entry.normalize,
    personal: false,
  }));
}

export function pluginCatalogEntries(
  manifest: PluginManifest,
): DefaultKeyInfo[] {
  return defaultableHostFields(manifest).map((field) => ({
    namespace: manifest.id,
    key: field.key,
    fullKey: joinDefaultKey(manifest.id, field.key),
    levels: field.defaultLevels?.length
      ? field.defaultLevels
      : HOST_DEFAULTS_LEVELS,
    builtin: normalizePluginValue(field, field.default),
    normalize: (value: unknown) => normalizePluginValue(field, value),
    personal: field.personal === true,
    field,
  }));
}

export function buildCatalog(manifests: PluginManifest[]): DefaultsCatalog {
  const catalog: DefaultsCatalog = new Map();
  for (const entry of coreCatalogEntries()) catalog.set(entry.fullKey, entry);
  for (const manifest of manifests) {
    for (const entry of pluginCatalogEntries(manifest)) {
      catalog.set(entry.fullKey, entry);
    }
  }
  return catalog;
}

/** Namespaces the catalog covers: core plus each plugin with a defaultable field. */
export function catalogNamespaces(catalog: DefaultsCatalog): string[] {
  return [...new Set([...catalog.values()].map((entry) => entry.namespace))];
}
