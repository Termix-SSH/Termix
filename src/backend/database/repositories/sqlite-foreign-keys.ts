import { getCurrentRepositorySqlite } from "./factory.js";

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

export async function withCurrentSqliteForeignKeysDisabled<T>(
  operation: () => Promise<T>,
): Promise<T> {
  return withSqliteForeignKeysDisabled(getCurrentRepositorySqlite(), operation);
}
