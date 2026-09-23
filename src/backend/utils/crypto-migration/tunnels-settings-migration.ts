/**
 * Moves the two tunnel host columns into the tunnels plugin's host-scope
 * settings, before those columns are dropped from ssh_data.
 *
 * Idempotent: skips a host that already has a tunnels settings row, so it is
 * safe to run on every boot. Lossless: reads straight off the still-present
 * ssh_data columns, so it must run and finish before those columns are ever
 * dropped from schema.ts.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { getDb } from "../../database/db/index.js";
import { createCurrentPluginSettingsRepository } from "../../database/repositories/factory.js";

export interface TunnelsSettingsMigrationResult {
  moved: number;
  skipped: number;
}

interface LegacyTunnelRow {
  id: number;
  enable_tunnel: number | boolean | null;
  tunnel_connections: string | null;
}

function parseConnections(raw: string | null): unknown[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function runTunnelsSettingsMigration(): Promise<TunnelsSettingsMigrationResult> {
  const result: TunnelsSettingsMigrationResult = { moved: 0, skipped: 0 };

  try {
    const drizzleDb = getDb();
    // Raw SQL, not the typed schema, so this keeps working once schema.ts
    // stops declaring these columns. The plugin's enable switch defaults to
    // off, so every host that had tunnels on (the old column default) or
    // any saved tunnel has to be copied, not just the non-default ones.
    const rows = await drizzleDb.all<LegacyTunnelRow>(sql`
      SELECT id, enable_tunnel, tunnel_connections
      FROM ssh_data
      WHERE enable_tunnel = true OR tunnel_connections IS NOT NULL
    `);

    if (rows.length === 0) return result;

    const pluginSettingsRepository = createCurrentPluginSettingsRepository();

    for (const row of rows) {
      const scopeId = String(row.id);
      const existing = await pluginSettingsRepository.get(
        "tunnels",
        "host",
        scopeId,
        "enableTunnel",
      );
      if (existing && existing.value !== null) {
        result.skipped++;
        continue;
      }

      await pluginSettingsRepository.set(
        "tunnels",
        "host",
        scopeId,
        "enableTunnel",
        JSON.stringify(!!row.enable_tunnel),
      );
      await pluginSettingsRepository.set(
        "tunnels",
        "host",
        scopeId,
        "tunnelConnections",
        JSON.stringify(parseConnections(row.tunnel_connections)),
      );
      result.moved++;
    }

    if (result.moved > 0) {
      databaseLogger.info(
        `Moved tunnel settings for ${result.moved} host(s) into plugin settings`,
        { operation: "tunnels_settings_migration", moved: result.moved },
      );
    }
  } catch (error) {
    // A failed migration must not stop the backend. Hosts simply keep
    // whatever tunnel settings they already had (none, on a fresh run).
    databaseLogger.warn("Tunnel settings migration failed", {
      operation: "tunnels_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
