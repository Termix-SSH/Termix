import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type * as schema from "../db/schema.js";

/**
 * Engines the repository layer can run against. SQLite is the only one wired up
 * today; the alias exists so that adding another is a change in one place
 * rather than a hunt for string literals.
 */
export type DatabaseDialect = "sqlite";

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
  drizzle: BetterSQLite3Database<typeof schema>;
}
