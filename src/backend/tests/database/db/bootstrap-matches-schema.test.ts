import fs from "fs";
import os from "os";
import path from "path";
import { getTableName, is, Table } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "../../../database/db/schema.js";

/**
 * SQLite tables are created by hand-written DDL in `db/index.ts`, not generated
 * from the drizzle schema. Adding a table to `schema.ts` alone therefore
 * type-checks, passes the repository tests (which build their fixture straight
 * from the schema), and still fails at runtime with "no such table".
 *
 * That is exactly how the automations tables shipped broken, so this compares
 * the two directly: every table drizzle knows about has to exist after boot.
 */
describe("bootstrap creates every table in the drizzle schema", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-schema-"));
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

  it("leaves no schema table missing from a fresh database", async () => {
    const expected = Object.values(schema)
      .filter((value) => is(value, Table))
      .map((table) => getTableName(table as Table))
      .sort();

    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();

    const present = new Set(
      db
        .getSqlite()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .pluck()
        .all() as string[],
    );

    expect(expected.filter((name) => !present.has(name))).toEqual([]);
  });
});
