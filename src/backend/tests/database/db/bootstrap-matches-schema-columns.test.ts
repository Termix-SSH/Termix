import fs from "fs";
import os from "os";
import path from "path";
import { getTableColumns, getTableName, is, Table } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../database/db/schema.js";

/**
 * One level up from bootstrap-matches-schema.test.ts, which checks that every
 * TABLE exists. This checks every COLUMN.
 *
 * SQLite never runs the drizzle migrations at all -- runRemoteMigrations
 * throws for sqlite, and the live schema comes from hand-written DDL in
 * db/index.ts (a CREATE TABLE plus addColumnIfNotExists calls). So adding a
 * column to schema.ts and running `schema:migrations` type-checks, produces a
 * migration file, passes every repository test (their fixtures are built from
 * the schema), and still fails at runtime on the default dialect with "no such
 * column" -- breaking every write to that table.
 *
 * A grep- or token-based guard cannot catch this: db/index.ts refers to
 * columns as snake_case string arguments, never by the camelCase names the
 * schema uses. Only booting a real database and reading PRAGMA table_info
 * compares the two things that actually have to agree.
 */
describe("bootstrap creates every column in the drizzle schema", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-columns-"));
    vi.resetModules();
    process.env.DATA_DIR = dataDir;
    process.env.DB_FILE_ENCRYPTION = "false";
    process.env.ALLOW_EMPTY_DATA_DIR = "true";
  });

  afterEach(() => {
    delete process.env.DATA_DIR;
    delete process.env.DB_FILE_ENCRYPTION;
    delete process.env.ALLOW_EMPTY_DATA_DIR;
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  it("leaves no schema column missing from a fresh database", async () => {
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();
    const sqlite = db.getSqlite();

    const missing: string[] = [];

    for (const value of Object.values(schema)) {
      if (!is(value, Table)) continue;
      const tableName = getTableName(value as Table);

      const present = new Set(
        (
          sqlite
            .prepare(`PRAGMA table_info(${JSON.stringify(tableName)})`)
            .all() as Array<{ name: string }>
        ).map((row) => row.name),
      );
      // A table that does not exist at all is the sibling test's finding, not
      // this one's -- reporting it here too would just duplicate the failure.
      if (present.size === 0) continue;

      for (const column of Object.values(getTableColumns(value as Table))) {
        if (!present.has(column.name)) {
          missing.push(`${tableName}.${column.name}`);
        }
      }
    }

    expect(missing.sort()).toEqual([]);
  });
});
