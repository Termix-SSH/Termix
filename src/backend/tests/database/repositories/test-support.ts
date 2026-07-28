import { describe, it } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import {
  getTableColumns,
  getTableName,
  is,
  sql,
  Table,
  type SQL,
} from "drizzle-orm";
import fs from "fs";
import path from "path";
import * as schema from "../../../database/db/schema.js";
import type { DatabaseContext } from "../../../database/repositories/database-context.js";
import type { DatabaseDialect } from "../../../database/db/dialect.js";

/**
 * Which engine the repository tests run against.
 *
 * Defaults to SQLite, so `npm test` behaves as it always has and needs no
 * server. Set TEST_DIALECT=postgres or mysql, plus TEST_DATABASE_URL, to run
 * the same tests against a real one — see the database-dialects CI job.
 */
export function testDialect(env = process.env): DatabaseDialect {
  const value = env.TEST_DIALECT?.trim().toLowerCase();
  if (value === "postgres" || value === "mysql") return value;
  return "sqlite";
}

/**
 * For tests that reach past drizzle into the SQLite driver — asserting on
 * stored bytes, or handing a raw handle to something that still wants one.
 *
 * They are not portable by nature, so they skip rather than fail when the run
 * is pointed at another engine. Everything they cover is also covered by a
 * portable test; what is lost on Postgres and MySQL is the byte-level
 * assertion, not the behaviour.
 */
export const describeSqliteOnly =
  testDialect() === "sqlite" ? describe : describe.skip;

export const itSqliteOnly = testDialect() === "sqlite" ? it : it.skip;

/** Every table drizzle knows about, for wiping between tests. */
function allTableNames(): string[] {
  return Object.values(schema)
    .filter((value) => is(value, Table))
    .map((table) => getTableName(table as Table));
}

export class TestSqliteDatabase {
  private sqlite: Database.Database | null = null;
  private context: DatabaseContext | null = null;
  private readonly dialect: DatabaseDialect;

  constructor(dialect: DatabaseDialect = testDialect()) {
    this.dialect = dialect;
  }

  async connect(): Promise<DatabaseContext> {
    if (this.context) return this.context;

    if (this.dialect !== "sqlite") {
      this.context = await this.connectRemote();
      return this.context;
    }

    this.sqlite = new Database(":memory:");
    this.sqlite.exec("PRAGMA foreign_keys = ON");
    this.sqlite.exec(sqliteSchemaSql());
    this.context = {
      dialect: "sqlite",
      drizzle: drizzle(this.sqlite, { schema }),
    };

    return this.context;
  }

  private async connectRemote(): Promise<DatabaseContext> {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      throw new Error(
        `TEST_DIALECT=${this.dialect} requires TEST_DATABASE_URL to be set.`,
      );
    }

    const { drizzle: connect } = await import(
      this.dialect === "postgres"
        ? "drizzle-orm/node-postgres"
        : "drizzle-orm/mysql2"
    );
    const db = connect(url) as unknown as DatabaseContext["drizzle"];
    const context: DatabaseContext = { dialect: this.dialect, drizzle: db };

    const { runRemoteMigrations } =
      await import("../../../database/db/migrate.js");
    await runRemoteMigrations(this.dialect, db);
    await truncateAll(context);

    return context;
  }

  /**
   * Raw SQLite handle, for the few tests that assert on stored bytes or hand a
   * driver to a repository that still takes one. Unavailable elsewhere; those
   * tests guard themselves with `sqliteOnly`.
   */
  get raw(): Database.Database {
    if (!this.sqlite) {
      throw new Error(
        this.dialect === "sqlite"
          ? "connect() must be called before raw access"
          : `raw access is SQLite-only; this run is against ${this.dialect}`,
      );
    }
    return this.sqlite;
  }

  /**
   * Runs seed SQL. Synchronous on SQLite, which is what the tests were written
   * against; on the other engines it returns a promise the caller must await.
   *
   * The seeds are plain INSERTs, portable apart from identifier quoting, which
   * `portableSql` fixes up.
   */
  exec(statements: string): void | Promise<void> {
    if (this.sqlite) {
      this.sqlite.exec(statements);
      return;
    }
    const context = this.context;
    if (!context) throw new Error("connect() must be called before exec()");

    return (async () => {
      for (const statement of splitStatements(statements)) {
        await runSql(context, sql.raw(portableSql(statement, context.dialect)));
      }
    })();
  }

  /**
   * Portable read for assertions. Build the statement with drizzle's `sql`
   * template so placeholders and quoting come out right on each engine.
   */
  async query<T = Record<string, unknown>>(statement: SQL): Promise<T[]> {
    if (!this.context)
      throw new Error("connect() must be called before query()");
    return runSql<T>(this.context, statement);
  }

  /** Portable write for test setup. */
  async run(statement: SQL): Promise<void> {
    if (!this.context) throw new Error("connect() must be called before run()");
    await runSql(this.context, statement);
  }

  async close(): Promise<void> {
    if (this.sqlite) {
      this.sqlite.close();
      this.sqlite = null;
    }
    this.context = null;
  }
}

async function runSql<T>(
  context: DatabaseContext,
  statement: SQL,
): Promise<T[]> {
  const db = context.drizzle as unknown as {
    all?: (s: SQL) => Promise<T[]> | T[];
    execute?: (s: SQL) => Promise<unknown>;
  };

  if (context.dialect === "sqlite" && db.all) {
    return (await db.all(statement)) as T[];
  }

  const result = (await db.execute!(statement)) as
    | { rows?: T[] }
    | T[]
    | undefined;

  // mysql2 answers [rows, fields]; node-postgres answers { rows }.
  if (Array.isArray(result)) {
    return (Array.isArray(result[0]) ? result[0] : result) as T[];
  }
  return (result?.rows ?? []) as T[];
}

/**
 * Empties every table between tests on the client-server engines, where the
 * database outlives the process and cannot be thrown away like an in-memory
 * SQLite one.
 */
async function truncateAll(context: DatabaseContext): Promise<void> {
  const tables = allTableNames();

  if (context.dialect === "postgres") {
    const list = tables.map((t) => `"${t}"`).join(", ");
    await runSql(
      context,
      sql.raw(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`),
    );
    return;
  }

  await runSql(context, sql.raw("SET FOREIGN_KEY_CHECKS = 0"));
  for (const table of tables) {
    await runSql(context, sql.raw(`TRUNCATE TABLE \`${table}\``));
  }
  await runSql(context, sql.raw("SET FOREIGN_KEY_CHECKS = 1"));
}

/**
 * Splits seed SQL into statements, ignoring semicolons inside string literals —
 * JSON payloads in the fixtures contain them.
 */
function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let current = "";
  let inString = false;

  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (ch === "'") {
      // '' is an escaped quote inside a string, not a delimiter.
      if (inString && sql[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
    }
    if (ch === ";" && !inString) {
      if (current.trim()) out.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

let cachedBooleanColumns: Set<string> | null = null;

/**
 * Columns the schema declares as booleans, by table.column.
 *
 * Read from drizzle rather than listed here, so a new boolean column needs no
 * change in this file.
 */
function booleanColumns(): Set<string> {
  if (cachedBooleanColumns) return cachedBooleanColumns;

  const found = new Set<string>();
  for (const value of Object.values(schema)) {
    if (!is(value, Table)) continue;
    const table = getTableName(value as Table);
    for (const column of Object.values(getTableColumns(value as Table))) {
      if (column.dataType === "boolean") found.add(`${table}.${column.name}`);
    }
  }
  cachedBooleanColumns = found;
  return found;
}

/**
 * Seeds are written in SQLite's dialect. Two things do not carry:
 *
 * - a reserved word used as a column name is `"order"` on SQLite and Postgres,
 *   `` `order` `` on MySQL
 * - SQLite stores booleans as 0/1, and writing an integer into a native boolean
 *   column is an error on Postgres. Every engine understands the TRUE/FALSE
 *   keywords, so boolean columns are rewritten to those.
 */
function portableSql(statement: string, dialect: DatabaseDialect): string {
  let out = rewriteBooleanLiterals(statement);
  if (dialect === "mysql") out = out.replace(/"([a-z_]+)"/g, "`$1`");
  return out;
}

/** Rewrites 0/1 to FALSE/TRUE in the value positions of boolean columns. */
function rewriteBooleanLiterals(statement: string): string {
  const booleans = booleanColumns();

  return statement.replace(
    /INSERT INTO\s+([a-z_]+)\s*\(([^)]*)\)\s*VALUES\s*((?:\([^()]*\)\s*,?\s*)+)/gis,
    (whole, table: string, cols: string, values: string) => {
      const names = cols.split(",").map((c) => c.trim().replace(/["`]/g, ""));
      const flags = names.map((n) => booleans.has(`${table}.${n}`));
      if (!flags.some(Boolean)) return whole;

      const rewritten = values.replace(
        /\(([^()]*)\)/g,
        (row, inner: string) => {
          const parts = splitValues(inner);
          return `(${parts
            .map((v, i) =>
              flags[i] && /^[01]$/.test(v.trim())
                ? v.trim() === "1"
                  ? "TRUE"
                  : "FALSE"
                : v,
            )
            .join(",")})`;
        },
      );
      return `INSERT INTO ${table} (${cols}) VALUES ${rewritten}`;
    },
  );
}

/** Splits a VALUES row on commas that are not inside a string literal. */
function splitValues(row: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inString = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === "'") {
      if (inString && row[i + 1] === "'") {
        current += "''";
        i++;
        continue;
      }
      inString = !inString;
    }
    if (ch === "," && !inString) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

let cachedSqliteSchema: string | null = null;

/**
 * The full schema, from the generated SQLite migration rather than hand-written
 * DDL in each test file.
 *
 * Tests used to declare a cut-down version of every table they touched — a
 * `users` with five columns where the real one has thirty. That drifts from the
 * schema silently, and it is the reason the same tests could not be pointed at
 * another engine.
 */
function sqliteSchemaSql(): string {
  if (cachedSqliteSchema) return cachedSqliteSchema;

  const dir = path.resolve(process.cwd(), "drizzle", "sqlite");
  const file = fs
    .readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .at(-1);

  if (!file) throw new Error(`No SQLite migration found in ${dir}`);

  cachedSqliteSchema = fs
    .readFileSync(path.join(dir, file), "utf8")
    .split("--> statement-breakpoint")
    .join("\n");

  return cachedSqliteSchema;
}
