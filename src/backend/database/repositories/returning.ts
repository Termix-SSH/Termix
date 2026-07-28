import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import type { DatabaseContext } from "./database-context.js";
import { supportsReturning } from "./mutation-result.js";

/**
 * Writes that need the affected rows back.
 *
 * `mutation-result.ts` covers the call sites that only wanted a count. These are
 * the ones that genuinely read the rows — an updated record to return to the
 * caller, a deleted row's fields to clean up alongside it.
 *
 * SQLite and Postgres do this in one statement with RETURNING. MySQL has no
 * such clause, so the read is a second statement, and the pair has to be atomic:
 *
 * - **update** — write, then read. Reading first would return the old values.
 * - **delete** — read, then write. Reading after would return nothing.
 *
 * Both run in a transaction. Without one, a concurrent write between the two
 * statements makes the returned rows describe a state that never existed, and
 * with a connection pool the second statement might not even reach the same
 * connection.
 *
 * ## The one thing that will bite you
 *
 * On MySQL the update path re-reads using the same `where`. If the update
 * changes a column that `where` tests, the read finds nothing and you get `[]`
 * where SQLite would have given you the row. Every current caller filters on an
 * id it does not modify. **Check that before adding one that does.**
 */

/**
 * Row types come from the table, so call sites keep the typing they had with
 * `.returning()` and nothing has to be annotated by hand.
 */
/**
 * What `.set()` accepts: a column's own type, or a SQL expression in its place —
 * `updatedAt: sql`CURRENT_TIMESTAMP`` is the common one here.
 */
type UpdateValues<T extends SQLiteTable> = {
  [K in keyof T["$inferInsert"]]?: T["$inferInsert"][K] | SQL;
};

export async function updateReturning<T extends SQLiteTable>(
  context: DatabaseContext,
  table: T,
  values: UpdateValues<T>,
  where: SQL,
): Promise<T["$inferSelect"][]> {
  const db = context.drizzle;

  if (supportsReturning(context.dialect)) {
    // The cast resolves a conditional in drizzle's return type that TypeScript
    // cannot narrow while T is still generic. The runtime shape is the rows.
    return db.update(table).set(values).where(where).returning() as Promise<
      T["$inferSelect"][]
    >;
  }

  return db.transaction(async (tx) => {
    await tx.update(table).set(values).where(where);
    return tx.select().from(table).where(where);
  });
}

export async function deleteReturning<T extends SQLiteTable>(
  context: DatabaseContext,
  table: T,
  where: SQL,
): Promise<T["$inferSelect"][]> {
  const db = context.drizzle;

  if (supportsReturning(context.dialect)) {
    return db.delete(table).where(where).returning() as Promise<
      T["$inferSelect"][]
    >;
  }

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(table).where(where);
    await tx.delete(table).where(where);
    return rows;
  });
}
