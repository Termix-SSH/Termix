import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema.js";

/**
 * Engines the repository layer can run against. SQLite is the only one wired up
 * today; the alias exists so that adding another is a change in one place
 * rather than a hunt for string literals.
 */
export type DatabaseDialect = "sqlite";

/**
 * The database handle repositories work against.
 *
 * Typed as the SQLite instance on purpose. drizzle's three Database classes
 * share no base class and their signatures are incompatible: a union is not
 * callable, and a generic would have to be threaded through all 43
 * repositories and every method on them.
 *
 * This is a deliberate approximation, not an accident. The query-builder
 * surface the repositories actually use is the same on all three engines, and
 * that equivalence is asserted in multi-dialect.test.ts rather than assumed —
 * identifier quoting, placeholder style and value coercion are all covered
 * there. At runtime this may hold a Postgres or MySQL instance.
 *
 * The one place the surfaces genuinely differ is RETURNING, which MySQL lacks;
 * see mutation-result.ts for how that is absorbed.
 */
export type PortableDatabase = BetterSQLite3Database<typeof schema>;

/**
 * What a repository is allowed to touch.
 *
 * Deliberately drizzle-only: with no raw driver handle here, no repository can
 * reach for engine-specific SQL. Retention queries that previously needed
 * `datetime('now', ?)` compute their cutoff in JS instead — see
 * ./sql-timestamp.ts.
 */
export interface DatabaseContext {
  dialect: DatabaseDialect;
  drizzle: PortableDatabase;
}
