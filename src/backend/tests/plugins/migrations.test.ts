import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

vi.mock("../../utils/logger.js", () => ({
  pluginLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import {
  applyPluginMigrations,
  assertOwnedTables,
  adoptLegacyTableSql,
  checksum,
  PluginMigrationChecksumError,
  readMigrations,
  splitStatements,
  LEGACY_TABLE_OWNERS,
  type MigrationRunner,
  type PluginMigration,
} from "../../plugins/migrations.js";

let root: string;

function writeMigration(
  pluginDir: string,
  dialect: string,
  file: string,
  body: string,
): void {
  const dir = path.join(pluginDir, "migrations", dialect);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, file), body);
}

function createRunner(overrides: Partial<MigrationRunner> = {}) {
  const executed: string[][] = [];
  const recorded: PluginMigration[] = [];
  const applied: { migrationId: string; checksum: string }[] = [];

  const runner: MigrationRunner = {
    dialect: "sqlite",
    listApplied: async () => applied,
    execute: async (statements) => {
      executed.push(statements);
    },
    record: async (_pluginId, migration) => {
      recorded.push(migration);
      applied.push({
        migrationId: migration.id,
        checksum: migration.checksum,
      });
    },
    ...overrides,
  };

  return { runner, executed, recorded, applied };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "termix-migrations-"));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("readMigrations", () => {
  it("reads files in sequence order regardless of directory order", () => {
    writeMigration(root, "sqlite", "0002_second.sql", "SELECT 2;");
    writeMigration(root, "sqlite", "0010_tenth.sql", "SELECT 10;");
    writeMigration(root, "sqlite", "0001_first.sql", "SELECT 1;");

    const migrations = readMigrations(root, "sqlite");

    expect(migrations.map((m) => m.id)).toEqual([
      "0001_first",
      "0002_second",
      "0010_tenth",
    ]);
  });

  it("returns nothing when the plugin ships no migrations", () => {
    expect(readMigrations(root, "sqlite")).toEqual([]);
  });

  it("rejects a .sql file that is not named NNNN_name.sql", () => {
    writeMigration(root, "sqlite", "init.sql", "SELECT 1;");

    expect(() => readMigrations(root, "sqlite")).toThrow(/NNNN_name\.sql/);
  });

  it("is insensitive to line endings, so a checkout does not look edited", () => {
    expect(checksum("CREATE TABLE a;\nSELECT 1;\n")).toBe(
      checksum("CREATE TABLE a;\r\nSELECT 1;\r\n"),
    );
  });
});

describe("splitStatements", () => {
  it("splits on semicolons", () => {
    expect(splitStatements("SELECT 1; SELECT 2;")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("keeps a semicolon inside a string literal", () => {
    const statements = splitStatements(
      "INSERT INTO t VALUES ('a;b'); SELECT 1;",
    );

    expect(statements).toEqual(["INSERT INTO t VALUES ('a;b')", "SELECT 1"]);
  });

  it("keeps an escaped quote inside a string literal", () => {
    const statements = splitStatements("INSERT INTO t VALUES ('it''s; fine');");

    expect(statements).toEqual(["INSERT INTO t VALUES ('it''s; fine')"]);
  });

  it("keeps a semicolon inside a line comment", () => {
    const statements = splitStatements("-- a; comment\nSELECT 1;");

    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain("SELECT 1");
  });

  it("keeps a semicolon inside a block comment", () => {
    const statements = splitStatements("/* a; b */ SELECT 1;");

    expect(statements).toHaveLength(1);
  });

  it("ignores a trailing statement that is only whitespace", () => {
    expect(splitStatements("SELECT 1;\n\n  \n")).toEqual(["SELECT 1"]);
  });
});

describe("assertOwnedTables", () => {
  it("allows a table in the plugin's own namespace", () => {
    expect(() =>
      assertOwnedTables(
        "my-plugin",
        "CREATE TABLE IF NOT EXISTS p_my_plugin_thing (id integer)",
      ),
    ).not.toThrow();
  });

  it("rejects a table outside the plugin's namespace", () => {
    expect(() =>
      assertOwnedTables("my-plugin", "CREATE TABLE users (id integer)"),
    ).toThrow(/"users", which is not prefixed "p_my_plugin_"/);
  });

  it("rejects altering a core table", () => {
    expect(() =>
      assertOwnedTables("my-plugin", "ALTER TABLE ssh_data ADD COLUMN x text"),
    ).toThrow(/p_my_plugin_/);
  });

  it("allows the bundled plugin that adopts a legacy table", () => {
    expect(() =>
      assertOwnedTables(
        "fleets",
        'ALTER TABLE "fleets" RENAME TO "p_fleets_fleets"',
        { bundled: true },
      ),
    ).not.toThrow();
  });

  it("gives a user plugin with that id no legacy exemption", () => {
    expect(() =>
      assertOwnedTables(
        "fleets",
        'ALTER TABLE "fleets" RENAME TO "p_fleets_fleets"',
      ),
    ).toThrow(/"fleets", which is not prefixed/);
  });

  it("names the owner when another plugin tries to adopt its table", () => {
    expect(() =>
      assertOwnedTables(
        "workspaces",
        'ALTER TABLE "fleets" RENAME TO "p_workspaces_fleets"',
        { bundled: true },
      ),
    ).toThrow(/belongs to the "fleets" plugin/);
  });

  it("maps every legacy table to exactly one owning plugin", () => {
    // A table owned by two plugins would let either one adopt it and lose the
    // other's data.
    const owners = Object.entries(LEGACY_TABLE_OWNERS);
    expect(new Set(owners.map(([table]) => table)).size).toBe(owners.length);
  });
});

describe("applyPluginMigrations", () => {
  it("applies pending migrations in order and records each one", async () => {
    writeMigration(
      root,
      "sqlite",
      "0001_init.sql",
      "CREATE TABLE p_demo_a (id integer);",
    );
    writeMigration(
      root,
      "sqlite",
      "0002_more.sql",
      "CREATE TABLE p_demo_b (id integer);",
    );
    const { runner, recorded } = createRunner();

    const ids = await applyPluginMigrations("demo", root, runner);

    expect(ids).toEqual(["0001_init", "0002_more"]);
    expect(recorded.map((m) => m.id)).toEqual(["0001_init", "0002_more"]);
  });

  it("skips a migration that has already been applied", async () => {
    writeMigration(
      root,
      "sqlite",
      "0001_init.sql",
      "CREATE TABLE p_demo_a (id integer);",
    );
    const body = fs.readFileSync(
      path.join(root, "migrations", "sqlite", "0001_init.sql"),
      "utf8",
    );
    const { runner, executed } = createRunner({
      listApplied: async () => [
        { migrationId: "0001_init", checksum: checksum(body) },
      ],
    });

    const ids = await applyPluginMigrations("demo", root, runner);

    expect(ids).toEqual([]);
    expect(executed).toEqual([]);
  });

  it("refuses to run when an applied migration was edited", async () => {
    writeMigration(
      root,
      "sqlite",
      "0001_init.sql",
      "CREATE TABLE p_demo_a (id integer);",
    );
    const { runner } = createRunner({
      listApplied: async () => [
        { migrationId: "0001_init", checksum: "stale-checksum" },
      ],
    });

    await expect(applyPluginMigrations("demo", root, runner)).rejects.toThrow(
      PluginMigrationChecksumError,
    );
  });

  it("does not record a migration whose statements failed", async () => {
    writeMigration(
      root,
      "sqlite",
      "0001_init.sql",
      "CREATE TABLE p_demo_a (id integer);",
    );
    const { runner, recorded } = createRunner({
      execute: async () => {
        throw new Error("syntax error");
      },
    });

    await expect(applyPluginMigrations("demo", root, runner)).rejects.toThrow(
      "syntax error",
    );
    expect(recorded).toEqual([]);
  });

  it("refuses a migration that reaches outside the plugin's namespace", async () => {
    writeMigration(root, "sqlite", "0001_init.sql", "DROP TABLE users;");
    const { runner, executed } = createRunner();

    await expect(applyPluginMigrations("demo", root, runner)).rejects.toThrow(
      /p_demo_/,
    );
    expect(executed).toEqual([]);
  });

  it("runs inside a transaction when the dialect offers one", async () => {
    writeMigration(
      root,
      "sqlite",
      "0001_init.sql",
      "CREATE TABLE p_demo_a (id integer);",
    );
    const order: string[] = [];
    const { runner } = createRunner({
      transaction: async (fn) => {
        order.push("begin");
        await fn();
        order.push("commit");
      },
      execute: async () => {
        order.push("execute");
      },
    });

    await applyPluginMigrations("demo", root, runner);

    expect(order).toEqual(["begin", "execute", "commit"]);
  });

  it("reads the directory for the dialect it was given", async () => {
    writeMigration(
      root,
      "sqlite",
      "0001_init.sql",
      "CREATE TABLE p_demo_a (x);",
    );
    writeMigration(
      root,
      "mysql",
      "0001_init.sql",
      "CREATE TABLE p_demo_a (x int);",
    );
    const { runner, executed } = createRunner({ dialect: "mysql" });

    await applyPluginMigrations("demo", root, runner);

    expect(executed[0][0]).toContain("int");
  });
});

describe("adoptLegacyTableSql", () => {
  it("uses ALTER TABLE RENAME on sqlite and postgres", () => {
    expect(adoptLegacyTableSql("sqlite", "fleets", "p_fleets_fleets")).toBe(
      'ALTER TABLE "fleets" RENAME TO "p_fleets_fleets";',
    );
    expect(adoptLegacyTableSql("postgres", "fleets", "p_fleets_fleets")).toBe(
      'ALTER TABLE "fleets" RENAME TO "p_fleets_fleets";',
    );
  });

  it("uses RENAME TABLE and backticks on mysql", () => {
    expect(adoptLegacyTableSql("mysql", "fleets", "p_fleets_fleets")).toBe(
      "RENAME TABLE `fleets` TO `p_fleets_fleets`;",
    );
  });
});
