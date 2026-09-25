/**
 * Moves each host's Vault signer profile out of ssh_data and into the vault
 * plugin's profileId host setting.
 *
 * An install that used Vault keeps sending the pre-2.9 redirect URI
 * (/vault/oidc/callback), because that is the one its Vault OIDC roles
 * allow: the plugin's legacyCallback setting is turned on.
 *
 * The column stays in the database, unused: core's drizzle migrations run
 * before this does, so dropping it there would lose the data first.
 *
 * Idempotent: a host or setting that already has a value is skipped, so this
 * is safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../database/repositories/factory.js";
import { selectRows } from "../utils/crypto-migration/raw-rows.js";

const PLUGIN_ID = "vault";
const SETTING_KEY = "profileId";

interface LegacyHostRow {
  id: number;
  vault_profile_id: number | string | null;
}

export interface VaultSettingsMigrationResult {
  hostsMoved: number;
  hostsSkipped: number;
  legacyCallback: boolean;
}

async function legacyRows(): Promise<LegacyHostRow[]> {
  try {
    // Raw SQL: schema.ts no longer declares vault_profile_id.
    return await selectRows<LegacyHostRow>(
      sql`SELECT id, vault_profile_id FROM ssh_data WHERE vault_profile_id IS NOT NULL`,
    );
  } catch {
    // A fresh install never had the column.
    return [];
  }
}

/** Whether 2.8 had any Vault profile, before or after the plugin adopted them. */
async function hadProfiles(): Promise<boolean> {
  for (const table of ["vault_profiles", "p_vault_profiles"]) {
    try {
      const rows = await selectRows<unknown>(
        sql`SELECT 1 FROM ${sql.identifier(table)} LIMIT 1`,
      );
      if (rows.length > 0) return true;
    } catch {
      // table not there
    }
  }
  return false;
}

export async function runVaultSettingsMigration(): Promise<VaultSettingsMigrationResult> {
  const result: VaultSettingsMigrationResult = {
    hostsMoved: 0,
    hostsSkipped: 0,
    legacyCallback: false,
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
  const rows = await legacyRows();

  for (const row of rows) {
    const profileId = Number(row.vault_profile_id);
    if (!Number.isInteger(profileId) || profileId <= 0) continue;
    const scopeId = String(row.id);
    try {
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "host",
        scopeId,
        SETTING_KEY,
      );
      if (existing) {
        result.hostsSkipped++;
        continue;
      }
      await pluginSettings.set(
        PLUGIN_ID,
        "host",
        scopeId,
        SETTING_KEY,
        JSON.stringify(profileId),
      );
      result.hostsMoved++;
    } catch (error) {
      databaseLogger.warn("Vault host settings migration failed for a host", {
        operation: "vault_settings_migration",
        hostId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // Decided once, on the first boot with the plugin: written either way, so
  // profiles created on a fresh install later never turn it on.
  try {
    const existing = await pluginSettings.get(
      PLUGIN_ID,
      "admin",
      null,
      "legacyCallback",
    );
    if (!existing || existing.value === null) {
      result.legacyCallback = rows.length > 0 || (await hadProfiles());
      await pluginSettings.set(
        PLUGIN_ID,
        "admin",
        null,
        "legacyCallback",
        JSON.stringify(result.legacyCallback),
      );
    }
  } catch (error) {
    databaseLogger.warn("Vault legacy callback migration failed", {
      operation: "vault_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (result.hostsMoved > 0) {
    databaseLogger.info(
      `Moved the Vault profile for ${result.hostsMoved} host(s) into plugin settings`,
      { operation: "vault_settings_migration" },
    );
  }
  return result;
}
