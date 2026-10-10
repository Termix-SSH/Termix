import { describe, expect, it } from "vitest";
import {
  assertNotPre29Database,
  PRE_29_DATABASE_ERROR,
} from "../../../database/db/upgrade-guard.js";

const tables = (...names: string[]) => (name: string) => names.includes(name);

describe("assertNotPre29Database", () => {
  it("refuses a 2.8 database, which has hosts and plugins but no plugin_migrations", async () => {
    await expect(
      assertNotPre29Database(tables("ssh_data", "plugins")),
    ).rejects.toThrow(PRE_29_DATABASE_ERROR);
  });

  it("opens a database 2.9 has upgraded", async () => {
    await expect(
      assertNotPre29Database(tables("ssh_data", "plugins", "plugin_migrations")),
    ).resolves.toBeUndefined();
  });

  it("opens a new database", async () => {
    await expect(assertNotPre29Database(tables())).resolves.toBeUndefined();
  });
});

describe("a real 2.8.0 schema", () => {
  it("is refused", async () => {
    const { default: Database } = await import("better-sqlite3");
    const fs = await import("node:fs");
    const db = new Database(":memory:");
    db.exec(
      fs.readFileSync(
        new URL("../../fixtures/sqlite-2.8-schema.sql", import.meta.url),
        "utf8",
      ),
    );
    const has = (name: string) =>
      !!db
        .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name);
    await expect(assertNotPre29Database(has)).rejects.toThrow(
      PRE_29_DATABASE_ERROR,
    );
    db.close();
  });
});
