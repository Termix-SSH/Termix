import { useEffect, useState } from "react";
import {
  getPlugins,
  PLUGINS_CHANGED_EVENT,
  type PluginSummary,
} from "@/api/plugins-api";

// Shared by every caller so a screen using the hook many times sends one
// request, and a screen opened later starts from the last list.
let latest: PluginSummary[] | null = null;
let loadedAt = 0;
let inflight: Promise<PluginSummary[]> | null = null;
let generation = 0;
const listeners = new Set<(plugins: PluginSummary[]) => void>();
// Changes announce themselves, so a list this new is not asked for again.
const FRESH_MS = 5000;

function refresh(): Promise<PluginSummary[]> {
  if (inflight) return inflight;
  const current = generation;
  const request = getPlugins()
    .then((loaded) => {
      if (current === generation) {
        latest = loaded;
        loadedAt = Date.now();
        for (const listener of listeners) listener(loaded);
      }
      return loaded;
    })
    .finally(() => {
      if (inflight === request) inflight = null;
    });
  inflight = request;
  return request;
}

function onPluginsChanged() {
  // A change made while a request was running must not keep the old answer.
  generation++;
  inflight = null;
  loadedAt = 0;
  if (listeners.size > 0) void refresh().catch(() => {});
}

let watching = false;

/** Forgets the shared list. For tests. */
export function resetInstalledPluginsCache(): void {
  latest = null;
  loadedAt = 0;
  inflight = null;
  generation++;
}

/**
 * Every installed plugin, read again whenever one is enabled, disabled,
 * installed or removed, so what a plugin adds shows up without a reload.
 */
export function useInstalledPlugins(): PluginSummary[] {
  const [plugins, setPlugins] = useState<PluginSummary[]>(() => latest ?? []);

  useEffect(() => {
    listeners.add(setPlugins);
    if (!watching) {
      watching = true;
      window.addEventListener(PLUGINS_CHANGED_EVENT, onPluginsChanged);
    }
    if (latest) setPlugins(latest);
    if (!latest || Date.now() - loadedAt > FRESH_MS) {
      void refresh().catch(() => {});
    }
    return () => {
      listeners.delete(setPlugins);
    };
  }, []);

  return plugins;
}
