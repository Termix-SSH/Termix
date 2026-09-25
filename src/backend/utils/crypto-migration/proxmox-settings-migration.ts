/**
 * Moves the four Proxmox host columns into the proxmox plugin's host-scope
 * settings, before those columns are dropped from ssh_data.
 *
 * Idempotent: skips a host that already has a proxmox settings row, so it is
 * safe to run on every boot. Lossless: reads straight off the still-present
 * ssh_data columns, so it must run and finish before those columns are ever
 * dropped from schema.ts.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { selectLegacyRows } from "./raw-rows.js";
import { createCurrentPluginSettingsRepository } from "../../database/repositories/factory.js";

export interface ProxmoxSettingsMigrationResult {
  moved: number;
  skipped: number;
}

interface LegacyProxmoxRow {
  id: number;
  enable_proxmox: number | boolean | null;
  proxmox_config: string | null;
  enable_proxmox_stats: number | boolean | null;
  proxmox_stats_config: string | null;
}

export async function runProxmoxSettingsMigration(): Promise<ProxmoxSettingsMigrationResult> {
  const result: ProxmoxSettingsMigrationResult = { moved: 0, skipped: 0 };

  try {
    // Raw SQL, not the typed schema: this runs once schema.ts has already
    // dropped these columns, so the query is the only thing left that still
    // knows they used to exist.
    const rows = await selectLegacyRows<LegacyProxmoxRow>(sql`
      SELECT id, enable_proxmox, proxmox_config, enable_proxmox_stats, proxmox_stats_config
      FROM ssh_data
      WHERE enable_proxmox = true OR proxmox_config IS NOT NULL
         OR enable_proxmox_stats = true OR proxmox_stats_config IS NOT NULL
    `);

    if (rows.length === 0) return result;

    const pluginSettingsRepository = createCurrentPluginSettingsRepository();

    for (const row of rows) {
      const scopeId = String(row.id);
      const existing = await pluginSettingsRepository.get(
        "proxmox",
        "host",
        scopeId,
        "enableProxmox",
      );
      if (existing && existing.value !== null) {
        result.skipped++;
        continue;
      }

      await pluginSettingsRepository.set(
        "proxmox",
        "host",
        scopeId,
        "enableProxmox",
        JSON.stringify(!!row.enable_proxmox),
      );
      await pluginSettingsRepository.set(
        "proxmox",
        "host",
        scopeId,
        "proxmoxConfig",
        JSON.stringify(
          row.proxmox_config ? safeParse(row.proxmox_config) : null,
        ),
      );
      await pluginSettingsRepository.set(
        "proxmox",
        "host",
        scopeId,
        "enableProxmoxStats",
        JSON.stringify(!!row.enable_proxmox_stats),
      );
      await pluginSettingsRepository.set(
        "proxmox",
        "host",
        scopeId,
        "proxmoxStatsConfig",
        JSON.stringify(
          row.proxmox_stats_config ? safeParse(row.proxmox_stats_config) : null,
        ),
      );
      result.moved++;
    }

    if (result.moved > 0) {
      databaseLogger.info(
        `Moved Proxmox settings for ${result.moved} host(s) into plugin settings`,
        { operation: "proxmox_settings_migration", moved: result.moved },
      );
    }
  } catch (error) {
    // A failed migration must not stop the backend. Hosts simply keep
    // whatever proxmox settings they already had (none, on a fresh run).
    databaseLogger.warn("Proxmox settings migration failed", {
      operation: "proxmox_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}

function safeParse(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
