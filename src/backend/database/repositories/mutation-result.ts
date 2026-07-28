import type { DatabaseDialect } from "../db/dialect.js";

/**
 * Reading the outcome of a write without depending on RETURNING.
 *
 * SQLite and Postgres can attach `.returning()` to a delete or update and get
 * the affected rows back. **MySQL cannot** — it has no RETURNING clause, and
 * drizzle's mysql-core does not expose the method at all, so the call is a
 * TypeError rather than a bad query. 175 call sites here read a write's result,
 * so the difference has to be absorbed somewhere.
 *
 * The split that matters is what the caller actually needs:
 *
 * - **How many rows changed** — the majority, and none of them need the rows.
 *   They used to ask for them anyway, via `.returning().length`. Dropping the
 *   `.returning()` and reading the driver's own count is both portable and one
 *   less thing for the database to send back.
 * - **The rows themselves** — cannot be emulated on MySQL without reading
 *   first, which needs a transaction to stay correct under concurrency. Those
 *   call sites are handled individually rather than behind a helper that hides
 *   an extra round trip.
 */

/**
 * The count each driver reports for a write, under its own name.
 *
 * Every engine says how many rows a write touched. None of them agree on what
 * to call it:
 *
 * | driver         | shape                                  |
 * |----------------|----------------------------------------|
 * | better-sqlite3 | `{ changes, lastInsertRowid }`         |
 * | node-postgres  | `{ rowCount, rows, command }`          |
 * | mysql2         | `[{ affectedRows, insertId }, fields]` |
 *
 * These are the shapes returned when NO `.returning()` is attached — which is
 * the portable way to write, since MySQL has no RETURNING clause at all.
 */
interface WriteHeader {
  changes?: number;
  rowCount?: number;
  affectedRows?: number;
  lastInsertRowid?: number | bigint;
  insertId?: number;
}

const COUNT_FIELDS = ["changes", "rowCount", "affectedRows"] as const;

/**
 * mysql2 hands back `[ResultSetHeader, fields]`, which is itself an array — so
 * "is it an array" cannot distinguish a write header from a returning() result.
 * The header is identified by carrying one of the fields above instead.
 */
function asWriteHeader(result: unknown): WriteHeader | null {
  const candidate =
    Array.isArray(result) && result.length > 0 ? result[0] : result;

  if (!candidate || typeof candidate !== "object") return null;
  const header = candidate as WriteHeader;

  const known =
    COUNT_FIELDS.some((field) => typeof header[field] === "number") ||
    typeof header.insertId === "number" ||
    typeof header.lastInsertRowid === "number" ||
    typeof header.lastInsertRowid === "bigint";

  return known ? header : null;
}

/**
 * Number of rows a write touched.
 *
 * Pass the result of the write itself — every driver's header is understood, so
 * the caller neither branches on the dialect nor attaches `.returning()` just to
 * count what came back.
 *
 * A `.returning()` array is still accepted, for the call sites that need the
 * rows for their own reasons and would rather not count them twice.
 */
export function rowsAffected(result: unknown): number {
  const header = asWriteHeader(result);
  if (header) {
    for (const field of COUNT_FIELDS) {
      const count = header[field];
      if (typeof count === "number") return count;
    }
    // A header with only insertId: one row went in.
    return 0;
  }

  if (Array.isArray(result)) return result.length;
  return 0;
}

/**
 * Id assigned by an insert.
 *
 * **Only meaningful on the result of an insert.** SQLite's `lastInsertRowid` and
 * MySQL's `insertId` are connection-level values that survive the statement that
 * set them — after a delete, SQLite still reports whatever the last insert
 * produced. Passing an update or delete result here gets a stale id, not null.
 *
 * Returns null when the table has no autoincrement key.
 */
export function insertedId(result: unknown): number | null {
  const header = asWriteHeader(result);
  if (header) {
    // MySQL and SQLite both use 0 for "no autoincrement column".
    if (typeof header.insertId === "number") {
      return header.insertId > 0 ? header.insertId : null;
    }
    if (typeof header.lastInsertRowid === "bigint") {
      return header.lastInsertRowid > 0n
        ? Number(header.lastInsertRowid)
        : null;
    }
    if (typeof header.lastInsertRowid === "number") {
      return header.lastInsertRowid > 0 ? header.lastInsertRowid : null;
    }
    return null;
  }

  if (Array.isArray(result)) {
    const first = result[0] as { id?: unknown } | undefined;
    return typeof first?.id === "number" ? first.id : null;
  }

  return null;
}

/**
 * Whether `.returning()` can be attached to a write on this engine.
 *
 * Call sites that genuinely need the affected rows use this to choose between
 * one statement and a read-then-write inside a transaction.
 */
export function supportsReturning(dialect: DatabaseDialect): boolean {
  return dialect !== "mysql";
}

/**
 * Reads an aggregate count as a number.
 *
 * `sql<number>` is a type assertion, not a conversion. Postgres returns COUNT()
 * as bigint, which node-postgres hands back as a **string** so that values past
 * 2^53 survive — so the annotation is a lie there and comparisons like
 * `count < max` compare a string to a number.
 */
export function countValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}
