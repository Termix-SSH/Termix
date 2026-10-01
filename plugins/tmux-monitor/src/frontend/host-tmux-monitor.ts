import type { PluginHostRecord } from "@termix/plugin-sdk/frontend";

/** Whether the monitor is enabled for this host, as the host payload's
 * pluginSettings carries it. */
export function tmuxMonitorEnabled(
  host: PluginHostRecord | null | undefined,
): boolean {
  const settings = (
    host?.pluginSettings as Record<string, Record<string, unknown>> | undefined
  )?.["tmux-monitor"];
  return settings?.enableTmuxMonitor === true;
}
