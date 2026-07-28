import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { drizzle as sqliteDrizzle } from "drizzle-orm/better-sqlite3";
import { drizzle as pgDrizzle } from "drizzle-orm/node-postgres";
import { drizzle as mysqlDrizzle } from "drizzle-orm/mysql2";
import { getTableConfig as sqliteTableConfig } from "drizzle-orm/sqlite-core";
import { getTableConfig as pgTableConfig } from "drizzle-orm/pg-core";
import { getTableConfig as mysqlTableConfig } from "drizzle-orm/mysql-core";
import Database from "better-sqlite3";
import * as sqliteSchema from "../../../database/db/schema.js";
import * as pgSchema from "../../../database/db/schema.pg.js";
import * as mysqlSchema from "../../../database/db/schema.mysql.js";
import {
  DATABASE_DIALECT_ENV,
  isDatabaseDialect,
  needsExplicitPersist,
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

describe("needsExplicitPersist", () => {
  it("is true only for sqlite", () => {
    // SQLite runs in memory and is serialised back to an encrypted file, so
    // every write needs a flush. The others have already committed durably.
    expect(needsExplicitPersist("sqlite")).toBe(true);
    expect(needsExplicitPersist("postgres")).toBe(false);
    expect(needsExplicitPersist("mysql")).toBe(false);
  });
});

/**
 * schema.pg.ts and schema.mysql.ts are generated from schema.ts. These check the
 * generated output is usable rather than merely syntactically valid — the
 * repository layer's correctness rests on all three behaving the same way.
 */
describe("generated schemas", () => {
  it("declares the same tables in all three dialects", () => {
    const tablesOf = (schema: Record<string, unknown>) =>
      Object.keys(schema).sort();

    expect(tablesOf(pgSchema)).toEqual(tablesOf(sqliteSchema));
    expect(tablesOf(mysqlSchema)).toEqual(tablesOf(sqliteSchema));
    // Guard against a generator that silently emits nothing.
    expect(tablesOf(sqliteSchema).length).toBeGreaterThan(40);
  });

  it("maps each column to the right storage type per dialect", () => {
    expect(sqliteSchema.users.isAdmin.getSQLType()).toBe("integer");
    expect(pgSchema.users.isAdmin.getSQLType()).toBe("boolean");
    expect(mysqlSchema.users.isAdmin.getSQLType()).toBe("boolean");

    // A primary key must be indexable, which rules out unbounded TEXT on MySQL.
    expect(sqliteSchema.users.id.getSQLType()).toBe("text");
    expect(pgSchema.users.id.getSQLType()).toContain("varchar");
    expect(mysqlSchema.users.id.getSQLType()).toContain("varchar");
  });

  it("spells the autoincrement key three different ways", () => {
    expect(sqliteSchema.auditLogs.id.getSQLType()).toBe("integer");
    expect(pgSchema.auditLogs.id.getSQLType()).toBe("serial");
    expect(mysqlSchema.auditLogs.id.getSQLType()).toBe("int");

    for (const schema of [sqliteSchema, pgSchema, mysqlSchema]) {
      expect(schema.auditLogs.id.primary).toBe(true);
    }
  });

  it("preserves both foreign-key behaviours", () => {
    // 80 cascade + 12 set null across the schema; set null is what keeps the
    // audit trail after a user is deleted (#1132).
    const perDialect = [
      { schema: sqliteSchema, config: sqliteTableConfig },
      { schema: pgSchema, config: pgTableConfig },
      { schema: mysqlSchema, config: mysqlTableConfig },
    ] as const;

    for (const { schema, config } of perDialect) {
      const read = config as (table: unknown) => {
        foreignKeys: { onDelete?: string }[];
      };

      const auditFks = read(schema.auditLogs).foreignKeys;
      expect(auditFks).toHaveLength(1);
      expect(auditFks[0].onDelete).toBe("set null");

      const folderFks = read(schema.sshFolders).foreignKeys;
      expect(folderFks.map((fk) => fk.onDelete).sort()).toEqual([
        "cascade",
        "set null",
      ]);
    }
  });

  it("keeps nullability and uniqueness", () => {
    for (const schema of [sqliteSchema, pgSchema, mysqlSchema]) {
      expect(schema.auditLogs.userId.notNull).toBe(false);
      expect(schema.sshFolders.userId.notNull).toBe(true);
      expect(schema.sshFolders.syncId.isUnique).toBe(true);
    }
  });
});

/**
 * Queries are built, never executed, so no server is required. What matters is
 * that identical repository-style code produces correct SQL for each engine.
 */
describe("query generation per dialect", () => {
  const sqliteDb = sqliteDrizzle(new Database(":memory:"), {
    schema: sqliteSchema,
  });
  const pgDb = pgDrizzle.mock({ schema: pgSchema });
  const mysqlDb = mysqlDrizzle.mock({ schema: mysqlSchema, mode: "default" });

  it("quotes identifiers the way each engine expects", () => {
    const built = [
      sqliteDb
        .select()
        .from(sqliteSchema.settings)
        .where(eq(sqliteSchema.settings.key, "guac_url"))
        .toSQL(),
      pgDb
        .select()
        .from(pgSchema.settings)
        .where(eq(pgSchema.settings.key, "guac_url"))
        .toSQL(),
      mysqlDb
        .select()
        .from(mysqlSchema.settings)
        .where(eq(mysqlSchema.settings.key, "guac_url"))
        .toSQL(),
    ];

    expect(built[0].sql).toContain('"settings"');
    expect(built[1].sql).toContain('"settings"');
    expect(built[2].sql).toContain("`settings`");

    // The value is parameterised either way, never inlined.
    for (const sql of built) {
      expect(sql.params).toEqual(["guac_url"]);
    }
  });

  it("uses each engine's placeholder style", () => {
    expect(
      pgDb
        .select()
        .from(pgSchema.users)
        .where(eq(pgSchema.users.id, "u-1"))
        .toSQL().sql,
    ).toContain("$1");

    expect(
      mysqlDb
        .select()
        .from(mysqlSchema.users)
        .where(eq(mysqlSchema.users.id, "u-1"))
        .toSQL().sql,
    ).toContain("?");
  });

  it("stores booleans as the type each engine expects", () => {
    const row = { id: "u-1", username: "alice", passwordHash: "hash" };

    const sqliteSql = sqliteDb
      .insert(sqliteSchema.users)
      .values({ ...row, isAdmin: true })
      .toSQL();
    const pgSql = pgDb
      .insert(pgSchema.users)
      .values({ ...row, isAdmin: true })
      .toSQL();

    // The storage difference the generator exists to absorb.
    expect(sqliteSql.params).toContain(1);
    expect(pgSql.params).toContain(true);
  });

  it("round-trips on the engine that is actually wired up", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec(
      `CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);`,
    );
    const db = sqliteDrizzle(sqlite, { schema: sqliteSchema });

    db.insert(sqliteSchema.settings)
      .values({ key: "guac_url", value: "guacd:4822" })
      .run();

    expect(db.select().from(sqliteSchema.settings).all()).toEqual([
      { key: "guac_url", value: "guacd:4822" },
    ]);

    sqlite.close();
  });
});
