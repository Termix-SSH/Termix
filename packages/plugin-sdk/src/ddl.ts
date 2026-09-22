/**
 * The DDL a table definition becomes, per dialect.
 *
 * Lives in the SDK because two things need the identical mapping: the CLI,
 * which writes a plugin's migration files, and the server, which applies them.
 * A second copy would drift and produce a migration the runner could not
 * reproduce.
 *
 * The mapping itself is the one scripts/generate-dialect-schema.cjs applies to
 * core's schema, kept deliberately in step with it.
 */

import { KEY_LENGTH, prefixedTableName } from "./db.js";
import type {
  PluginColumn,
  PluginTableDefinition,
  PluginTableIndex,
} from "./db.js";

/** Which engine the DDL is for. Matches core's DatabaseDialect exactly. */
export type SqlDialect = "sqlite" | "postgres" | "mysql";

/** The core tables a plugin may point a foreign key at, and nothing else. */
export const REFERENCEABLE = {
  refUser: { table: "users", column: "id" },
  refHost: { table: "ssh_data", column: "id" },
} as const;

function camelToSnake(value: string): string {
  return value.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

/** The SQL column name for a declared property. */
export function columnName(property: string, column?: PluginColumn): string {
  void column;
  return camelToSnake(property);
}

function quote(dialect: SqlDialect, identifier: string): string {
  if (dialect === "mysql") return "`" + identifier + "`";
  return '"' + identifier + '"';
}

/**
 * The physical type for a column on one dialect.
 *
 * Mirrors generate-dialect-schema.cjs: an autoincrement key is serial /
 * auto_increment, a boolean is native off sqlite, and anything carrying a key
 * has to be varchar because MySQL will not index TEXT.
 */
function columnType(
  dialect: SqlDialect,
  column: PluginColumn,
  keyed: boolean,
): string {
  switch (column.type) {
    case "id":
      if (dialect === "postgres") return "serial";
      if (dialect === "mysql") return "int AUTO_INCREMENT";
      return "integer";
    case "integer":
      return dialect === "mysql" ? "int" : "integer";
    case "bigint":
      return dialect === "sqlite" ? "integer" : "bigint";
    case "boolean":
      return dialect === "sqlite" ? "integer" : "boolean";
    case "varchar":
      return dialect === "sqlite"
        ? "text"
        : `varchar(${column.length ?? KEY_LENGTH})`;
    case "refUser":
      return dialect === "sqlite" ? "text" : `varchar(${KEY_LENGTH})`;
    case "refHost":
      return dialect === "mysql" ? "int" : "integer";
    default:
      // A keyed string has to be indexable, so it narrows to varchar even
      // though it was declared unbounded. defineTable refuses to index a
      // text/json column, so in practice this only catches a primary key.
      if (keyed && dialect !== "sqlite") return `varchar(${KEY_LENGTH})`;
      return "text";
  }
}

function defaultClause(dialect: SqlDialect, column: PluginColumn): string {
  if (column.defaultNow) {
    // MySQL rejects a bare DEFAULT CURRENT_TIMESTAMP on a text column; an
    // expression default is written parenthesised. MariaDB takes either.
    return dialect === "mysql"
      ? " DEFAULT (CURRENT_TIMESTAMP)"
      : " DEFAULT CURRENT_TIMESTAMP";
  }
  if (column.defaultValue === undefined) return "";
  const value = column.defaultValue;
  if (value === null) return " DEFAULT NULL";
  if (typeof value === "boolean") {
    return dialect === "sqlite"
      ? ` DEFAULT ${value ? 1 : 0}`
      : ` DEFAULT ${value ? "true" : "false"}`;
  }
  if (typeof value === "number") return ` DEFAULT ${value}`;
  return ` DEFAULT '${String(value).replace(/'/g, "''")}'`;
}

/** Every column that carries a key, and so must be indexable on MySQL. */
export function keyedColumns(
  definition: PluginTableDefinition,
): ReadonlySet<string> {
  const keyed = new Set<string>();
  for (const [property, column] of Object.entries(definition.columns)) {
    if (column.primaryKey || column.unique) keyed.add(property);
    if (column.type === "refUser" || column.type === "refHost") {
      keyed.add(property);
    }
  }
  for (const index of definition.indexes) {
    for (const property of index.columns) keyed.add(property);
  }
  return keyed;
}

function indexStatement(
  dialect: SqlDialect,
  physical: string,
  definition: PluginTableDefinition,
  entry: PluginTableIndex,
): string {
  const columns = entry.columns
    .map((property) =>
      quote(dialect, columnName(property, definition.columns[property])),
    )
    .join(", ");
  const unique = entry.unique ? "UNIQUE " : "";
  // MySQL has no CREATE INDEX IF NOT EXISTS. A plugin migration runs once,
  // recorded in plugin_migrations, so the guard is the ledger, not the DDL.
  const guard = dialect === "mysql" ? "" : "IF NOT EXISTS ";
  return `CREATE ${unique}INDEX ${guard}${quote(dialect, entry.name)} ON ${quote(dialect, physical)} (${columns});`;
}

/** The CREATE TABLE and CREATE INDEX statements for one definition. */
export function createTableSql(
  dialect: SqlDialect,
  pluginId: string,
  definition: PluginTableDefinition,
): string[] {
  const physical = prefixedTableName(pluginId, definition.name);
  const keyed = keyedColumns(definition);

  const lines: string[] = [];
  const constraints: string[] = [];

  for (const [property, column] of Object.entries(definition.columns)) {
    const name = columnName(property, column);
    const type = columnType(dialect, column, keyed.has(property));

    let line = `  ${quote(dialect, name)} ${type}`;
    if (column.type === "id") {
      line += " PRIMARY KEY";
      if (dialect === "sqlite") line += " AUTOINCREMENT";
    } else {
      if (column.primaryKey) line += " PRIMARY KEY";
      if (column.notNull) line += " NOT NULL";
      if (column.unique) line += " UNIQUE";
      line += defaultClause(dialect, column);
    }
    lines.push(line);

    const reference =
      column.type === "refUser"
        ? REFERENCEABLE.refUser
        : column.type === "refHost"
          ? REFERENCEABLE.refHost
          : null;
    if (reference) {
      constraints.push(
        `  FOREIGN KEY (${quote(dialect, name)}) REFERENCES ${quote(dialect, reference.table)} (${quote(dialect, reference.column)}) ON DELETE CASCADE`,
      );
    }
  }

  const body = [...lines, ...constraints].join(",\n");
  const statements = [
    `CREATE TABLE IF NOT EXISTS ${quote(dialect, physical)} (\n${body}\n);`,
  ];

  for (const entry of definition.indexes) {
    statements.push(indexStatement(dialect, physical, definition, entry));
  }

  return statements;
}

/** DROP statement for a definition, for removePluginData. */
/** DROP statement for a definition, for removePluginData. */
export function dropTableSql(
  dialect: SqlDialect,
  pluginId: string,
  definition: PluginTableDefinition,
): string {
  const physical = prefixedTableName(pluginId, definition.name);
  return `DROP TABLE IF EXISTS ${quote(dialect, physical)};`;
}

/** The ALTER that adds one newly declared column. */
export function addColumnSql(
  dialect: SqlDialect,
  pluginId: string,
  definition: PluginTableDefinition,
  property: string,
): string {
  const physical = prefixedTableName(pluginId, definition.name);
  const column = definition.columns[property];
  const keyed = keyedColumns(definition).has(property);
  const name = columnName(property, column);

  let line = `${quote(dialect, name)} ${columnType(dialect, column, keyed)}`;
  if (column.notNull) line += " NOT NULL";
  line += defaultClause(dialect, column);

  return `ALTER TABLE ${quote(dialect, physical)} ADD COLUMN ${line};`;
}
