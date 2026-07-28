import { eq, type SQL } from "drizzle-orm";
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core";
import type { DatabaseContext } from "./database-context.js";
import {
  insertedId,
  rowsAffected,
  supportsReturning,
} from "./mutation-result.js";

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
 * - **insert** — write, then read the row back by its key.
 * - **update** — write, then read. Reading first would return the old values.
 * - **delete** — read, then write. Reading after would return nothing.
 *
 * Both run in a transaction. Without one, a concurrent write between the two
 * statements makes the returned rows describe a state that never existed, and
 * with a connection pool the second statement might not even reach the same
 * connection.
 *
 * ## The trap, and why it cannot bite silently
 *
 * On MySQL the update path re-reads using the same `where`. If the update
 * changes a column that `where` tests, the read finds nothing — SQLite would
 * have returned the row. Every current caller filters on an id it does not
 * modify, but that is a convention, not a guarantee, so the mismatch is
 * detected and thrown rather than returned as an empty array. Same for an
 * insert whose row cannot be read back.
 *
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
    const written = await tx.update(table).set(values).where(where);
    const rows = await tx.select().from(table).where(where);

    // The trap this catches: if the update changed a column that `where` tests,
    // the read finds nothing and the caller gets [] — on MySQL only, with no
    // error, where SQLite would have returned the row. Rows changed but none
    // readable back is exactly that case, so make it loud instead.
    if (rows.length === 0 && rowsAffected(written) > 0) {
      throw new Error(
        `updateReturning wrote ${rowsAffected(written)} row(s) but could not read ` +
          `them back: the update changed a column the where clause filters on. ` +
          `Read the rows first, or filter on a column the update leaves alone.`,
      );
    }

    return rows;
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

/** A table this can read a single row back from. */
type Keyed = SQLiteTable & { id: SQLiteColumn };

/**
 * Inserts one row and returns it as stored, including whatever the database
 * filled in — defaults, an autoincrement id, a CURRENT_TIMESTAMP.
 *
 * This is the one case Postgres cannot shortcut either: without RETURNING there
 * is no id to read back by. Hence the split is genuinely three-way — except
 * that sqlite and pg both have RETURNING, so it collapses to two again.
 *
 * On MySQL the key comes from one of two places:
 *
 * - the caller supplied it (tables keyed by a text id, like `users`)
 * - the engine assigned it, reported as `insertId`
 *
 * Restricted to tables with an `id` column, so a table keyed some other way is
 * a compile error here rather than a row that silently fails to come back.
 */
export async function insertReturning<T extends Keyed>(
  context: DatabaseContext,
  table: T,
  values: T["$inferInsert"],
): Promise<T["$inferSelect"][]> {
  const db = context.drizzle;

  if (supportsReturning(context.dialect)) {
    return db.insert(table).values(values).returning() as Promise<
      T["$inferSelect"][]
    >;
  }

  return db.transaction(async (tx) => {
    const result = await tx.insert(table).values(values);

    const supplied = (values as { id?: string | number }).id;
    const key = supplied ?? insertedId(result);
    if (key === null || key === undefined) {
      throw new Error(
        `Insert into ${String(table)} returned no id to read the row back by.`,
      );
    }

    const rows = await tx.select().from(table).where(eq(table.id, key));
    if (rows.length === 0) {
      throw new Error(
        `Inserted into ${String(table)} but could not read the row back by id ${key}.`,
      );
    }
    return rows;
  });
}

/**
 * Inserts one row into a table keyed by something other than `id`, reading it
 * back by an explicit condition.
 *
 * `user_preferences` is keyed by `userId` and has no `id` column at all, so
 * there is no insertId to read back by — the caller has to say what identifies
 * the row it just wrote.
 */
export async function insertReturningWhere<T extends SQLiteTable>(
  context: DatabaseContext,
  table: T,
  values: T["$inferInsert"],
  where: SQL,
): Promise<T["$inferSelect"][]> {
  const db = context.drizzle;

  if (supportsReturning(context.dialect)) {
    return db.insert(table).values(values).returning() as Promise<
      T["$inferSelect"][]
    >;
  }

  return db.transaction(async (tx) => {
    await tx.insert(table).values(values);
    const rows = await tx.select().from(table).where(where);
    if (rows.length === 0) {
      throw new Error(
        `Inserted into ${String(table)} but the read-back condition matched nothing.`,
      );
    }
    return rows;
  });
}
