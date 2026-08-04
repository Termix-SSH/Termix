import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `DB_FILE_ENCRYPTION=false` used to mean "start empty, every time".
 *
 * The database lives in memory on every backend and is serialised to disk after
 * writes; the flag only decides whether that file is ciphertext. The plain
 * branch wrote `db.sqlite` faithfully and then never read it back, so each
 * restart began with an empty database and silently discarded everything the
 * previous run had saved. The data-dir guard made it worse by confirming a
 * database was present in DATA_DIR immediately before it was thrown away.
 */
describe("unencrypted database persistence", () => {
  let dataDir: string;

  beforeEach(() => {
    dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-plain-db-"));
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

  /** A database file with one row, as a previous run would have left it. */
  function writeExistingDatabase(): void {
    const seed = new Database(":memory:");
    seed.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)");
    seed
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?)")
      .run("survives_restart", "yes");
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());
    seed.close();
  }

  it("reads back what an earlier run wrote", async () => {
    writeExistingDatabase();

    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();

    const row = db
      .getSqlite()
      .prepare("SELECT value FROM settings WHERE key = ?")
      .get("survives_restart") as { value: string } | undefined;

    expect(row?.value).toBe("yes");
  });

  it("starts empty when there is no file yet", async () => {
    const db = await import("../../../database/db/index.js");
    await db.initializeDatabase();

    // Startup creates its own tables; the point is that it does not throw on a
    // missing file and does not carry rows over from nowhere.
    const row = db
      .getSqlite()
      .prepare("SELECT COUNT(*) AS count FROM users")
      .get() as { count: number };

    expect(row.count).toBe(0);
  });

  it("ignores a zero-length file rather than failing to open it", async () => {
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), "");

    const db = await import("../../../database/db/index.js");
    await expect(db.initializeDatabase()).resolves.not.toThrow();
  });
});
