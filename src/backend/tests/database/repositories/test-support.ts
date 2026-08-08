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

    await migrateOnce(this.dialect, db);
    await truncateAll(context);

    return context;
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
      const touched = new Set<string>();
      for (const statement of splitStatements(statements)) {
        await runSql(context, sql.raw(portableSql(statement, context.dialect)));
        const table = /INSERT INTO\s+([a-z_]+)/i.exec(statement)?.[1];
        if (table) touched.add(table);
      }
      await resyncAutoIncrement(context, touched);
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

  /**
   * Portable write for test setup.
   *
   * Separate from query() because better-sqlite3 refuses `.all()` on a
   * statement that returns no rows — "This statement does not return data".
   */
  async run(statement: SQL): Promise<void> {
    const context = this.context;
    if (!context) throw new Error("connect() must be called before run()");

    if (this.sqlite) {
      (context.drizzle as unknown as { run: (s: SQL) => unknown }).run(
        statement,
      );
      return;
    }
    await runSql(context, statement);
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
    { rows?: T[] } | T[] | undefined;

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

  // Truncating all 53 tables takes ~2s on MySQL, which every test would pay.
  // Ask which ones actually hold rows first: after the first test only a
  // handful do, and the check is a single query.
  // Each branch is parenthesised: LIMIT binds to the whole UNION otherwise.
  const counts = tables
    .map((t) => `(SELECT '${t}' AS name FROM \`${t}\` LIMIT 1)`)
    .join(" UNION ALL ");
  const occupied = await runSql<{ name: string }>(context, sql.raw(counts));
  if (occupied.length === 0) return;

  await runSql(context, sql.raw("SET FOREIGN_KEY_CHECKS = 0"));
  for (const { name } of occupied) {
    await runSql(context, sql.raw(`TRUNCATE TABLE \`${name}\``));
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
  const out = rewriteBooleanLiterals(statement);
  if (dialect !== "mysql") return out;

  // Only the column list, before VALUES. A blanket replace also mangles the
  // double quotes inside JSON payloads in the values — '{"slots":[]}' became
  // '{`slots`:[]}', which is valid SQL and silently wrong data.
  const split = /^(.*?\bVALUES\b)(.*)$/is.exec(out);
  if (!split) return out.replace(/"([a-z_]+)"/g, "`$1`");
  return split[1].replace(/"([a-z_]+)"/g, "`$1`") + split[2];
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

/**
 * Moves each table's id generator past the ids the seed inserted by hand.
 *
 * SQLite picks `max(id) + 1` when a row omits the key, so a fixture that writes
 * `id = 1, 2, 3` and then lets the repository insert one more just works. A
 * Postgres sequence or a MySQL auto_increment counter does not know about rows
 * inserted with an explicit id, so it hands out 1 again and the insert collides
 * with the fixture's own data.
 */
async function resyncAutoIncrement(
  context: DatabaseContext,
  tables: Set<string>,
): Promise<void> {
  for (const table of tables) {
    // Only tables whose id is generated. A text primary key, like users.id,
    // has no sequence and no counter to move, and a table keyed on something
    // else entirely — host_sidebar_preferences.user_id — has no id at all.
    if (context.dialect === "postgres") {
      // pg_get_serial_sequence() raises 42703 rather than returning null when
      // the column is missing, so let information_schema decide whether there
      // is an id to ask about: no id column yields no row.
      const [seq] = await runSql<{ name: string | null }>(
        context,
        sql.raw(
          `SELECT pg_get_serial_sequence('${table}', 'id') AS name ` +
            `FROM information_schema.columns ` +
            `WHERE table_schema = current_schema() AND table_name = '${table}' ` +
            `AND column_name = 'id'`,
        ),
      );
      if (!seq?.name) continue;

      await runSql(
        context,
        sql.raw(
          `SELECT setval('${seq.name}', ` +
            `COALESCE((SELECT MAX(id) FROM "${table}"), 0) + 1, false)`,
        ),
      );
      continue;
    }

    const [column] = await runSql<{ extra: string }>(
      context,
      sql.raw(
        `SELECT EXTRA AS extra FROM information_schema.columns ` +
          `WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' ` +
          `AND COLUMN_NAME = 'id'`,
      ),
    );
    if (!column?.extra?.includes("auto_increment")) continue;

    const [row] = await runSql<{ next: number | null }>(
      context,
      sql.raw(`SELECT MAX(id) + 1 AS next FROM \`${table}\``),
    );
    if (row?.next) {
      await runSql(
        context,
        sql.raw(`ALTER TABLE \`${table}\` AUTO_INCREMENT = ${row.next}`),
      );
    }
  }
}

/**
 * Migrations run once per worker, not once per fixture.
 *
 * Every test builds a fixture, and each would otherwise re-run the migrator
 * against the same shared database. drizzle's journal makes that a no-op only
 * when the first run finished — several fixtures racing inside one file hit
 * "table already exists" instead.
 */
const migrations = new Map<string, Promise<void>>();

function migrateOnce(
  dialect: DatabaseDialect,
  db: DatabaseContext["drizzle"],
): Promise<void> {
  const key = `${dialect}:${process.env.TEST_DATABASE_URL}`;
  let running = migrations.get(key);
  if (!running) {
    running = (async () => {
      const { runRemoteMigrations } =
        await import("../../../database/db/migrate.js");
      await runRemoteMigrations(dialect, db);
    })();
    migrations.set(key, running);
  }
  return running;
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
