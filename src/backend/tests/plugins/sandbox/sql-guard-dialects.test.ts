/**
 * The SQL guard's reader for each dialect: comments, strings, quoted names and
 * parameters are read the way that database reads them, so a table name can't
 * hide inside one and a trick can't slip past as one.
 */
import { describe, expect, it } from "vitest";
import { checkPluginSql } from "../../../plugins/sandbox/sql-guard.js";

const tables = {
  own: new Set(["p_demo_items"]),
  readOnly: new Set(["users"]),
};
const ok = (sql: string, dialect: "sqlite" | "postgres" | "mysql") =>
  checkPluginSql(sql, tables, dialect).ok;
const reason = (sql: string, dialect: "sqlite" | "postgres" | "mysql") =>
  (checkPluginSql(sql, tables, dialect) as { reason?: string }).reason ?? "";

describe("mysql", () => {
  it("reads its comments, strings and names", () => {
    expect(
      ok("select * from `p_demo_items` # from users_secret", "mysql"),
    ).toBe(true);
    expect(ok("select * from p_demo_items -- join sessions", "mysql")).toBe(
      true,
    );
    expect(
      ok(
        "select * from p_demo_items where a = 'it\\'s from sessions'",
        "mysql",
      ),
    ).toBe(true);
    expect(
      ok('select * from p_demo_items where a = "from sessions"', "mysql"),
    ).toBe(true);
    expect(ok("select * from `p_demo_items` where a = ''''", "mysql")).toBe(
      true,
    );
  });

  it("refuses executable comments and variables", () => {
    expect(
      reason("select /*! * from sessions */ 1 from p_demo_items", "mysql"),
    ).toMatch(/executable comments/);
    expect(reason("select /*+ hint */ * from p_demo_items", "mysql")).toMatch(
      /executable comments/,
    );
    expect(reason("select @@version from p_demo_items", "mysql")).toMatch(
      /variables/,
    );
  });

  it("refuses a table named only in backticks", () => {
    expect(ok("select * from `sessions`", "mysql")).toBe(false);
  });
});

describe("postgres", () => {
  it("reads nested comments, dollar quotes, casts and numbered parameters", () => {
    expect(
      ok(
        'select * from "p_demo_items" /* a /* b */ sessions */ where id = $1',
        "postgres",
      ),
    ).toBe(true);
    expect(ok("select $$from sessions$$ from p_demo_items", "postgres")).toBe(
      true,
    );
    expect(
      ok("select $tag$ from users_x $tag$ from p_demo_items", "postgres"),
    ).toBe(true);
    expect(
      ok("select id::text from p_demo_items where n = :name", "postgres"),
    ).toBe(true);
    expect(
      ok("select * from p_demo_items where a = 1.5e+3 and b = .5", "postgres"),
    ).toBe(true);
  });

  it("refuses unterminated quotes and comments", () => {
    for (const sql of [
      "select $$ from p_demo_items",
      "select /* from p_demo_items",
      "select 'x from p_demo_items",
      'select * from "p_demo_items',
    ]) {
      expect(ok(sql, "postgres")).toBe(false);
    }
  });

  it("refuses another table in double quotes", () => {
    expect(ok('select * from "sessions"', "postgres")).toBe(false);
    expect(
      ok('select * from "p_demo_items" join "api_keys" on true', "postgres"),
    ).toBe(false);
  });
});

describe("sqlite", () => {
  it("reads bracket names and named parameters", () => {
    expect(
      ok(
        "select * from [p_demo_items] where id = :id and x = @x and y = ?2",
        "sqlite",
      ),
    ).toBe(true);
    expect(ok("select * from [sessions]", "sqlite")).toBe(false);
    expect(ok("select * from [p_demo_items", "sqlite")).toBe(false);
  });

  it("refuses unterminated backticks and quoted names", () => {
    expect(ok("select * from `p_demo_items", "sqlite")).toBe(false);
    expect(ok('select * from "p_demo_items', "sqlite")).toBe(false);
  });

  it("reads the read only tables but never writes them", () => {
    expect(
      ok(
        "select * from p_demo_items join users on users.id = p_demo_items.u",
        "sqlite",
      ),
    ).toBe(true);
    expect(ok("update users set name = ?", "sqlite")).toBe(false);
    expect(ok("delete from users", "sqlite")).toBe(false);
  });
});
