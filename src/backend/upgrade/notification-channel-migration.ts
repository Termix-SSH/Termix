/**
 * Moves 2.8 notification channels into the alerts plugin.
 *
 * 2.8 kept them in core's notification_channels, each config encrypted under
 * its owner's data key. This copies every row into p_alerts_channels with the
 * same id, because automations' notify steps and links name it, then empties
 * the old config column so no webhook token or ntfy key stays behind.
 *
 * The plugin reads configs sealed with the installation key, so it can send
 * an alert with no user signed in. A config is resealed as soon as its
 * owner's data key opens: at boot for most users, at their next password
 * login for a 2.8 key only the password unwraps. Until then the channel shows
 * as needing to be saved again.
 *
 * The old table stays until 3.0.0, like the old columns. Idempotent.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import { resolveDatabaseDialect } from "../database/db/dialect.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { LazyFieldEncryption } from "../utils/lazy-field-encryption.js";
import {
  encryptSystemSecret,
  isSystemEncrypted,
} from "../utils/system-secret-crypto.js";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";

const TARGET = "p_alerts_channels";
const SOURCE = "notification_channels";

interface LegacyChannel {
  id: number;
  user_id: string;
  name: string;
  type: string;
  config: string | null;
  enabled: unknown;
  created_at: string | null;
}

export interface NotificationChannelMigrationResult {
  /** Channels copied into the plugin's table. */
  moved: number;
  /** Configs sealed with the installation key. */
  sealed: number;
}

async function tableExists(name: string): Promise<boolean> {
  try {
    await selectRows(sql`SELECT 1 FROM ${sql.identifier(name)} WHERE 1 = 0`);
    return true;
  } catch {
    return false;
  }
}

function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t";
}

/** Explicit ids leave a Postgres sequence behind them. */
async function syncSequence(): Promise<void> {
  if (resolveDatabaseDialect() !== "postgres") return;
  await runStatement(
    sql`SELECT setval(pg_get_serial_sequence(${TARGET}, 'id'), (SELECT COALESCE(MAX(id), 1) FROM ${sql.identifier(TARGET)}))`,
  );
}

/** The config in plain JSON, or null while the owner's key is closed. */
function openLegacyConfig(row: {
  id: number;
  user_id: string;
  config: string;
}): string | null {
  const dek = DataCrypto.getUserDataKey(row.user_id);
  if (!dek) return null;
  const plain = LazyFieldEncryption.safeGetFieldValue(
    row.config,
    dek,
    String(row.id),
    "config",
  );
  if (!plain) return null;
  try {
    JSON.parse(plain);
    return plain;
  } catch {
    return null;
  }
}

async function copyChannels(
  result: NotificationChannelMigrationResult,
): Promise<void> {
  if (!(await tableExists(SOURCE))) return;
  const rows = await selectRows<LegacyChannel>(
    sql`SELECT id, user_id, name, type, config, enabled, created_at FROM ${sql.identifier(SOURCE)} ORDER BY id`,
  );
  const sqlite = resolveDatabaseDialect() === "sqlite";
  let copied = false;
  for (const row of rows) {
    // Emptied once copied.
    if (!row.config) continue;
    const taken = await selectRows(
      sql`SELECT id FROM ${sql.identifier(TARGET)} WHERE id = ${row.id}`,
    );
    if (taken.length > 0) continue;
    const enabled = isOn(row.enabled);
    const createdAt = row.created_at ?? new Date().toISOString();
    await runStatement(
      sql`INSERT INTO ${sql.identifier(TARGET)} (id, user_id, name, type, config, enabled, created_at, updated_at) VALUES (${row.id}, ${row.user_id}, ${row.name}, ${row.type}, ${row.config}, ${sqlite ? (enabled ? 1 : 0) : enabled}, ${createdAt}, ${createdAt})`,
    );
    await runStatement(
      sql`UPDATE ${sql.identifier(SOURCE)} SET config = '' WHERE id = ${row.id}`,
    );
    copied = true;
    result.moved++;
  }
  if (copied) await syncSequence();
}

async function sealConfigs(
  result: NotificationChannelMigrationResult,
  onlyUserId?: string,
): Promise<void> {
  const rows = await selectRows<{
    id: number;
    user_id: string;
    config: string | null;
  }>(
    onlyUserId
      ? sql`SELECT id, user_id, config FROM ${sql.identifier(TARGET)} WHERE user_id = ${onlyUserId}`
      : sql`SELECT id, user_id, config FROM ${sql.identifier(TARGET)}`,
  );
  for (const row of rows) {
    if (!row.config || isSystemEncrypted(row.config)) continue;
    try {
      const plain = openLegacyConfig({
        id: Number(row.id),
        user_id: row.user_id,
        config: row.config,
      });
      if (!plain) continue;
      await runStatement(
        sql`UPDATE ${sql.identifier(TARGET)} SET config = ${await encryptSystemSecret(plain)} WHERE id = ${row.id}`,
      );
      result.sealed++;
    } catch (error) {
      databaseLogger.warn("Could not seal a notification channel's config", {
        operation: "notification_channel_migration",
        channelId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * Pass a user id to reseal only that user's channels, as a password login
 * does once it has opened a data key the boot run could not.
 */
export async function runNotificationChannelMigration(
  onlyUserId?: string,
): Promise<NotificationChannelMigrationResult> {
  const result: NotificationChannelMigrationResult = { moved: 0, sealed: 0 };
  try {
    if (!(await tableExists(TARGET))) return result;
    if (!onlyUserId) await copyChannels(result);
    await sealConfigs(result, onlyUserId);
  } catch (error) {
    databaseLogger.error("Notification channel migration failed", error, {
      operation: "notification_channel_migration",
    });
  }
  if (result.moved > 0 || result.sealed > 0) {
    databaseLogger.info("Moved notification channels into the alerts plugin", {
      operation: "notification_channel_migration",
      ...result,
    });
  }
  return result;
}
