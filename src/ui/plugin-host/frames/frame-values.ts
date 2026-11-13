/**
 * Values a plugin's background frame sends (rail badges, host dots,
 * companion defaults), for the shell to draw.
 */

import { useSyncExternalStore } from "react";

const values = new Map<string, unknown>();
const listeners = new Map<string, Set<() => void>>();

const id = (pluginId: string, key: string) => `${pluginId}\u0000${key}`;

export function setFrameValue(pluginId: string, key: string, value: unknown) {
  const name = id(pluginId, key);
  values.set(name, value);
  for (const listener of [...(listeners.get(name) ?? [])]) listener();
}

export function getFrameValue(pluginId: string, key: string): unknown {
  return values.get(id(pluginId, key));
}

export function clearFrameValues(pluginId: string): void {
  const prefix = `${pluginId}\u0000`;
  for (const name of [...values.keys()]) {
    if (!name.startsWith(prefix)) continue;
    values.delete(name);
    for (const listener of [...(listeners.get(name) ?? [])]) listener();
  }
}

export function useFrameValue(pluginId: string, key: string): unknown {
  const name = id(pluginId, key);
  return useSyncExternalStore(
    (listener) => {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(listener);
      return () => {
        set!.delete(listener);
        if (set!.size === 0) listeners.delete(name);
      };
    },
    () => values.get(name),
    () => values.get(name),
  );
}
