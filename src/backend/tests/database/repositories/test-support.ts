import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../../../database/db/schema.js";
import type { DatabaseContext } from "../../../database/repositories/database-context.js";

export class TestSqliteDatabase {
  private sqlite: Database.Database | null = null;
  private context: DatabaseContext | null = null;

  async connect(): Promise<DatabaseContext> {
    if (this.context) return this.context;

    this.sqlite = new Database(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.context = {
      dialect: "sqlite",
      drizzle: drizzle(this.sqlite, { schema }),
    };

    return this.context;
  }

  /**
   * Schema setup for tests. Lives on the fixture rather than on
   * DatabaseContext, which is drizzle-only so that no repository can reach for
   * engine-specific SQL.
   */
  /** Raw handle for assertions that read the database directly. Tests only. */
  get raw(): Database.Database {
    if (!this.sqlite) {
      throw new Error("connect() must be called before raw access");
    }
    return this.sqlite;
  }

  exec(sql: string): void {
    if (!this.sqlite) {
      throw new Error("connect() must be called before exec()");
    }
    this.sqlite.exec(sql);
  }

  async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
      this.context = null;
    }
  }
}
