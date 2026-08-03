import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { transform, collectKeyColumns } =
  require("./generate-dialect-schema.cjs") as {
    transform: (source: string, dialect: "postgres" | "mysql") => string;
    collectKeyColumns: (source: string) => Set<string>;
  };

const SOURCE = `import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  username: text("username").notNull(),
  isAdmin: integer("is_admin", { mode: "boolean" }).notNull().default(false),
  wrapped: integer("wrapped", {
    mode: "boolean",
  })
    .notNull()
    .default(true),
  score: real("score"),
  ssoProviderId: integer("sso_provider_id"),
});

export const folders = sqliteTable("folders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  syncId: text("sync_id").unique(),
  cert: text("cert", { length: 8192 }),
});
`;

describe("collectKeyColumns", () => {
  it("finds columns that must be indexable", () => {
    const keyed = collectKeyColumns(SOURCE);

    // primary key, unique, and both ends of the foreign key
    expect(keyed.has("id")).toBe(true);
    expect(keyed.has("sync_id")).toBe(true);
    expect(keyed.has("user_id")).toBe(true);
  });

  it("leaves ordinary strings alone", () => {
    const keyed = collectKeyColumns(SOURCE);

    expect(keyed.has("username")).toBe(false);
    expect(keyed.has("name")).toBe(false);
    expect(keyed.has("cert")).toBe(false);
  });
});

describe("postgres output", () => {
  const out = transform(SOURCE, "postgres");

  it("is marked generated", () => {
    expect(out.startsWith("// GENERATED FILE")).toBe(true);
  });

  it("uses pg-core", () => {
    expect(out).toContain('from "drizzle-orm/pg-core"');
    expect(out).not.toContain("sqlite-core");
    expect(out).toContain("pgTable(");
    expect(out).not.toContain("sqliteTable(");
  });

  it("maps autoincrement keys to serial", () => {
    expect(out).toContain('serial("id").primaryKey()');
    expect(out).not.toContain("autoIncrement");
  });

  it("maps integer-backed booleans, including the wrapped form", () => {
    expect(out).toContain('boolean("is_admin")');
    // Prettier splits longer declarations across lines; both must convert.
    expect(out).toContain('boolean("wrapped")');
    expect(out).not.toMatch(/mode:\s*"boolean"/);
  });

  it("keeps plain integers and maps real", () => {
    expect(out).toContain('integer("sso_provider_id")');
    expect(out).toContain('doublePrecision("score")');
  });

  it("makes key columns varchar and leaves the rest text", () => {
    expect(out).toContain('varchar("id", { length: 255 })');
    expect(out).toContain('varchar("user_id", { length: 255 })');
    expect(out).toContain('varchar("sync_id", { length: 255 })');
    expect(out).toContain('text("username")');
    expect(out).toContain('text("name")');
  });

  it("drops the sqlite-only text length", () => {
    expect(out).toContain('text("cert")');
    expect(out).not.toContain("length: 8192");
  });
});

describe("mysql output", () => {
  const out = transform(SOURCE, "mysql");

  it("uses mysql-core", () => {
    expect(out).toContain('from "drizzle-orm/mysql-core"');
    expect(out).toContain("mysqlTable(");
  });

  it("maps autoincrement keys to int auto_increment", () => {
    expect(out).toContain('int("id").autoincrement().primaryKey()');
  });

  it("renames integer to int", () => {
    expect(out).toContain('int("sso_provider_id")');
    expect(out).not.toMatch(/\binteger\(/);
  });

  it("maps real to double", () => {
    expect(out).toContain('double("score")');
  });

  it("makes key columns varchar — MySQL cannot index unbounded TEXT", () => {
    expect(out).toContain('varchar("user_id", { length: 255 })');
    expect(out).toContain('text("name")');
  });
});

describe("determinism", () => {
  it("produces identical output for identical input", () => {
    expect(transform(SOURCE, "postgres")).toBe(transform(SOURCE, "postgres"));
    expect(transform(SOURCE, "mysql")).toBe(transform(SOURCE, "mysql"));
  });

  it("keeps foreign key behaviour verbatim", () => {
    for (const dialect of ["postgres", "mysql"] as const) {
      expect(transform(SOURCE, dialect)).toContain('onDelete: "cascade"');
    }
  });
});
