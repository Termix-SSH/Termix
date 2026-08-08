import * as sqlite from "drizzle-orm/sqlite-core";
import * as pg from "drizzle-orm/pg-core";
import * as mysql from "drizzle-orm/mysql-core";

/**
 * Per-dialect column constructors, so a table can be declared once instead of
 * three times.
 *
 * The existing schema only uses three column types (text, integer, real) plus
 * an integer-backed boolean, which is what makes this tractable — the surface
 * to abstract is small and closed. Anything a dialect cannot express the same
 * way is spelled out here rather than at 52 call sites.
 *
 * Notable differences this papers over:
 * - booleans are integers in SQLite, native in Postgres and tinyint in MySQL
 * - autoincrement keys are `integer primary key autoincrement`, `serial`, and
 *   `int auto_increment` respectively
 * - MySQL cannot index an unbounded TEXT, so keyed/indexed strings must be
 *   varchar; `shortText` exists for columns used as keys or in unique indexes
 */
export interface ColumnKit {
  table: typeof sqlite.sqliteTable | typeof pg.pgTable | typeof mysql.mysqlTable;
  /** Free-form string; unbounded where the engine allows it. */
  text: (name: string) => AnyColumnBuilder;
  /** String used as a key, unique or indexed — bounded so MySQL can index it. */
  shortText: (name: string, length?: number) => AnyColumnBuilder;
  int: (name: string) => AnyColumnBuilder;
  /** Auto-incrementing surrogate primary key. */
  serial: (name: string) => AnyColumnBuilder;
  bool: (name: string) => AnyColumnBuilder;
  real: (name: string) => AnyColumnBuilder;
}

// drizzle's builders are heavily generic; the schema modules keep their own
// precise types, so this alias only exists to describe the kit's shape.
type AnyColumnBuilder = ReturnType<typeof sqlite.text>;

const DEFAULT_KEY_LENGTH = 255;

export const sqliteKit = {
  table: sqlite.sqliteTable,
  text: (name: string) => sqlite.text(name),
  shortText: (name: string) => sqlite.text(name),
  int: (name: string) => sqlite.integer(name),
  serial: (name: string) =>
    sqlite.integer(name).primaryKey({ autoIncrement: true }),
  bool: (name: string) => sqlite.integer(name, { mode: "boolean" }),
  real: (name: string) => sqlite.real(name),
} as const;

export const pgKit = {
  table: pg.pgTable,
  text: (name: string) => pg.text(name),
  shortText: (name: string, length = DEFAULT_KEY_LENGTH) =>
    pg.varchar(name, { length }),
  int: (name: string) => pg.integer(name),
  serial: (name: string) => pg.serial(name).primaryKey(),
  bool: (name: string) => pg.boolean(name),
  real: (name: string) => pg.doublePrecision(name),
} as const;

export const mysqlKit = {
  table: mysql.mysqlTable,
  text: (name: string) => mysql.text(name),
  shortText: (name: string, length = DEFAULT_KEY_LENGTH) =>
    mysql.varchar(name, { length }),
  int: (name: string) => mysql.int(name),
  serial: (name: string) => mysql.int(name).autoincrement().primaryKey(),
  bool: (name: string) => mysql.boolean(name),
  real: (name: string) => mysql.double(name),
} as const;
