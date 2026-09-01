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
 * Postgres and MySQL keep their constraints enabled. The portable importer
 * writes through repositories and handles individual row failures, so it must
 * still be allowed to run there; only SQLite needs this connection-local
 * relaxation for legacy backups whose rows are not dependency ordered.
 */
export async function withCurrentSqliteForeignKeysDisabled<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const dialect = resolveDatabaseDialect();
  if (!needsExplicitPersist(dialect)) {
    return operation();
  }

  return withSqliteForeignKeysDisabled(getCurrentRepositorySqlite(), operation);
}
