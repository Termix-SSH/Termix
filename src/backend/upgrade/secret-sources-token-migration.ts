/**
 * Moves each secret source's access token out of secret_sources.token,
 * encrypted under its owner's data key, into a ctx.secrets row "source:<id>"
 * for that owner, encrypted under the installation key - the same move the
 * ai plugin made for provider API keys. The column is then emptied so no
 * token material is left in the adopted table.
 *
 * The old column stays in the database, unused, until this runs: core's
 * drizzle migrations run before this does, so dropping it there would lose
 * the token first. The table is secret_sources until the plugin adopts it
 * and p_secret_sources_sources after, so both names are tried.
 *
 * Idempotent: a source whose ctx.secrets row already exists is skipped, and
 * a token is only cleared once its copy exists. Safe on every boot.
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

const PLUGIN_ID = "secret-sources";

export interface SecretSourcesTokenMigrationResult {
  moved: number;
}

async function tryRows<T>(query: ReturnType<typeof sql>): Promise<T[]> {
  try {
    return await selectRows<T>(query);
  } catch {
    // A fresh install never had the table or column.
    return [];
  }
}

export async function runSecretSourcesTokenMigration(): Promise<SecretSourcesTokenMigrationResult> {
  const result: SecretSourcesTokenMigrationResult = { moved: 0 };

  // plugin_settings has a foreign key to plugins: nothing to migrate into
  // until the plugin row exists.
  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
  } catch {
    return result;
  }

  const pluginSettings = createCurrentPluginSettingsRepository();

  for (const table of ["secret_sources", "p_secret_sources_sources"]) {
    const rows = await tryRows<{
      id: string;
      user_id: string;
      token: string | null;
    }>(
      sql`SELECT id, user_id, token FROM ${sql.identifier(table)} WHERE token IS NOT NULL AND token <> ''`,
    );
    for (const row of rows) {
      try {
        const key = `source:${row.id}`;
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
            row.token as string,
            dek,
            row.id,
            "token",
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
          result.moved++;
        }
        await runStatement(
          sql`UPDATE ${sql.identifier(table)} SET token = NULL WHERE id = ${row.id}`,
        );
      } catch (error) {
        databaseLogger.warn("Secret source token migration failed for a row", {
          operation: "secret_sources_token_migration",
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (result.moved > 0) {
    databaseLogger.info(
      `Moved ${result.moved} secret source token(s) into the secret-sources plugin`,
      { operation: "secret_sources_token_migration" },
    );
  }

  return result;
}
