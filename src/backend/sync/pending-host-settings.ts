/**
 * The plugin settings a linked desktop keeps for plugins not running on it.
 * See the table's comment in schema.ts.
 */

import { and, eq, inArray } from "drizzle-orm";
import { syncPendingHostSettings } from "../database/db/schema.js";
import { createCurrentRepositoryContext } from "../database/repositories/factory.js";
import { DatabaseSaveTrigger } from "../utils/database-save-trigger.js";

/** One host's values, by plugin id. */
export type PendingHostSettings = Record<string, Record<string, unknown>>;

export interface PendingHostSetting {
  hostId: number;
  pluginId: string;
  settings: Record<string, unknown>;
}

function db() {
  return createCurrentRepositoryContext().drizzle;
}

function parse(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function getPendingHostSettings(
  hostId: number,
): Promise<PendingHostSettings> {
  const rows = await db()
    .select()
    .from(syncPendingHostSettings)
    .where(eq(syncPendingHostSettings.hostId, hostId));
  const result: PendingHostSettings = {};
  for (const row of rows) {
    const settings = parse(row.settings);
    if (settings) result[row.pluginId] = settings;
  }
  return result;
}

/** Replaces what a host keeps with what the server sent last. */
export async function setPendingHostSettings(
  hostId: number,
  byPlugin: PendingHostSettings,
): Promise<void> {
  const entries = Object.entries(byPlugin);
  const existing = await db()
    .select({ id: syncPendingHostSettings.id })
    .from(syncPendingHostSettings)
    .where(eq(syncPendingHostSettings.hostId, hostId))
    .limit(1);
  if (existing.length === 0 && entries.length === 0) return;

  await db()
    .delete(syncPendingHostSettings)
    .where(eq(syncPendingHostSettings.hostId, hostId));
  if (entries.length > 0) {
    await db()
      .insert(syncPendingHostSettings)
      .values(
        entries.map(([pluginId, settings]) => ({
          hostId,
          pluginId,
          settings: JSON.stringify(settings),
        })),
      );
  }
  DatabaseSaveTrigger.triggerSave("sync_pending_host_settings");
}

/** Everything kept for any of these plugins, on every host. */
export async function listPendingHostSettings(
  pluginIds: string[],
): Promise<PendingHostSetting[]> {
  if (pluginIds.length === 0) return [];
  const rows = await db()
    .select()
    .from(syncPendingHostSettings)
    .where(inArray(syncPendingHostSettings.pluginId, pluginIds));
  const result: PendingHostSetting[] = [];
  for (const row of rows) {
    const settings = parse(row.settings);
    if (settings) {
      result.push({ hostId: row.hostId, pluginId: row.pluginId, settings });
    }
  }
  return result;
}

export async function deletePendingHostSettings(
  hostId: number,
  pluginId: string,
): Promise<void> {
  await db()
    .delete(syncPendingHostSettings)
    .where(
      and(
        eq(syncPendingHostSettings.hostId, hostId),
        eq(syncPendingHostSettings.pluginId, pluginId),
      ),
    );
  DatabaseSaveTrigger.triggerSave("sync_pending_host_settings");
}
