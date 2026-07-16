import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

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
      sqlite: this.sqlite,
    };

    return this.context;
  }

  async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
      this.context = null;
    }
  }
}
