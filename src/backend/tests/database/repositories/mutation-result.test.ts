import { describe, expect, it } from "vitest";
import {
  insertedId,
  rowsAffected,
  supportsReturning,
} from "../../../database/repositories/mutation-result.js";

describe("rowsAffected", () => {
  it("counts a returning() array from sqlite or postgres", () => {
    expect(rowsAffected([{ id: 1 }, { id: 2 }, { id: 3 }])).toBe(3);
    expect(rowsAffected([])).toBe(0);
  });

  it("reads affectedRows from a mysql write result", () => {
    expect(rowsAffected({ affectedRows: 4, insertId: 0 })).toBe(4);
    expect(rowsAffected({ affectedRows: 0 })).toBe(0);
  });

  it("reads changes from a better-sqlite3 write result", () => {
    // The shape of a write with no .returning() attached — verified against
    // the driver, not assumed.
    expect(rowsAffected({ changes: 1, lastInsertRowid: 7 })).toBe(1);
    expect(rowsAffected({ changes: 0, lastInsertRowid: 7 })).toBe(0);
  });

  it("reads rowCount from a node-postgres write result", () => {
    expect(rowsAffected({ rowCount: 3, rows: [], command: "DELETE" })).toBe(3);
  });

  it("unwraps the [header, fields] tuple mysql2 returns", () => {
    expect(rowsAffected([{ affectedRows: 2 }, []])).toBe(2);
  });

  it("does not mistake a returning() array for a mysql header", () => {
    // A single returned row is one row, not whatever affectedRows might say.
    expect(rowsAffected([{ id: 7 }])).toBe(1);
  });

  it("reports zero for a shape it does not recognise", () => {
    expect(rowsAffected(undefined)).toBe(0);
    expect(rowsAffected(null)).toBe(0);
    expect(rowsAffected({})).toBe(0);
  });
});

describe("insertedId", () => {
  it("reads the id from a returning() array", () => {
    expect(insertedId([{ id: 42 }])).toBe(42);
  });

  it("reads insertId from a mysql write result", () => {
    expect(insertedId({ affectedRows: 1, insertId: 42 })).toBe(42);
    expect(insertedId([{ affectedRows: 1, insertId: 42 }, []])).toBe(42);
  });

  it("treats mysql's zero insertId as absent", () => {
    // MySQL reports 0 when the table has no autoincrement column.
    expect(insertedId({ affectedRows: 1, insertId: 0 })).toBeNull();
  });

  it("reads lastInsertRowid from better-sqlite3, as number or bigint", () => {
    expect(insertedId({ changes: 1, lastInsertRowid: 9 })).toBe(9);
    expect(insertedId({ changes: 1, lastInsertRowid: 9n })).toBe(9);
    expect(insertedId({ changes: 1, lastInsertRowid: 0 })).toBeNull();
  });

  it("returns null when nothing was inserted", () => {
    expect(insertedId([])).toBeNull();
    expect(insertedId({})).toBeNull();
    expect(insertedId(undefined)).toBeNull();
  });

  it("returns null for a non-numeric id", () => {
    // Tables keyed by a text id, e.g. users.
    expect(insertedId([{ id: "u-1" }])).toBeNull();
  });
});

describe("supportsReturning", () => {
  it("is false only for mysql", () => {
    expect(supportsReturning("sqlite")).toBe(true);
    expect(supportsReturning("postgres")).toBe(true);
    // No RETURNING clause in MySQL, and drizzle's mysql-core does not expose
    // the method — call sites that need rows back must read first.
    expect(supportsReturning("mysql")).toBe(false);
  });
});
