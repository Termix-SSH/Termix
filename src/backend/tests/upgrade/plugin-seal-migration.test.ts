/**
 * Old ctx.secrets.seal values (core's system key) move to their plugin's own
 * key, found by the table prefix or the kv row's plugin id. Core's own sealed
 * values stay where they are.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  forceSave: vi.fn(async () => {}),
}));

vi.mock("../../database/db/index.js", () => ({ getDb: () => mocks.db }));
vi.mock("../../database/db/dialect.js", async (orig) => ({
  ...(await orig<object>()),
  resolveDatabaseDialect: () => "sqlite",
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: mocks.forceSave },
}));

const { SystemCrypto } = await import("../../utils/system-crypto.js");
const { encryptSystemSecret } =
  await import("../../utils/system-secret-crypto.js");
const { unsealForPlugin } = await import("../../plugins/plugin-seal.js");
const { runPluginSealMigration, tableOwner } =
  await import("../../upgrade/plugin-seal-migration.js");

const NAMES = ["DATA_DIR", "ENCRYPTION_KEY", "ENCRYPTION_KEY_PREVIOUS"];
const saved = Object.fromEntries(NAMES.map((n) => [n, process.env[n]]));
let sqlite: Database.Database;

beforeEach(() => {
  for (const n of NAMES) delete process.env[n];
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "termix-seal-"));
  process.env.ENCRYPTION_KEY = Buffer.alloc(32, 5).toString("hex");
  SystemCrypto.getInstance().resetForTests();
  sqlite = new Database(":memory:");
  sqlite.exec(`
    create table plugins (id text primary key);
    create table settings (key text, value text);
    create table plugin_storage (id integer primary key, plugin_id text, key text, value text);
    create table p_demo_things (id integer, blob_json text);
    create table p_demo_x_items (id integer, secret text);
    create table p_gone_rows (id integer, secret text);
  `);
  sqlite.exec("insert into plugins values ('demo'), ('demo-x')");
  mocks.db = drizzle(sqlite);
  mocks.forceSave.mockClear();
});

afterAll(() => {
  for (const n of NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
  SystemCrypto.getInstance().resetForTests();
});

const one = (statement: string) =>
  (sqlite.prepare(statement).get() as { v: string }).v;

describe("tableOwner", () => {
  it("picks the longest plugin id whose prefix fits", () => {
    expect(tableOwner("p_demo_things", ["demo", "demo-x"])).toBe("demo");
    expect(tableOwner("p_demo_x_items", ["demo", "demo-x"])).toBe("demo-x");
    expect(tableOwner("P_DEMO_X_ITEMS", ["demo", "demo-x"])).toBe("demo-x");
    expect(tableOwner("p_other_rows", ["demo"])).toBeNull();
  });
});

describe("runPluginSealMigration", () => {
  it("moves each plugin's old values to its own key and leaves core's alone", async () => {
    const core = await encryptSystemSecret("core-oidc-secret");
    const inJson = await encryptSystemSecret("demo-token");
    const longer = await encryptSystemSecret("demo-x-token");
    const inKv = await encryptSystemSecret("kv-token");
    const orphan = await encryptSystemSecret("orphan-token");
    sqlite.prepare("insert into settings values ('oidc', ?)").run(core);
    sqlite
      .prepare("insert into p_demo_things values (1, ?)")
      .run(JSON.stringify({ token: inJson, other: "x" }));
    sqlite.prepare("insert into p_demo_x_items values (1, ?)").run(longer);
    sqlite
      .prepare("insert into plugin_storage values (1, 'demo-x', 'k', ?)")
      .run(JSON.stringify(inKv));
    sqlite.prepare("insert into p_gone_rows values (1, ?)").run(orphan);

    expect(await runPluginSealMigration()).toEqual({ moved: 3, failed: 0 });
    expect(mocks.forceSave).toHaveBeenCalledWith("plugin_seal_migration");

    expect(one("select value as v from settings")).toBe(core);
    const json = JSON.parse(one("select blob_json as v from p_demo_things"));
    expect(json.other).toBe("x");
    expect(await unsealForPlugin("demo", json.token)).toBe("demo-token");
    expect(await unsealForPlugin("demo-x", json.token)).toBeNull();
    const moved = one("select secret as v from p_demo_x_items");
    expect(await unsealForPlugin("demo-x", moved)).toBe("demo-x-token");
    const kv = JSON.parse(one("select value as v from plugin_storage"));
    expect(await unsealForPlugin("demo-x", kv)).toBe("kv-token");
    // No installed plugin owns this table, so it is left for later.
    expect(one("select secret as v from p_gone_rows")).toBe(orphan);

    // A second start finds nothing.
    mocks.forceSave.mockClear();
    expect(await runPluginSealMigration()).toEqual({ moved: 0, failed: 0 });
    expect(mocks.forceSave).not.toHaveBeenCalled();
  });
});
