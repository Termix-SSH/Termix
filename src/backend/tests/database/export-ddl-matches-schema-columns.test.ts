import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * database.ts carries a SECOND hand-written `CREATE TABLE ssh_data`, plus a
 * positional INSERT, for the encrypted-database export/import path. It is
 * separate from db/index.ts's DDL and from the drizzle migrations, so
 * bootstrap-matches-schema-columns.test.ts -- which boots a real database --
 * never touches it.
 *
 * That makes it the least-visible of the three schema definitions and the one
 * with no runtime test coverage. A column added everywhere else but missed
 * here produces an INSERT naming a column the table does not have: a runtime
 * failure against an encrypted database, in the one path nothing exercises.
 *
 * This compares the file against itself -- the CREATE TABLE against the INSERT
 * column list against the bound values -- which is the invariant that actually
 * breaks, and needs no database to check.
 */
function source(relative: string): string {
  return readFileSync(path.resolve(relative), "utf8");
}

describe("the encrypted-export ssh_data DDL agrees with its INSERT", () => {
  const text = source("src/backend/database/database.ts");

  const createStart = text.indexOf("CREATE TABLE ssh_data (");
  const createBlock = text.slice(createStart);
  const createBody = createBlock.slice(0, createBlock.indexOf("\n        );"));

  const insertMatch = text.match(/INSERT INTO ssh_data \(([^)]+)\)/);

  it("finds both halves, so a rename cannot silently void this test", () => {
    expect(createBody).toContain("ip TEXT NOT NULL");
    expect(insertMatch).not.toBeNull();
  });

  it("names no column in the INSERT that the CREATE TABLE lacks", () => {
    const insertColumns = (insertMatch?.[1] ?? "")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);

    const missing = insertColumns.filter(
      (column) => !new RegExp(`\\b${column}\\b`).test(createBody),
    );
    expect(missing).toEqual([]);
  });

  it("carries the web endpoint columns in both halves", () => {
    // Named explicitly rather than derived: the generic check above passes if
    // BOTH halves omit a column, which is precisely how this feature's columns
    // would go missing.
    for (const column of ["enable_web_ui", "web_ui_config"]) {
      expect(createBody).toContain(column);
      expect(insertMatch?.[1]).toContain(column);
    }
  });

  it("binds exactly one placeholder per column", () => {
    // This is a POSITIONAL insert, so a column added without a matching "?"
    // shifts every later value by one -- silently writing the wrong data into
    // the wrong columns, or failing outright. Adding two columns and leaving
    // the VALUES list untouched is exactly the mistake this catches.
    const columns = (insertMatch?.[1] ?? "")
      .split(",")
      .map((column) => column.trim())
      .filter(Boolean);

    const values = text
      .slice(text.indexOf(insertMatch?.[0] ?? ""))
      .match(/VALUES \(([^)]+)\)/)?.[1];

    expect(values).toBeDefined();
    expect((values ?? "").split("?").length - 1).toBe(columns.length);
  });

  it("carries the web endpoint values in the bound parameter list", () => {
    expect(text).toContain("decrypted.enableWebUi");
    expect(text).toContain("decrypted.webUiConfig");
  });
});
