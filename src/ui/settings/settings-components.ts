/**
 * Components behind a `type: "custom"` settings field.
 *
 * Most settings are expressible as a schema, and those are rendered from the
 * manifest so a plugin cannot ship its own form styling. A few are not: a
 * device browser, a provider list. Those declare a component id here instead,
 * which keeps the escape hatch narrow and named rather than letting a plugin
 * hand core arbitrary markup. A plugin registers them from its frontend
 * through `app.registerSettingsComponent`.
 */

import type { ComponentType } from "react";
import { createRegistry } from "@/lib/registry";

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
const registry = createRegistry<{
  id: string;
  component: SettingsComponent;
}>();

function registryKey(pluginId: string, componentId: string): string {
  return `${pluginId}:${componentId}`;
}

export function registerSettingsComponent(
  pluginId: string,
  componentId: string,
  component: SettingsComponent,
): () => void {
  return registry.register({
    id: registryKey(pluginId, componentId),
    component,
  });
}

export function getSettingsComponent(
  pluginId: string,
  componentId: string | undefined,
): SettingsComponent | undefined {
  if (!componentId) return undefined;
  return registry.get(registryKey(pluginId, componentId))?.component;
}

/** Registered "<pluginId>:<componentId>" keys. */
export function listSettingsComponents(): string[] {
  return registry.list().map((entry) => entry.id);
}

/** Re-renders when components are registered, e.g. after a plugin loads. */
export const useSettingsComponents = registry.useList;

/** Test helper. */
export function resetSettingsComponents(): void {
  registry.reset();
}
