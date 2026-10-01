/**
 * Moves the AI assistant's settings and provider keys into the ai plugin.
 *
 * - settings.ai_globally_enabled and ai_private_endpoint_allowlist become the
 *   admin settings globallyEnabled and privateEndpoints (one host per line).
 * - user_preferences.ai_assistant_enabled and ai_read_only_commands become
 *   each user's enabled and allowReadOnlyCommands.
 * - ssh_data.enable_ai_assistant becomes the host setting enableAiAssistant.
 * - Each provider's api_key, encrypted under its owner's data key, becomes a
 *   ctx.secrets row "provider:<id>" for that owner, and the column is emptied
 *   so no key material is left in the plugin's table.
 *
 * The old columns stay in the database, unused: core's drizzle migrations
 * run before this does, so dropping them there would lose the data first.
 * The providers table is ai_providers until the plugin adopts it and
 * p_ai_providers after, so both names are tried.
 *
 * Idempotent: nothing is written where the plugin already has a row, and a
 * key is only cleared once its copy exists. Safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
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
  admin: string[];
  users: number;
  hosts: number;
  keys: number;
}

type Flag = number | boolean | string | null | undefined;

function isTrue(value: Flag): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function isSet(value: Flag): boolean {
  return value !== null && value !== undefined;
}

/** The legacy JSON array as the textarea the plugin now reads. */
export function allowlistToText(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .join("\n");
  } catch {
    return null;
  }
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
  const result: AiSettingsMigrationResult = {
    admin: [],
    users: 0,
    hosts: 0,
    keys: 0,
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

  const setIfMissing = async (
    scope: "admin" | "user" | "host",
    scopeId: string | null,
    key: string,
    value: unknown,
  ): Promise<boolean> => {
    const existing = await pluginSettings.get(PLUGIN_ID, scope, scopeId, key);
    if (existing) return false;
    await pluginSettings.set(
      PLUGIN_ID,
      scope,
      scopeId,
      key,
      JSON.stringify(value),
    );
    return true;
  };

  try {
    const settings = createCurrentSettingsRepository();
    const enabled = await settings.get("ai_globally_enabled");
    if (enabled !== null && enabled !== "") {
      if (await setIfMissing("admin", null, "globallyEnabled", isTrue(enabled)))
        result.admin.push("globallyEnabled");
    }
    const allowlist = await settings.get("ai_private_endpoint_allowlist");
    const text = allowlist ? allowlistToText(allowlist) : null;
    if (text !== null) {
      if (await setIfMissing("admin", null, "privateEndpoints", text))
        result.admin.push("privateEndpoints");
    }
  } catch (error) {
    warn("admin settings", error);
  }

  const users = await tryRows<{
    user_id: string;
    ai_assistant_enabled: Flag;
    ai_read_only_commands: Flag;
  }>(
    sql`SELECT user_id, ai_assistant_enabled, ai_read_only_commands FROM user_preferences`,
  );
  for (const row of users) {
    try {
      let moved = false;
      if (isSet(row.ai_assistant_enabled)) {
        moved =
          (await setIfMissing(
            "user",
            row.user_id,
            "enabled",
            isTrue(row.ai_assistant_enabled),
          )) || moved;
      }
      if (isSet(row.ai_read_only_commands)) {
        moved =
          (await setIfMissing(
            "user",
            row.user_id,
            "allowReadOnlyCommands",
            isTrue(row.ai_read_only_commands),
          )) || moved;
      }
      if (moved) result.users++;
    } catch (error) {
      warn("a user's settings", error);
    }
  }

  const hosts = await tryRows<{ id: number; enable_ai_assistant: Flag }>(
    sql`SELECT id, enable_ai_assistant FROM ssh_data`,
  );
  for (const row of hosts) {
    if (!isTrue(row.enable_ai_assistant)) continue;
    try {
      if (
        await setIfMissing("host", String(row.id), "enableAiAssistant", true)
      ) {
        result.hosts++;
      }
    } catch (error) {
      warn("a host's setting", error);
    }
  }

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

  if (
    result.admin.length > 0 ||
    result.users > 0 ||
    result.hosts > 0 ||
    result.keys > 0
  ) {
    databaseLogger.info("Moved AI assistant settings into the ai plugin", {
      operation: "ai_settings_migration",
      admin: result.admin.join(", "),
      users: result.users,
      hosts: result.hosts,
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
