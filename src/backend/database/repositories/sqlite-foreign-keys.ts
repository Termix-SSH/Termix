import { getCurrentRepositorySqlite } from "./factory.js";
import { needsExplicitPersist, resolveDatabaseDialect } from "../db/dialect.js";

export interface SqliteForeignKeyClient {
  exec(sql: string): unknown;
}

export async function withSqliteForeignKeysDisabled<T>(
  sqlite: SqliteForeignKeyClient,
  operation: () => Promise<T>,
): Promise<T> {
  sqlite.exec("PRAGMA foreign_keys = OFF");
  try {
    return await operation();
  } finally {
    sqlite.exec("PRAGMA foreign_keys = ON");
  }
}

/**
 * Runs a bulk import with foreign keys relaxed.
 *
 * Backup restore writes tables in an order that is not dependency-safe, so the
 * constraints have to stand down for the duration.
 *
 * **This has no equivalent on Postgres or MySQL here.** Postgres needs
 * superuser to disable triggers, and MySQL's `SET FOREIGN_KEY_CHECKS = 0` is
 * per-connection, which a pool does not guarantee. Rather than run the import
 * with constraints enforced and have it fail partway through — leaving a
 * half-restored database — it refuses with a message that says why.
 */
export async function withCurrentSqliteForeignKeysDisabled<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const dialect = resolveDatabaseDialect();
  if (!needsExplicitPersist(dialect)) {
    throw new Error(
      `Importing a backup is only supported on SQLite; this deployment uses ${dialect}. ` +
        `Restore into the database directly with its own tooling instead.`,
    );
  }

  return withSqliteForeignKeysDisabled(getCurrentRepositorySqlite(), operation);
}
