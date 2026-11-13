import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getDatabaseKey: async () => Buffer.alloc(32, 5),
      getPreviousKeys: async () => [],
    }),
  },
}));

const { DatabaseMigration } = await import("../../utils/database-migration.js");
const { DatabaseFileEncryption } =
  await import("../../utils/database-file-encryption.js");

let dir: string;
const plain = () => path.join(dir, "db.sqlite");
const encrypted = () => path.join(dir, "db.sqlite.encrypted");

function makePlainDb(rows = 3) {
  const db = new Database(plain());
  db.exec("create table notes (id integer primary key, body text)");
  const insert = db.prepare("insert into notes (body) values (?)");
  for (let i = 0; i < rows; i++) insert.run(`note ${i}`);
  db.close();
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-migrate-"));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("checkMigrationStatus", () => {
  it("knows a fresh install", () => {
    expect(new DatabaseMigration(dir).checkMigrationStatus()).toMatchObject({
      needsMigration: false,
      hasUnencryptedDb: false,
      hasEncryptedDb: false,
    });
  });

  it("asks to migrate a plain database", () => {
    makePlainDb();
    const status = new DatabaseMigration(dir).checkMigrationStatus();
    expect(status.needsMigration).toBe(true);
    expect(status.unencryptedDbSize).toBeGreaterThan(0);
  });

  it("leaves an encrypted database alone and drops an empty plain one next to it", async () => {
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(
      Buffer.from("x"),
      encrypted(),
    );
    expect(new DatabaseMigration(dir).checkMigrationStatus().reason).toMatch(
      /Only encrypted/,
    );
    fs.writeFileSync(plain(), "");
    expect(
      new DatabaseMigration(dir).checkMigrationStatus().needsMigration,
    ).toBe(false);
    expect(fs.existsSync(plain())).toBe(false);
  });

  it("refuses to pick one when both have data", async () => {
    makePlainDb();
    await DatabaseFileEncryption.encryptDatabaseFromBuffer(
      Buffer.from("x"),
      encrypted(),
    );
    const status = new DatabaseMigration(dir).checkMigrationStatus();
    expect(status.needsMigration).toBe(false);
    expect(status.reason).toMatch(/Skipping migration for safety/);
    expect(fs.existsSync(plain())).toBe(true);
  });
});

describe("migrateDatabase", () => {
  it("encrypts the data, keeps a backup and moves the plain file aside", async () => {
    makePlainDb(4);
    const result = await new DatabaseMigration(dir).migrateDatabase();
    expect(result).toMatchObject({ success: true, migratedRows: 4 });
    expect(result.migratedTables).toBeGreaterThanOrEqual(1);
    expect(fs.existsSync(plain())).toBe(false);
    expect(fs.existsSync(result.backupPath!)).toBe(true);
    expect(fs.readdirSync(dir).some((f) => f.includes(".migrated-"))).toBe(
      true,
    );
    const buffer =
      await DatabaseFileEncryption.decryptDatabaseToBuffer(encrypted());
    const db = new Database(buffer);
    expect(db.prepare("select count(*) as n from notes").get()).toEqual({
      n: 4,
    });
    db.close();
  });

  it("reports a failure instead of throwing", async () => {
    const result = await new DatabaseMigration(dir).migrateDatabase();
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Backup creation failed/);
  });
});

describe("cleanupOldBackups", () => {
  it("keeps the newest three of each kind", () => {
    const stamp = (i: number) =>
      new Date(Date.UTC(2026, 0, 1, 0, 0, i))
        .toISOString()
        .replace(/[:.]/g, "-");
    for (let i = 0; i < 5; i++) {
      for (const kind of ["migration-backup", "migrated"]) {
        const file = path.join(dir, `db.sqlite.${kind}-${stamp(i)}`);
        fs.writeFileSync(file, "x");
        const time = new Date(Date.UTC(2026, 0, 1, 0, 0, i));
        fs.utimesSync(file, time, time);
      }
    }
    fs.writeFileSync(path.join(dir, "unrelated.txt"), "x");
    new DatabaseMigration(dir).cleanupOldBackups();
    const left = fs.readdirSync(dir);
    expect(left.filter((f) => f.includes("migration-backup"))).toHaveLength(3);
    expect(left.filter((f) => f.includes(".migrated-"))).toHaveLength(3);
    expect(left).toContain("unrelated.txt");
    expect(left.some((f) => f.endsWith(stamp(0)))).toBe(false);
  });

  it("does not throw when the folder is gone", () => {
    expect(() =>
      new DatabaseMigration(path.join(dir, "missing")).cleanupOldBackups(),
    ).not.toThrow();
  });
});
