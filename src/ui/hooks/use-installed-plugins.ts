import { useEffect, useState } from "react";
import {
  getPlugins,
  PLUGINS_CHANGED_EVENT,
  type PluginSummary,
} from "@/api/plugins-api";

/**
 * Every installed plugin, read again whenever one is enabled, disabled,
 * installed or removed, so what a plugin adds shows up without a reload.
 */
export function useInstalledPlugins(): PluginSummary[] {
  const [plugins, setPlugins] = useState<PluginSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    let request = 0;
    const load = () => {
      const current = ++request;
      void getPlugins()
        .then((loaded) => {
          if (!cancelled && current === request) setPlugins(loaded);
        })
        .catch(() => {});
    };
    load();
    window.addEventListener(PLUGINS_CHANGED_EVENT, load);
    return () => {
      cancelled = true;
      window.removeEventListener(PLUGINS_CHANGED_EVENT, load);
    };
  }, []);

  return plugins;
}
