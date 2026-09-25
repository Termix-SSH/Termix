/**
 * Moves 2.8 TOTP enrolments into the totp plugin.
 *
 * 1. Every user_second_factors row A8 wrote for core's TOTP ("core"/"totp")
 *    becomes the plugin's ("totp"/"totp"), and every user with
 *    users.totp_enabled gets one. This runs whether or not the plugin is
 *    enabled, so those users stay behind a second factor: with the plugin off
 *    the login fails closed instead of skipping it.
 * 2. Once the plugin's p_totp_enrollments table exists, each enabled user's
 *    secret and backup codes are decrypted with their data key and written
 *    there sealed with the installation key (what ctx.secrets.seal writes),
 *    then the users columns are cleared.
 *
 * The columns stay in the database until 3.0.0, since core's drizzle
 * migrations run before this does. A user whose data key cannot be opened
 * at boot is skipped and tried again on the next one. Idempotent.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { LazyFieldEncryption } from "../utils/lazy-field-encryption.js";
import { encryptSystemSecret } from "../utils/system-secret-crypto.js";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";

const PLUGIN_ID = "totp";
const FACTOR_ID = "totp";
const ENROLLMENTS_TABLE = "p_totp_enrollments";

export interface TotpMigrationResult {
  /** user_second_factors rows written or moved to the plugin. */
  factors: number;
  /** Secrets moved into the plugin's table. */
  secrets: number;
}

interface LegacyTotpUser {
  id: string;
  totp_enabled: unknown;
  totp_secret: string | null;
  totp_backup_codes: string | null;
}

async function tryRows<T>(query: ReturnType<typeof sql>): Promise<T[] | null> {
  try {
    return await selectRows<T>(query);
  } catch {
    // A fresh install never had the column or the table.
    return null;
  }
}

function isOn(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "t";
}

function readBackupCodes(
  stored: string | null,
  dek: Buffer,
  userId: string,
): string[] {
  if (!stored) return [];
  const raw = LazyFieldEncryption.safeGetFieldValue(
    stored,
    dek,
    userId,
    "totpBackupCodes",
  );
  try {
    const codes = raw ? JSON.parse(raw) : [];
    return Array.isArray(codes)
      ? codes.filter((code): code is string => typeof code === "string")
      : [];
  } catch {
    return [];
  }
}

async function factorUsers(pluginId: string): Promise<Set<string>> {
  const rows = await selectRows<{ user_id: string }>(
    sql`SELECT user_id FROM user_second_factors WHERE plugin_id = ${pluginId} AND factor_id = ${FACTOR_ID}`,
  );
  return new Set(rows.map((row) => row.user_id));
}

/**
 * Pass a user id to move only that user, as a password login does once it
 * has opened a data key the boot run could not.
 */
export async function runTotpMigration(
  onlyUserId?: string,
): Promise<TotpMigrationResult> {
  const result: TotpMigrationResult = { factors: 0, secrets: 0 };

  try {
    const enrolled = await factorUsers(PLUGIN_ID);

    for (const userId of await factorUsers("core")) {
      if (enrolled.has(userId)) {
        await runStatement(
          sql`DELETE FROM user_second_factors WHERE user_id = ${userId} AND plugin_id = 'core' AND factor_id = ${FACTOR_ID}`,
        );
      } else {
        await runStatement(
          sql`UPDATE user_second_factors SET plugin_id = ${PLUGIN_ID} WHERE user_id = ${userId} AND plugin_id = 'core' AND factor_id = ${FACTOR_ID}`,
        );
        enrolled.add(userId);
        result.factors++;
      }
    }

    const users = (
      (await tryRows<LegacyTotpUser>(
        onlyUserId
          ? sql`SELECT id, totp_enabled, totp_secret, totp_backup_codes FROM users WHERE id = ${onlyUserId}`
          : sql`SELECT id, totp_enabled, totp_secret, totp_backup_codes FROM users`,
      )) ?? []
    ).filter((user) => isOn(user.totp_enabled));

    for (const user of users) {
      if (enrolled.has(user.id)) continue;
      await runStatement(
        sql`INSERT INTO user_second_factors (user_id, plugin_id, factor_id) VALUES (${user.id}, ${PLUGIN_ID}, ${FACTOR_ID})`,
      );
      enrolled.add(user.id);
      result.factors++;
    }

    const moved = await tryRows<{ user_id: string }>(
      sql`SELECT user_id FROM ${sql.identifier(ENROLLMENTS_TABLE)}`,
    );
    if (moved) {
      const done = new Set(moved.map((row) => row.user_id));
      for (const user of users) {
        if (done.has(user.id) || !user.totp_secret) continue;
        try {
          const dek = DataCrypto.getUserDataKey(user.id);
          if (!dek) continue;
          const secret = LazyFieldEncryption.safeGetFieldValue(
            user.totp_secret,
            dek,
            user.id,
            "totpSecret",
          );
          if (!secret) continue;
          const codes = readBackupCodes(user.totp_backup_codes, dek, user.id);
          await runStatement(
            sql`INSERT INTO ${sql.identifier(ENROLLMENTS_TABLE)} (user_id, secret, backup_codes) VALUES (${user.id}, ${await encryptSystemSecret(secret)}, ${await encryptSystemSecret(JSON.stringify(codes))})`,
          );
          await runStatement(
            sql`UPDATE users SET totp_enabled = FALSE, totp_secret = NULL, totp_backup_codes = NULL WHERE id = ${user.id}`,
          );
          result.secrets++;
        } catch (error) {
          databaseLogger.warn("TOTP migration failed for a user", {
            operation: "totp_migration",
            userId: user.id,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  } catch (error) {
    databaseLogger.error("TOTP migration failed", error, {
      operation: "totp_migration",
    });
  }

  if (result.factors > 0 || result.secrets > 0) {
    databaseLogger.info("Moved TOTP enrolment into the totp plugin", {
      operation: "totp_migration",
      ...result,
    });
  }
  return result;
}
