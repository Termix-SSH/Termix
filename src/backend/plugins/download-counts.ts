/**
 * Download counts for the plugin store, copied from the registry's
 * stats.json into plugin_install_counts.
 *
 * A count is how often the plugin's .tmxplug release files were downloaded.
 * An instance that updates three times counts three times, and copies bundled
 * into Docker images or the desktop app never count. Treat it as a ranking,
 * never as a user count.
 */

import { pluginLogger } from "../utils/logger.js";
import {
  OFFICIAL_REGISTRY_ID,
  fetchRegistryStats,
  officialSource,
  type RegistrySource,
} from "./registry-index.js";

async function repository() {
  const { createCurrentPluginInstallCountRepository } =
    await import("../database/repositories/factory.js");
  return createCurrentPluginInstallCountRepository();
}

const STALE_MS = 6 * 60 * 60_000;
const FORCED_MS = 60_000;
const WAIT_MS = 3_000;

let lastSyncAt = 0;
let running: Promise<number> | null = null;

/**
 * Syncs when the counts are older than the registry timer's interval, or
 * older than a minute with force (the Refresh button). Waits a few seconds
 * at most so a slow registry never holds up the store; a sync that runs
 * longer still finishes in the background.
 */
export async function refreshDownloadCounts(force = false): Promise<void> {
  const age = Date.now() - lastSyncAt;
  if (!running && age >= (force ? FORCED_MS : STALE_MS)) {
    running = syncDownloadCounts().finally(() => {
      running = null;
    });
  }
  if (!running) return;
  let timeout: NodeJS.Timeout | undefined;
  await Promise.race([
    running,
    new Promise((resolve) => {
      timeout = setTimeout(resolve, WAIT_MS);
    }),
  ]);
  clearTimeout(timeout);
}

/** Test seam. */
export function resetDownloadCountRefresh(): void {
  lastSyncAt = 0;
  running = null;
}

/** Returns how many rows changed. Never throws; a failed sync keeps the old numbers. */
export async function syncDownloadCounts(): Promise<number> {
  lastSyncAt = Date.now();
  let changed = 0;
  let sources: RegistrySource[] = [officialSource()];
  try {
    const { listSources } = await import("./registries.js");
    sources = await listSources();
  } catch {
    // Official only when the registry choices cannot be read.
  }
  for (const source of sources) {
    try {
      const stats = await fetchRegistryStats(source);
      if (!stats) continue;
      const entries = [...stats.plugins].map(([pluginId, downloads]) => ({
        pluginId,
        count: downloads,
      }));
      changed += await (await repository()).upsertMany(source.id, entries);
    } catch (error) {
      pluginLogger.warn(
        `Could not sync plugin download counts from ${source.id}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { operation: "plugin_registry" },
      );
    }
  }
  return changed;
}

export async function readDownloadCounts(
  registryId: string = OFFICIAL_REGISTRY_ID,
): Promise<Map<string, number>> {
  try {
    const rows = await (await repository()).listByRegistry(registryId);
    return new Map(rows.map((row) => [row.pluginId, row.count]));
  } catch {
    return new Map();
  }
}
