import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import type { Database as BetterSqliteDatabase } from "better-sqlite3";
import type * as schema from "../db/schema.js";

export interface DatabaseContext {
  dialect: "sqlite";
  drizzle: BetterSQLite3Database<typeof schema>;
  sqlite?: BetterSqliteDatabase;
}
