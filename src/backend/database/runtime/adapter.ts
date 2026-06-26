import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import type * as schema from "../db/schema.js";
import type { DatabaseDialect, DatabaseRuntimeConfig } from "./config.js";
import { SqliteDatabaseAdapter } from "./sqlite-adapter.js";

export interface DatabaseContext {
  dialect: DatabaseDialect;
  drizzle: BetterSQLite3Database<typeof schema>;
  sqlite?: BetterSqliteDatabase;
}

export interface DatabaseAdapter {
  readonly dialect: DatabaseDialect;
  connect(): Promise<DatabaseContext>;
  migrate(): Promise<void>;
  transaction<T>(fn: (tx: DatabaseContext) => T | Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export function createDatabaseAdapter(
  config: DatabaseRuntimeConfig,
): DatabaseAdapter {
  if (config.dialect === "sqlite") {
    return new SqliteDatabaseAdapter(config);
  }

  throw new Error(
    `${config.dialect} adapter is not implemented yet. Use sqlite for the first runtime slice.`,
  );
}
