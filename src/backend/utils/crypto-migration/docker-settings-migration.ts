/**
 * Moves each host's Docker options out of ssh_data and into the docker
 * plugin's host settings: enable_docker becomes enableDocker and the runtime
 * in docker_config becomes containerRuntime.
 *
 * The columns stay in the database, unused: core's drizzle migrations run
 * before this does, so dropping them there would lose the data first.
 *
 * Idempotent: a host that already has any docker row is skipped, so this is
 * safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../../database/repositories/factory.js";
import { selectRows } from "./raw-rows.js";

const PLUGIN_ID = "docker";

interface LegacyHostRow {
  id: number;
  enable_docker: number | boolean | string | null;
  docker_config: string | null;
}

/** The plugin's host settings for one legacy row, defaults left out. */
export function dockerSettingsFromRow(
  row: LegacyHostRow,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const flag = row.enable_docker;
  if (flag === true || flag === 1 || flag === "1" || flag === "true") {
    values.enableDocker = true;
  }
  if (row.docker_config) {
    try {
      const config = JSON.parse(row.docker_config) as { runtime?: unknown };
      if (config?.runtime === "podman") values.containerRuntime = "podman";
    } catch {
      // unreadable config means the default runtime
    }
  }
  return values;
}

export interface DockerSettingsMigrationResult {
  hostsMoved: number;
  hostsSkipped: number;
}

export async function runDockerSettingsMigration(): Promise<DockerSettingsMigrationResult> {
  const result: DockerSettingsMigrationResult = {
    hostsMoved: 0,
    hostsSkipped: 0,
  };

  // plugin_settings has a foreign key to plugins: nothing to migrate into
  // until the plugin row exists.
  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
  } catch {
    return result;
  }

  const pluginSettings = createCurrentPluginSettingsRepository();

  let rows: LegacyHostRow[];
  try {
    // Raw SQL: schema.ts no longer declares these columns.
    rows = await selectRows<LegacyHostRow>(
      sql`SELECT id, enable_docker, docker_config FROM ssh_data`,
    );
  } catch {
    // A fresh install never had the columns.
    return result;
  }

  for (const row of rows) {
    const values = dockerSettingsFromRow(row);
    if (Object.keys(values).length === 0) continue;
    const scopeId = String(row.id);
    try {
      const existing = await pluginSettings.getAll(PLUGIN_ID, "host", scopeId);
      if (existing.length > 0) {
        result.hostsSkipped++;
        continue;
      }
      for (const [key, value] of Object.entries(values)) {
        await pluginSettings.set(
          PLUGIN_ID,
          "host",
          scopeId,
          key,
          JSON.stringify(value),
        );
      }
      result.hostsMoved++;
    } catch (error) {
      databaseLogger.warn("Docker host settings migration failed for a host", {
        operation: "docker_settings_migration",
        hostId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (result.hostsMoved > 0) {
    databaseLogger.info(
      `Moved Docker settings for ${result.hostsMoved} host(s) into plugin settings`,
      { operation: "docker_settings_migration" },
    );
  }
  return result;
}
