import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import {
  PERFORMANCE_INDEXES,
  createPerformanceIndexes,
} from "../../../database/db/performance-indexes.js";

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

function seedSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE ssh_data (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      folder TEXT,
      parent_host_id INTEGER,
      credential_id INTEGER
    );
    CREATE TABLE host_access (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      host_id INTEGER NOT NULL,
      user_id TEXT,
      role_id INTEGER,
      expires_at TEXT
    );
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);
}

function indexNames(db: Database.Database): string[] {
  return db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
    .all()
    .map((row) => (row as { name: string }).name);
}

describe("createPerformanceIndexes", () => {
  it("creates the indexes for tables that exist", () => {
    const db = new Database(":memory:");
    seedSchema(db);

    const summary = createPerformanceIndexes(db, [
      { name: "idx_ssh_data_user_id", table: "ssh_data", columns: "user_id" },
      {
        name: "idx_audit_logs_user_ts",
        table: "audit_logs",
        columns: "user_id, timestamp",
      },
    ]);

    expect(summary).toMatchObject({ created: 2, skipped: 0, failed: 0 });
    expect(indexNames(db)).toEqual(
      expect.arrayContaining(["idx_ssh_data_user_id", "idx_audit_logs_user_ts"]),
    );

    db.close();
  });

  it("is safe to run repeatedly", () => {
    const db = new Database(":memory:");
    seedSchema(db);

    const first = createPerformanceIndexes(db);
    const second = createPerformanceIndexes(db);

    expect(second.created).toBe(first.created);
    expect(second.failed).toBe(0);

    db.close();
  });

  it("skips tables this install has not created instead of failing", () => {
    const db = new Database(":memory:");
    seedSchema(db);

    const summary = createPerformanceIndexes(db, [
      { name: "idx_missing", table: "not_a_table", columns: "user_id" },
      { name: "idx_ssh_data_user_id", table: "ssh_data", columns: "user_id" },
    ]);

    expect(summary).toMatchObject({ created: 1, skipped: 1, failed: 0 });

    db.close();
  });

  it("skips columns an older schema has not added yet", () => {
    const db = new Database(":memory:");
    db.exec("CREATE TABLE ssh_data (id INTEGER PRIMARY KEY, user_id TEXT)");

    const summary = createPerformanceIndexes(db, [
      {
        name: "idx_ssh_data_parent_host",
        table: "ssh_data",
        columns: "parent_host_id",
      },
    ]);

    expect(summary).toMatchObject({ created: 0, skipped: 1, failed: 0 });

    db.close();
  });

  it("actually uses the index for the host list query", () => {
    const db = new Database(":memory:");
    seedSchema(db);
    createPerformanceIndexes(db);

    const plan = db
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM ssh_data WHERE user_id = ?")
      .all("user-1")
      .map((row) => (row as { detail: string }).detail)
      .join(" ");

    expect(plan).toContain("idx_ssh_data_user_id");

    db.close();
  });

  it("uses a single index to satisfy the audit log filter and its ordering", () => {
    const db = new Database(":memory:");
    seedSchema(db);
    createPerformanceIndexes(db);

    const plan = db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT * FROM audit_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT 50",
      )
      .all("user-1")
      .map((row) => (row as { detail: string }).detail)
      .join(" ");

    expect(plan).toContain("idx_audit_logs_user_ts");
    // Leading with the filtered column means the index also provides the order.
    expect(plan).not.toContain("TEMP B-TREE");

    db.close();
  });

  it("declares unique index names", () => {
    const names = PERFORMANCE_INDEXES.map((index) => index.name);
    expect(new Set(names).size).toBe(names.length);
  });
});
