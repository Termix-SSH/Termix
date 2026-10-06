/**
 * Popularity numbers for the plugin store, copied from the registry's
 * stats.json into plugin_install_counts.
 *
 * Two sources, and the store prefers the first:
 * - "aggregate-telemetry": instances that reported the plugin enabled in the
 *   last 7 days through the Usage Statistics plugin. It undercounts by every
 *   instance that turned the report off or never installed that plugin.
 * - "github-releases": downloads of the plugin's .tmxplug release assets.
 *   This counts downloads, not active installs: an instance that updates
 *   three times counts three times, and Docker images that bundle the plugin
 *   count once per build, not once per install.
 *
 * Treat both as a rough ranking, never as a user count.
 */

import { pluginLogger } from "../utils/logger.js";
import { OFFICIAL_REGISTRY_ID, fetchRegistryStats } from "./registry-index.js";

export const TELEMETRY_SOURCE = "aggregate-telemetry";
export const DOWNLOADS_SOURCE = "github-releases";

export interface InstallCount {
  count: number;
  source: string;
}

async function repository() {
  const { createCurrentPluginInstallCountRepository } =
    await import("../database/repositories/factory.js");
  return createCurrentPluginInstallCountRepository();
}

/** Picks the number to show: active installs when known, downloads otherwise. */
export function preferredCount(entry: {
  downloads: number;
  activeInstalls: number | null;
}): InstallCount {
  return entry.activeInstalls !== null && entry.activeInstalls > 0
    ? { count: entry.activeInstalls, source: TELEMETRY_SOURCE }
    : { count: entry.downloads, source: DOWNLOADS_SOURCE };
}

/** Returns how many rows changed. Never throws; a failed sync keeps the old numbers. */
export async function syncInstallCounts(): Promise<number> {
  try {
    const stats = await fetchRegistryStats();
    if (!stats) return 0;
    const entries = [...stats.plugins].map(([pluginId, entry]) => ({
      pluginId,
      ...preferredCount(entry),
    }));
    return await (await repository()).upsertMany(OFFICIAL_REGISTRY_ID, entries);
  } catch (error) {
    pluginLogger.warn(
      `Could not sync plugin install counts: ${
        error instanceof Error ? error.message : String(error)
      }`,
      { operation: "plugin_registry" },
    );
    return 0;
  }
}

export async function readInstallCounts(
  registryId: string = OFFICIAL_REGISTRY_ID,
): Promise<Map<string, InstallCount>> {
  try {
    const rows = await (await repository()).listByRegistry(registryId);
    return new Map(
      rows.map((row) => [
        row.pluginId,
        { count: row.count, source: row.source },
      ]),
    );
  } catch {
    return new Map();
  }
}
