import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql2";
import Database from "better-sqlite3";
import {
  mysqlPortable,
  pgPortable,
  portableSchemaFor,
  sqlitePortable,
} from "../../../database/db/schema-portable.js";
import {
  DATABASE_DIALECT_ENV,
  isDatabaseDialect,
  resolveDatabaseDialect,
} from "../../../database/db/dialect.js";

describe("resolveDatabaseDialect", () => {
  it("defaults to sqlite so existing deployments are unaffected", () => {
    expect(resolveDatabaseDialect({})).toBe("sqlite");
    expect(resolveDatabaseDialect({ [DATABASE_DIALECT_ENV]: "" })).toBe(
      "sqlite",
    );
  });

  it("accepts the supported engines, case-insensitively", () => {
    expect(resolveDatabaseDialect({ [DATABASE_DIALECT_ENV]: "postgres" })).toBe(
      "postgres",
    );
    expect(resolveDatabaseDialect({ [DATABASE_DIALECT_ENV]: "MySQL" })).toBe(
      "mysql",
    );
  });

  it("refuses an unknown engine rather than silently using sqlite", () => {
    expect(() =>
      resolveDatabaseDialect({ [DATABASE_DIALECT_ENV]: "oracle" }),
    ).toThrow(/Unsupported/);
  });

  it("narrows correctly", () => {
    expect(isDatabaseDialect("mysql")).toBe(true);
    expect(isDatabaseDialect("mongo")).toBe(false);
  });
});

describe("portable schema", () => {
  it("exposes the same tables and columns for every dialect", () => {
    const EXPECTED = [
      "id",
      "isAdmin",
      "isOidc",
      "oidcIdentifier",
      "passwordHash",
      "ssoProviderId",
      "username",
    ];

    for (const schema of [sqlitePortable, pgPortable, mysqlPortable]) {
      expect(Object.keys(schema).sort()).toEqual([
        "auditLogs",
        "settings",
        "sshFolders",
        "users",
      ]);

      // Compare the declared columns, not every own key: the pg table also
      // carries dialect-specific helpers such as enableRLS.
      const columns = Object.keys(schema.users).filter((key) =>
        EXPECTED.includes(key),
      );
      expect(columns.sort()).toEqual(EXPECTED);
    }
  });

  it("maps each column to the right storage type per dialect", () => {
    // The differences the column kit exists to absorb.
    expect(sqlitePortable.users.isAdmin.getSQLType()).toBe("integer");
    expect(pgPortable.users.isAdmin.getSQLType()).toBe("boolean");
    expect(mysqlPortable.users.isAdmin.getSQLType()).toBe("boolean");

    // A primary key must be indexable, which rules out unbounded TEXT on MySQL.
    expect(sqlitePortable.users.id.getSQLType()).toBe("text");
    expect(pgPortable.users.id.getSQLType()).toContain("varchar");
    expect(mysqlPortable.users.id.getSQLType()).toContain("varchar");
  });

  it("selects the schema matching the configured dialect", () => {
    expect(portableSchemaFor("sqlite")).toBe(sqlitePortable);
    expect(portableSchemaFor("postgres")).toBe(pgPortable);
    expect(portableSchemaFor("mysql")).toBe(mysqlPortable);
  });
});

/**
 * The queries below are only built, never executed, so no server is needed.
 * What matters is that identical repository-style code compiles and produces
 * correct SQL for each engine — that is the property the repository layer
 * depends on.
 */
describe("query generation per dialect", () => {
  const sqliteDb = sqliteDrizzle(new Database(":memory:"), {
    schema: sqlitePortable,
  });
  // Both accept a plain query callback, so the builders can be exercised with
  // no server and no connection pool.
  const noopQuery = async () => [] as never;
  const pgDb = pgDrizzle.mock({ schema: pgPortable });
  const mysqlDb = mysqlDrizzle.mock({
    schema: mysqlPortable,
    mode: "default",
  });
  void noopQuery;

  it("quotes identifiers the way each engine expects", () => {
    const sqliteSql = sqliteDb
      .select()
      .from(sqlitePortable.settings)
      .where(eq(sqlitePortable.settings.key, "guac_url"))
      .toSQL();
    const pgSql = pgDb
      .select()
      .from(pgPortable.settings)
      .where(eq(pgPortable.settings.key, "guac_url"))
      .toSQL();
    const mysqlSql = mysqlDb
      .select()
      .from(mysqlPortable.settings)
      .where(eq(mysqlPortable.settings.key, "guac_url"))
      .toSQL();

    expect(sqliteSql.sql).toContain('"settings"');
    expect(pgSql.sql).toContain('"settings"');
    expect(mysqlSql.sql).toContain("`settings`");

    // Same parameter either way — the value is never inlined.
    for (const built of [sqliteSql, pgSql, mysqlSql]) {
      expect(built.params).toEqual(["guac_url"]);
    }
  });

  it("uses each engine's placeholder style", () => {
    const pgSql = pgDb
      .select()
      .from(pgPortable.users)
      .where(eq(pgPortable.users.id, "u-1"))
      .toSQL();
    const mysqlSql = mysqlDb
      .select()
      .from(mysqlPortable.users)
      .where(eq(mysqlPortable.users.id, "u-1"))
      .toSQL();

    expect(pgSql.sql).toContain("$1");
    expect(mysqlSql.sql).toContain("?");
  });

  it("builds the same insert shape everywhere", () => {
    const row = {
      id: "u-1",
      username: "alice",
      passwordHash: "hash",
      isAdmin: true,
      isOidc: false,
      oidcIdentifier: null,
      ssoProviderId: null,
    };

    const built = [
      sqliteDb.insert(sqlitePortable.users).values(row).toSQL(),
      pgDb.insert(pgPortable.users).values(row).toSQL(),
      mysqlDb.insert(mysqlPortable.users).values(row).toSQL(),
    ];

    for (const sql of built) {
      expect(sql.sql).toMatch(/insert into/i);
      expect(sql.params).toContain("alice");
    }

    // Booleans are integers in SQLite and native elsewhere — the storage
    // difference the column kit exists to hide.
    expect(built[0].params).toContain(1);
    expect(built[1].params).toContain(true);
  });

  it("actually round-trips on the engine that is wired up", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(`
      CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    const db = sqliteDrizzle(sqlite, { schema: sqlitePortable });

    db.insert(sqlitePortable.settings)
      .values({ key: "guac_url", value: "guacd:4822" })
      .run();

    const rows = db.select().from(sqlitePortable.settings).all();
    expect(rows).toEqual([{ key: "guac_url", value: "guacd:4822" }]);

    sqlite.close();
  });

  it("expresses both foreign-key behaviours on every dialect", () => {
    // 80 cascade + 12 set null across the real schema; both must survive the
    // port, and set null is what keeps the audit trail after a user is deleted.
    // Each dialect has its own getTableConfig — they are not interchangeable.
    const perDialect = [
      { schema: sqlitePortable, config: sqliteTableConfig },
      { schema: pgPortable, config: pgTableConfig },
      { schema: mysqlPortable, config: mysqlTableConfig },
    ] as const;

    for (const { schema, config } of perDialect) {
      const auditFks = (
        config as (table: unknown) => { foreignKeys: unknown[] }
      )(schema.auditLogs).foreignKeys as {
        onDelete?: string;
      }[];
      const folderFks = (
        config as (table: unknown) => { foreignKeys: unknown[] }
      )(schema.sshFolders).foreignKeys as {
        onDelete?: string;
      }[];

      expect(auditFks).toHaveLength(1);
      expect(auditFks[0].onDelete).toBe("set null");
      expect(folderFks).toHaveLength(1);
      expect(folderFks[0].onDelete).toBe("cascade");
    }
  });

  it("keeps a nullable audit reference and a required folder reference", () => {
    for (const schema of [sqlitePortable, pgPortable, mysqlPortable]) {
      expect(schema.auditLogs.userId.notNull).toBe(false);
      expect(schema.sshFolders.userId.notNull).toBe(true);
    }
  });

  it("carries the unique constraint across dialects", () => {
    for (const schema of [sqlitePortable, pgPortable, mysqlPortable]) {
      expect(schema.sshFolders.syncId.isUnique).toBe(true);
    }
  });

  it("makes the surrogate key auto-increment on each engine", () => {
    // integer primary key autoincrement / serial / int auto_increment
    expect(sqlitePortable.auditLogs.id.getSQLType()).toBe("integer");
    expect(pgPortable.auditLogs.id.getSQLType()).toBe("serial");
    expect(mysqlPortable.auditLogs.id.getSQLType()).toBe("int");

    for (const schema of [sqlitePortable, pgPortable, mysqlPortable]) {
      expect(schema.auditLogs.id.primary).toBe(true);
    }
  });
});
