/**
 * The sandbox SQL check: statements Drizzle writes for a plugin's own tables
 * pass, anything that reaches another table or outside the database fails.
 */
import { describe, expect, it } from "vitest";
import { checkPluginSql } from "../../../plugins/sandbox/sql-guard.js";

const own = {
  own: new Set(["p_snippets_snippets", "p_snippets_folders"]),
  readOnly: new Set(["users"]),
};

describe("checkPluginSql", () => {
  it.each([
    'select "id", "name" from "p_snippets_snippets" where "p_snippets_snippets"."user_id" = ?',
    'insert into "p_snippets_snippets" ("name") values (?) returning "id"',
    'update "p_snippets_snippets" set "name" = ? where "id" = ?',
    'delete from "p_snippets_folders" where "id" = ?',
    'select * from "p_snippets_snippets" left join "users" on "users"."id" = "p_snippets_snippets"."user_id"',
    'insert into "p_snippets_folders" ("name") values (?) on conflict ("name") do update set "name" = excluded."name"',
    'select * from "p_snippets_snippets" where "name" = \'from secrets\'',
    'with "mine" as (select * from "p_snippets_snippets") select * from "mine"',
    'select * from (select * from "p_snippets_snippets") "x"',
  ])("allows %s", (sql) => {
    expect(checkPluginSql(sql, own).ok).toBe(true);
  });

  it.each([
    ['select * from "ssh_data"', "ssh_data"],
    ['select * from "p_snippets_snippets" join "settings" on 1=1', "settings"],
    ['select * from "p_snippetsx_secret"', "p_snippetsx_secret"],
    ['insert into "audit_logs" ("x") values (?)', "audit_logs"],
    ['update "users" set "is_admin" = 1', "read only"],
    ['delete from "users" where 1=1', "read only"],
    ['insert or replace into "users" ("id") values (?)', "read only"],
    ["select * from p_snippets_snippets; delete from users", "more than one"],
    ["attach database '/data/db.sqlite' as other", "attach"],
    ["pragma table_info(users)", "pragma"],
    ["select load_extension('x')", "load_extension"],
    ["select * from sqlite_master", "sqlite"],
    ['select * from "main"."users"', "schema"],
    ['drop table "p_snippets_snippets"', "drop"],
    [
      'select * from "p_snippets_snippets" /* */ union select * from "sessions"',
      "sessions",
    ],
  ])("refuses %s", (sql, reason) => {
    const result = checkPluginSql(sql, own);
    expect(result.ok).toBe(false);
    if (reason) expect(result.reason).toContain(reason);
  });

  it("lets a granted ref be read in a write to the plugin's own table", () => {
    expect(
      checkPluginSql(
        'insert into "p_snippets_folders" ("name") select "username" from "users"',
        own,
      ).ok,
    ).toBe(true);
  });
});
