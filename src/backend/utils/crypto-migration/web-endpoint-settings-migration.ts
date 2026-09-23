/**
 * Moves the two web endpoint host columns into the web-endpoint plugin's
 * host-scope settings, before those columns are dropped from ssh_data.
 *
 * Idempotent: skips a host that already has a web-endpoint settings row, so
 * it is safe to run on every boot. Lossless: reads straight off the
 * still-present ssh_data columns, so it must run and finish before those
 * columns are ever dropped from schema.ts.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { getDb } from "../../database/db/index.js";
import { createCurrentPluginSettingsRepository } from "../../database/repositories/factory.js";

export interface WebEndpointSettingsMigrationResult {
  moved: number;
  skipped: number;
}

interface LegacyWebEndpointRow {
  id: number;
  enable_web_ui: number | boolean | null;
  web_ui_config: string | null;
}

function parseConfig(raw: string | null): unknown {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function runWebEndpointSettingsMigration(): Promise<WebEndpointSettingsMigrationResult> {
  const result: WebEndpointSettingsMigrationResult = { moved: 0, skipped: 0 };

  try {
    const drizzleDb = getDb();
    // Raw SQL, not the typed schema, so this keeps working once schema.ts
    // stops declaring these columns.
    const rows = await drizzleDb.all<LegacyWebEndpointRow>(sql`
      SELECT id, enable_web_ui, web_ui_config
      FROM ssh_data
      WHERE enable_web_ui = true OR web_ui_config IS NOT NULL
    `);

    if (rows.length === 0) return result;

    const pluginSettingsRepository = createCurrentPluginSettingsRepository();

    for (const row of rows) {
      const scopeId = String(row.id);
      const existing = await pluginSettingsRepository.get(
        "web-endpoint",
        "host",
        scopeId,
        "enableWebUi",
      );
      if (existing && existing.value !== null) {
        result.skipped++;
        continue;
      }

      await pluginSettingsRepository.set(
        "web-endpoint",
        "host",
        scopeId,
        "enableWebUi",
        JSON.stringify(!!row.enable_web_ui),
      );
      await pluginSettingsRepository.set(
        "web-endpoint",
        "host",
        scopeId,
        "webUiConfig",
        JSON.stringify(parseConfig(row.web_ui_config)),
      );
      result.moved++;
    }

    if (result.moved > 0) {
      databaseLogger.info(
        `Moved web endpoint settings for ${result.moved} host(s) into plugin settings`,
        { operation: "web_endpoint_settings_migration", moved: result.moved },
      );
    }
  } catch (error) {
    // A failed migration must not stop the backend. Hosts simply keep
    // whatever web endpoint settings they already had (none, on a fresh run).
    databaseLogger.warn("Web endpoint settings migration failed", {
      operation: "web_endpoint_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
