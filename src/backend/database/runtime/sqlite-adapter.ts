import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import type { DatabaseRuntimeConfig } from "./config.js";
import type { DatabaseAdapter, DatabaseContext } from "./adapter.js";

export class SqliteDatabaseAdapter implements DatabaseAdapter {
  readonly dialect = "sqlite" as const;
  private sqlite: Database.Database | null = null;
  private context: DatabaseContext | null = null;

  constructor(private readonly config: DatabaseRuntimeConfig) {
    if (config.dialect !== "sqlite") {
      throw new Error("SqliteDatabaseAdapter requires sqlite config.");
    }
  }

  async connect(): Promise<DatabaseContext> {
    if (this.context) return this.context;

    const sqlitePath = this.config.sqlitePath || ":memory:";
    if (sqlitePath !== ":memory:") {
      fs.mkdirSync(path.dirname(sqlitePath), { recursive: true });
    }

    this.sqlite = new Database(sqlitePath);
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    if (sqlitePath !== ":memory:") {
      this.sqlite.exec("PRAGMA journal_mode = WAL");
    }

    this.context = {
      dialect: this.dialect,
      drizzle: drizzle(this.sqlite, { schema }),
      sqlite: this.sqlite,
    };

    return this.context;
  }

  async migrate(): Promise<void> {
    if (!this.sqlite) {
      throw new Error("SQLite adapter must be connected before migration.");
    }

    this.sqlite.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        checksum TEXT,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS system_migrations (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  async transaction<T>(
    fn: (tx: DatabaseContext) => T | Promise<T>,
  ): Promise<T> {
    const context = await this.connect();
    if (!this.sqlite) {
      throw new Error("SQLite adapter is not connected.");
    }

    const run = this.sqlite.transaction(() => {
      const result = fn(context);
      if (result instanceof Promise) {
        throw new Error(
          "SQLite adapter transactions must not return a Promise until async transaction support is introduced.",
        );
      }
      return result;
    });
    return run();
  }

  async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
      this.context = null;
    }
  }
}
