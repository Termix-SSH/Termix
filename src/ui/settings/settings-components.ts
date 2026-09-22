/**
 * Components behind a `type: "custom"` settings field.
 *
 * Most settings are expressible as a schema, and those are rendered from the
 * manifest so a plugin cannot ship its own form styling. A few are not: a
 * device browser, a provider list. Those declare a component id here instead,
 * which keeps the escape hatch narrow and named rather than letting a plugin
 * hand core arbitrary markup.
 *
 * A7 lets a plugin's own frontend bundle register these through
 * `app.registerSettingsComponent`. Until then core registers them, in
 * legacy-settings-components.ts.
 */

import type { ComponentType } from "react";

export interface SettingsComponentProps {
  pluginId: string;
  /** Current values for the scope this field sits in. */
  values: Record<string, unknown>;
  /** Writes one key in the same scope. */
  setValue: (key: string, value: unknown) => void;
  /** Whether the owning plugin is running. */
  running: boolean;
}

export type SettingsComponent = ComponentType<SettingsComponentProps>;

/** Keyed "<pluginId>:<componentId>" so two plugins may use the same name. */
const registry = new Map<string, SettingsComponent>();

function registryKey(pluginId: string, componentId: string): string {
  return `${pluginId}:${componentId}`;
}

export function registerSettingsComponent(
  pluginId: string,
  componentId: string,
  component: SettingsComponent,
): () => void {
  const key = registryKey(pluginId, componentId);
  registry.set(key, component);
  return () => {
    if (registry.get(key) === component) registry.delete(key);
  };
}

export function getSettingsComponent(
  pluginId: string,
  componentId: string | undefined,
): SettingsComponent | undefined {
  if (!componentId) return undefined;
  return registry.get(registryKey(pluginId, componentId));
}

export function unregisterSettingsComponents(pluginId: string): void {
  for (const key of [...registry.keys()]) {
    if (key.startsWith(`${pluginId}:`)) registry.delete(key);
  }
}

/** Test helper. */
export function resetSettingsComponents(): void {
  registry.clear();
}
