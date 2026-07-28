import type { DatabaseDialect } from "../db/dialect.js";

/**
 * Reading the outcome of a write without depending on RETURNING.
 *
 * SQLite and Postgres can attach `.returning()` to a delete or update and get
 * the affected rows back. **MySQL cannot** — it has no RETURNING clause, and
 * drizzle's mysql-core does not expose the method. 156 call sites here read a
 * write's result, so the difference has to be absorbed somewhere.
 *
 * The split that matters is what the caller actually needs:
 *
 * - **How many rows changed** — the majority. Every engine reports this, just
 *   differently: a returned array on sqlite/pg, `affectedRows` on MySQL.
 *   `rowsAffected` covers these with no query shape change.
 * - **The rows themselves** — cannot be emulated on MySQL without reading
 *   first, which needs a transaction to stay correct under concurrency. Those
 *   call sites are handled individually rather than behind a helper that hides
 *   an extra round trip.
 */

/** What MySQL's driver returns for a write. */
interface MySqlWriteResult {
  affectedRows?: number;
  insertId?: number;
}

/**
 * mysql2 hands back `[ResultSetHeader, fields]`, which is an array — so array
 * shape alone cannot distinguish it from a returning() result. The header is
 * identified by its own fields instead.
 */
function asMySqlHeader(result: unknown): MySqlWriteResult | null {
  const candidate =
    Array.isArray(result) && result.length > 0 ? result[0] : result;

  if (!candidate || typeof candidate !== "object") return null;
  const header = candidate as MySqlWriteResult;

  return typeof header.affectedRows === "number" ||
    typeof header.insertId === "number"
    ? header
    : null;
}

/**
 * Number of rows a write touched.
 *
 * Pass the result of a `.returning()` call on sqlite/pg, or the raw write
 * result on MySQL — both shapes are understood, so the caller does not branch.
 */
export function rowsAffected(result: unknown): number {
  const header = asMySqlHeader(result);
  if (header && typeof header.affectedRows === "number") {
    return header.affectedRows;
  }

  if (Array.isArray(result)) return result.length;
  return 0;
}

/**
 * Id assigned by an insert.
 *
 * sqlite and pg surface it through `.returning({ id })`; MySQL reports it as
 * `insertId` on the write result. Returns null when the table has no
 * autoincrement key, or the insert matched nothing.
 */
export function insertedId(result: unknown): number | null {
  const header = asMySqlHeader(result);
  if (header) {
    return typeof header.insertId === "number" && header.insertId > 0
      ? header.insertId
      : null;
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
