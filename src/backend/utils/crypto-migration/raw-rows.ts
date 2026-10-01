/**
 * Raw SQL for boot migrations that read columns schema.ts no longer declares.
 *
 * getDb() is typed as the SQLite database, but on Postgres and MySQL it is
 * that engine's drizzle instance, which has execute() instead of all() and
 * run(). These two pick whichever exists.
 */

import type { SQL } from "drizzle-orm";
import { getDb } from "../../database/db/index.js";

type AnyDb = {
  all?: (query: SQL) => Promise<unknown[]> | unknown[];
  run?: (query: SQL) => unknown;
  execute?: (query: SQL) => Promise<unknown>;
};

export async function selectRows<T>(query: SQL): Promise<T[]> {
  const db = getDb() as unknown as AnyDb;
  if (typeof db.all === "function") return (await db.all(query)) as T[];
  const result = await db.execute!(query);
  // node-postgres returns { rows }, mysql2 returns [rows, fields].
  if (Array.isArray(result)) return result[0] as T[];
  return ((result as { rows?: unknown[] }).rows ?? []) as T[];
}

export async function runStatement(query: SQL): Promise<void> {
  const db = getDb() as unknown as AnyDb;
  if (typeof db.run === "function") {
    await db.run(query);
    return;
  }
  await db.execute!(query);
}

/**
 * A legacy boolean column read raw: SQLite and MySQL hand back 0/1, Postgres
 * true/false. A column that was never set keeps its old default.
 */
export function legacyFlag(value: unknown, defaultOn: boolean): boolean {
  if (value === null || value === undefined) return defaultOn;
  if (typeof value === "string") return value === "1" || value === "true";
  return !!value;
}

/**
 * selectRows for a boot copy out of a column schema.ts no longer declares. A
 * database created after the column left never had it, so a failed read
 * means there is nothing to copy rather than an error.
 */
export async function selectLegacyRows<T>(query: SQL): Promise<T[]> {
  try {
    return await selectRows<T>(query);
  } catch {
    return [];
  }
}
