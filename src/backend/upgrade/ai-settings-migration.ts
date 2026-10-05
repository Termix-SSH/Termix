/**
 * Moves each AI provider's api_key, encrypted under its owner's data key,
 * into a ctx.secrets row "provider:<id>" for that owner, and empties the
 * column so no key material is left in the plugin's table. It needs the
 * owner's data key, so it runs on every boot until the key opens.
 *
 * The providers table is ai_providers until the plugin adopts it and
 * p_ai_providers after, so both names are tried.
 *
 * Idempotent: a key is only cleared once its copy exists.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../database/repositories/factory.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { LazyFieldEncryption } from "../utils/lazy-field-encryption.js";
import { encryptSystemSecret } from "../utils/system-secret-crypto.js";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";

const PLUGIN_ID = "ai";

export interface AiSettingsMigrationResult {
  keys: number;
}

async function tryRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  try {
    return await selectRows<T>(query);
  } catch {
    // A fresh install never had the table or column.
    return [];
  }
}

export async function runAiSettingsMigration(): Promise<AiSettingsMigrationResult> {
  const result: AiSettingsMigrationResult = { keys: 0 };

  // plugin_settings has a foreign key to plugins: nothing to migrate into
  // until the plugin row exists.
  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
  } catch {
    return result;
  }

  const pluginSettings = createCurrentPluginSettingsRepository();

  for (const table of ["ai_providers", "p_ai_providers"]) {
    const providers = await tryRows<{
      id: number;
      user_id: string;
      api_key: string | null;
    }>(
      sql`SELECT id, user_id, api_key FROM ${sql.identifier(table)} WHERE api_key IS NOT NULL AND api_key <> ''`,
    );
    for (const row of providers) {
      try {
        const key = `provider:${row.id}`;
        const existing = await pluginSettings.get(
          PLUGIN_ID,
          "secret",
          row.user_id,
          key,
        );
        if (!existing) {
          const dek = DataCrypto.getUserDataKey(row.user_id);
          if (!dek) continue;
          const plaintext = LazyFieldEncryption.safeGetFieldValue(
            row.api_key as string,
            dek,
            String(row.id),
            "apiKey",
          );
          if (!plaintext) continue;
          await pluginSettings.set(
            PLUGIN_ID,
            "secret",
            row.user_id,
            key,
            JSON.stringify(await encryptSystemSecret(plaintext)),
            true,
          );
          result.keys++;
        }
        await runStatement(
          sql`UPDATE ${sql.identifier(table)} SET api_key = NULL WHERE id = ${row.id}`,
        );
      } catch (error) {
        warn("a provider key", error);
      }
    }
  }

  if (result.keys > 0) {
    databaseLogger.info("Moved AI provider keys into the ai plugin", {
      operation: "ai_settings_migration",
      keys: result.keys,
    });
  }

  return result;
}

function warn(what: string, error: unknown): void {
  // A failed copy must not stop the backend; the next boot tries again.
  databaseLogger.warn(`AI settings migration failed for ${what}`, {
    operation: "ai_settings_migration",
    error: error instanceof Error ? error.message : String(error),
  });
}
