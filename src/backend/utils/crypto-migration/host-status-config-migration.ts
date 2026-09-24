/**
 * Copies the status check options out of ssh_data.stats_config into the
 * status_check_enabled and status_check_interval columns. Status checks are
 * core; the rest of stats_config belongs to the host-metrics plugin and is
 * moved by host-metrics-settings-migration.ts.
 *
 * The stats_config column stays in the database, unused: core's drizzle
 * migrations run before this does, so dropping it there would lose the data.
 *
 * Runs once, marked by a settings row, because the new columns have defaults
 * and there is no other way to tell a copied row from an untouched one.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { createCurrentSettingsRepository } from "../../database/repositories/factory.js";
import { runStatement, selectRows } from "./raw-rows.js";

export const HOST_STATUS_CONFIG_MIGRATED = "host_status_config_migrated";

export interface LegacyStatusConfig {
  statusCheckEnabled: boolean;
  statusCheckInterval: number | null;
}

/** The status part of an old stats_config value. */
export function statusConfigFromStatsConfig(
  raw: string | null,
): LegacyStatusConfig {
  let parsed: unknown = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
    // Some rows were stringified twice.
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
  } catch {
    parsed = null;
  }
  const config =
    parsed && typeof parsed === "object"
      ? (parsed as Record<string, unknown>)
      : {};
  const seconds = Number(config.statusCheckInterval);
  return {
    statusCheckEnabled:
      config.statusCheckEnabled !== false && config.disableTcpPing !== true,
    statusCheckInterval:
      config.useGlobalStatusInterval === false &&
      Number.isInteger(seconds) &&
      seconds >= 5
        ? seconds
        : null,
  };
}

export interface HostStatusConfigMigrationResult {
  skipped: boolean;
  hostsMoved: number;
}

export async function runHostStatusConfigMigration(): Promise<HostStatusConfigMigrationResult> {
  const settings = createCurrentSettingsRepository();
  try {
    if ((await settings.get(HOST_STATUS_CONFIG_MIGRATED)) === "true") {
      return { skipped: true, hostsMoved: 0 };
    }
  } catch {
    return { skipped: true, hostsMoved: 0 };
  }

  let hostsMoved = 0;
  try {
    // Raw SQL: schema.ts no longer declares stats_config.
    const rows = await selectRows<{ id: number; stats_config: string | null }>(
      sql`SELECT id, stats_config FROM ssh_data WHERE stats_config IS NOT NULL`,
    );
    for (const row of rows) {
      const config = statusConfigFromStatsConfig(row.stats_config);
      if (config.statusCheckEnabled && config.statusCheckInterval === null) {
        continue;
      }
      // TRUE and FALSE as literals: SQLite cannot bind a JS boolean.
      await runStatement(sql`
        UPDATE ssh_data
        SET status_check_enabled = ${sql.raw(config.statusCheckEnabled ? "TRUE" : "FALSE")},
          status_check_interval = ${config.statusCheckInterval}
        WHERE id = ${row.id}
      `);
      hostsMoved++;
    }
  } catch {
    // A fresh install never had the column.
  }

  try {
    await settings.set(HOST_STATUS_CONFIG_MIGRATED, "true");
  } catch (error) {
    databaseLogger.warn("Could not mark the host status migration done", {
      operation: "host_status_config_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (hostsMoved > 0) {
    databaseLogger.info(
      `Moved status check options for ${hostsMoved} host(s) out of stats_config`,
      { operation: "host_status_config_migration" },
    );
  }
  return { skipped: false, hostsMoved };
}
