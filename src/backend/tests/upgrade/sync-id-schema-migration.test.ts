import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { repairSyncIdColumns } from "../../upgrade/sync-id-schema-migration.js";

let sqlite: Database.Database;
beforeEach(() => {
  sqlite = new Database(":memory:");
});
afterEach(() => {
  sqlite.close();
});

describe("Homepage and Vault sync column upgrade", () => {
  it("adds the 2.8 columns to tables adopted from 2.5", () => {
    // 2.5.1's columns, renamed by the plugins' adoption migrations.
    sqlite.exec(`
      CREATE TABLE "p_homepage_homepage_items" (id INTEGER PRIMARY KEY, user_id TEXT, type_id TEXT, title TEXT, config TEXT, folder_id INTEGER, created_at TEXT, updated_at TEXT);
      CREATE TABLE "p_homepage_dashboard_service_links" (id INTEGER PRIMARY KEY, user_id TEXT, label TEXT, url TEXT, "order" INTEGER, created_at TEXT);
      CREATE TABLE "p_vault_profiles" (id INTEGER PRIMARY KEY, user_id TEXT, name TEXT);
      INSERT INTO "p_homepage_homepage_items" (id, user_id, type_id) VALUES (1, 'u', 'clock'), (2, 'u', 'notes');
      INSERT INTO "p_homepage_dashboard_service_links" (id, user_id, label, url) VALUES (1, 'u', 'Wiki', 'https://wiki');
      INSERT INTO "p_vault_profiles" (id, user_id, name) VALUES (1, 'u', 'prod');
    `);
    repairSyncIdColumns(sqlite);

    for (const table of [
      "p_homepage_homepage_items",
      "p_homepage_dashboard_service_links",
      "p_vault_profiles",
    ]) {
      const rows = sqlite.prepare(`SELECT "sync_id" FROM "${table}"`).all() as {
        sync_id: string;
      }[];
      for (const row of rows) expect(row.sync_id).toMatch(/^[0-9a-f]{32}$/);
    }
    expect(
      sqlite
        .prepare(
          `SELECT "label", "updated_at" FROM "p_homepage_dashboard_service_links"`,
        )
        .get(),
    ).toEqual({ label: "Wiki", updated_at: null });
    expect(() =>
      sqlite.exec(`UPDATE "p_homepage_homepage_items" SET "sync_id" = 'same'`),
    ).toThrow(/UNIQUE/);
  });

  it("keeps sync ids on a current table", () => {
    sqlite.exec(
      `CREATE TABLE "p_vault_profiles" (id INTEGER PRIMARY KEY, sync_id TEXT)`,
    );
    sqlite.prepare(`INSERT INTO "p_vault_profiles" VALUES (1, 'kept')`).run();
    repairSyncIdColumns(sqlite);
    repairSyncIdColumns(sqlite);
    expect(
      sqlite.prepare("SELECT sync_id FROM p_vault_profiles").get(),
    ).toEqual({ sync_id: "kept" });
  });

  it("does not create tables on a fresh install", () => {
    repairSyncIdColumns(sqlite);
    expect(
      sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all(),
    ).toEqual([]);
  });
});
