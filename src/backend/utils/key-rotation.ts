/**
 * Moves data to the current keys after a rotation.
 *
 * ENCRYPTION_KEY wraps every user's data key and seals installation secrets
 * (core settings and anything plugins store through ctx.secrets.seal). When
 * ENCRYPTION_KEY_PREVIOUS is set, reads fall back to the old key and this
 * pass rewrites everything with the new one. Once it reports nothing left on
 * an old key, ENCRYPTION_KEY_PREVIOUS can be removed.
 *
 * DATABASE_KEY only seals the SQLite file, which is rewritten on every save,
 * so a forced save is all it needs.
 */

import { sql, type SQL } from "drizzle-orm";
import { SystemCrypto } from "./system-crypto.js";
import { UserKeyManager } from "./user-keys.js";
import { resealSystemSecret } from "./system-secret-crypto.js";
import { databaseLogger } from "./logger.js";
import {
  resolveDatabaseDialect,
  type DatabaseDialect,
} from "../database/db/dialect.js";

const SEALED = /sysenc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]*/g;
const MARKER = "%sysenc:v1:%";

export interface RotationResult {
  rewrappedKeys: number;
  resealedValues: number;
  failedValues: number;
}

interface RawDb {
  all?: (query: SQL) => Promise<Array<Record<string, unknown>>>;
  run?: (query: SQL) => Promise<unknown>;
  execute?: (query: SQL) => Promise<unknown>;
}

async function rawDb(): Promise<RawDb> {
  const { getDb } = await import("../database/db/index.js");
  return getDb() as unknown as RawDb;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  // node-postgres answers { rows }, mysql2 answers [rows, fields].
  if (Array.isArray(result)) {
    return (Array.isArray(result[0]) ? result[0] : result) as Array<
      Record<string, unknown>
    >;
  }
  return ((result as { rows?: unknown[] }).rows ?? []) as Array<
    Record<string, unknown>
  >;
}

async function query(
  db: RawDb,
  dialect: DatabaseDialect,
  statement: SQL,
): Promise<Array<Record<string, unknown>>> {
  if (dialect === "sqlite") return db.all!(statement);
  return rowsOf(await db.execute!(statement));
}

async function exec(
  db: RawDb,
  dialect: DatabaseDialect,
  statement: SQL,
): Promise<void> {
  if (dialect === "sqlite") await db.run!(statement);
  else await db.execute!(statement);
}

/** Text columns of every table, where a sealed value could be stored. */
async function textColumns(
  db: RawDb,
  dialect: DatabaseDialect,
): Promise<Array<{ table: string; column: string }>> {
  if (dialect === "sqlite") {
    const tables = await query(
      db,
      dialect,
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    );
    const out: Array<{ table: string; column: string }> = [];
    for (const { name } of tables) {
      const table = String(name);
      const columns = await query(
        db,
        dialect,
        sql`SELECT name, type FROM pragma_table_info(${table})`,
      );
      for (const column of columns) {
        const type = String(column.type ?? "").toUpperCase();
        if (!type || /TEXT|CHAR|CLOB/.test(type)) {
          out.push({ table, column: String(column.name) });
        }
      }
    }
    return out;
  }
  const rows = await query(
    db,
    dialect,
    dialect === "postgres"
      ? sql`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = current_schema() AND data_type IN ('text', 'character varying')`
      : sql`SELECT table_name AS t, column_name AS c FROM information_schema.columns WHERE table_schema = DATABASE() AND data_type IN ('text', 'mediumtext', 'longtext', 'varchar')`,
  );
  return rows.map((row) => ({
    table: String(row.t ?? row.T),
    column: String(row.c ?? row.C),
  }));
}

/** Re-seals every embedded sealed value in text that used an older key. */
export async function resealText(
  text: string,
): Promise<{ text: string; changed: number; failed: number }> {
  let changed = 0;
  let failed = 0;
  let out = text;
  for (const match of new Set(text.match(SEALED) ?? [])) {
    try {
      const next = await resealSystemSecret(match);
      if (next) {
        out = out.split(match).join(next);
        changed++;
      }
    } catch {
      failed++;
    }
  }
  return { text: out, changed, failed };
}

async function resealAllSystemSecrets(): Promise<{
  resealed: number;
  failed: number;
}> {
  const dialect = resolveDatabaseDialect();
  const db = await rawDb();
  let resealed = 0;
  let failed = 0;
  for (const { table, column } of await textColumns(db, dialect)) {
    const t = sql.identifier(table);
    const c = sql.identifier(column);
    const rows = await query(
      db,
      dialect,
      sql`SELECT DISTINCT ${c} AS v FROM ${t} WHERE ${c} LIKE ${MARKER}`,
    );
    for (const row of rows) {
      const value = row.v;
      if (typeof value !== "string") continue;
      const result = await resealText(value);
      failed += result.failed;
      if (result.changed === 0) continue;
      // A sealed value has a random IV, so the old text is unique.
      await exec(
        db,
        dialect,
        sql`UPDATE ${t} SET ${c} = ${result.text} WHERE ${c} = ${value}`,
      );
      resealed += result.changed;
    }
  }
  return { resealed, failed };
}

/** Moves everything off previous keys. Safe to run on every start. */
export async function runKeyRotation(): Promise<RotationResult | null> {
  const system = SystemCrypto.getInstance();
  const previousEncryption = await system.getPreviousKeys("ENCRYPTION_KEY");
  const previousDatabase = await system.getPreviousKeys("DATABASE_KEY");
  if (previousEncryption.length === 0 && previousDatabase.length === 0) {
    return null;
  }

  const result: RotationResult = {
    rewrappedKeys: 0,
    resealedValues: 0,
    failedValues: 0,
  };
  if (previousEncryption.length > 0) {
    result.rewrappedKeys = await UserKeyManager.getInstance().rewrapAll();
    const secrets = await resealAllSystemSecrets();
    result.resealedValues = secrets.resealed;
    result.failedValues = secrets.failed;
  }

  const { DatabaseSaveTrigger } = await import("./database-save-trigger.js");
  await DatabaseSaveTrigger.forceSave("key_rotation");

  if (previousEncryption.length > 0) {
    if (result.failedValues === 0) {
      databaseLogger.success(
        "Everything now uses the current ENCRYPTION_KEY. ENCRYPTION_KEY_PREVIOUS can be removed",
        { operation: "key_rotation_done", ...result },
      );
    } else {
      databaseLogger.warn(
        "Some sealed values open with no known key and were left as they are",
        { operation: "key_rotation_incomplete", ...result },
      );
    }
  }
  if (previousDatabase.length > 0) {
    databaseLogger.success(
      "The database file is saved with the current DATABASE_KEY. DATABASE_KEY_PREVIOUS can be removed",
      { operation: "database_key_rotation_done" },
    );
  }
  return result;
}

/**
 * Admin rotation of an ENCRYPTION_KEY kept in .env: a new key, the old one
 * kept as previous, then the pass above.
 */
export async function rotateEncryptionKey(): Promise<RotationResult> {
  const system = SystemCrypto.getInstance();
  await system.rotateEncryptionKey();
  await UserKeyManager.getInstance().initialize();
  const { resetHashKey } = await import("../sync/store.js");
  resetHashKey();
  const result = (await runKeyRotation()) ?? {
    rewrappedKeys: 0,
    resealedValues: 0,
    failedValues: 0,
  };
  // SQLite keeps every value in a text column the pass reads. Postgres and
  // MySQL may hold sealed values in JSON columns it skips, so there the old
  // key stays until the admin removes it.
  if (result.failedValues === 0 && resolveDatabaseDialect() === "sqlite") {
    await system.forgetPreviousEncryptionKeys();
    await UserKeyManager.getInstance().initialize();
  }
  return result;
}
