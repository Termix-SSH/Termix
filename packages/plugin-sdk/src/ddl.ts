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

import { KEY_LENGTH, prefixedTableName, tablePrefix } from "./db.js";
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
    case "real":
      if (dialect === "sqlite") return "real";
      return dialect === "mysql" ? "double" : "double precision";
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

/** Column types that are TEXT on MySQL when nothing keys them. */
const TEXT_ON_MYSQL: ReadonlySet<PluginColumn["type"]> = new Set([
  "text",
  "json",
  "encryptedText",
  "timestamp",
]);

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
  const literal = `'${String(value).replace(/'/g, "''")}'`;
  // MySQL refuses a literal default on a TEXT column but takes an expression.
  if (dialect === "mysql" && TEXT_ON_MYSQL.has(column.type)) {
    return ` DEFAULT (${literal})`;
  }
  return ` DEFAULT ${literal}`;
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

function createStatements(
  dialect: SqlDialect,
  physical: string,
  definition: PluginTableDefinition,
): { table: string; indexes: string[] } {
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
  return {
    table: `CREATE TABLE IF NOT EXISTS ${quote(dialect, physical)} (\n${body}\n);`,
    indexes: definition.indexes.map((entry) =>
      indexStatement(dialect, physical, definition, entry),
    ),
  };
}

/** The CREATE TABLE and CREATE INDEX statements for one definition. */
export function createTableSql(
  dialect: SqlDialect,
  pluginId: string,
  definition: PluginTableDefinition,
): string[] {
  const physical = prefixedTableName(pluginId, definition.name);
  const { table, indexes } = createStatements(dialect, physical, definition);
  return [table, ...indexes];
}

/**
 * Takes over a legacy core table by renaming it into the plugin's namespace.
 *
 * A plain SQL migration cannot ask whether the legacy table exists, so it
 * creates it first when it does not (a fresh install) and then renames either
 * way. Both paths end with the same table and the same rows.
 *
 * Indexes are created on the legacy name with IF NOT EXISTS before the rename,
 * which is why an adopted definition keeps the legacy index names: an index
 * that already exists is left alone and follows the table. MySQL has no
 * CREATE INDEX IF NOT EXISTS, so there none are emitted. That is safe because
 * every legacy table reached MySQL through core's drizzle migrations, which
 * already created its indexes.
 */
export function adoptTableSql(
  dialect: SqlDialect,
  pluginId: string,
  definition: PluginTableDefinition,
): string[] {
  const legacy = definition.adopts;
  if (!legacy) {
    throw new Error(`Table "${definition.name}" does not adopt a legacy table`);
  }
  const physical = prefixedTableName(pluginId, definition.name);
  const { table, indexes } = createStatements(dialect, legacy, definition);

  const rename =
    dialect === "mysql"
      ? `RENAME TABLE ${quote(dialect, legacy)} TO ${quote(dialect, physical)};`
      : `ALTER TABLE ${quote(dialect, legacy)} RENAME TO ${quote(dialect, physical)};`;

  return [table, ...(dialect === "mysql" ? [] : indexes), rename];
}

/**
 * Splits a migration file into statements.
 *
 * Deliberately simple: statements end at a semicolon that is not inside a
 * string literal or a comment. A plugin needing more than that should put the
 * logic in its own code, not in DDL.
 */
export function splitStatements(source: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quoteChar: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    const next = source[i + 1];

    if (lineComment) {
      current += char;
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      current += char;
      if (char === "*" && next === "/") {
        current += next;
        i++;
        blockComment = false;
      }
      continue;
    }
    if (quoteChar) {
      current += char;
      // '' inside a quoted string is an escaped quote, not a terminator.
      if (char === quoteChar) {
        if (next === quoteChar) {
          current += next;
          i++;
        } else {
          quoteChar = null;
        }
      }
      continue;
    }

    if (char === "-" && next === "-") {
      lineComment = true;
      current += char;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      current += char;
      continue;
    }
    if (char === "'" || char === '"' || char === "`") {
      quoteChar = char;
      current += char;
      continue;
    }
    if (char === ";") {
      if (current.trim()) statements.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }

  if (current.trim()) statements.push(current.trim());
  return statements;
}

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

interface SqlToken {
  /** As written: a bare word keeps its case, a quoted name loses its quotes. */
  value: string;
  kind: "word" | "quoted" | "punct";
}

/**
 * Words and identifiers in one statement, with comments and string literals
 * dropped. `"x"`, `` `x` `` and `[x]` all come out as the identifier x, so no
 * quoting style hides a table name from the ownership check.
 */
function tokenize(source: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  while (i < source.length) {
    const char = source[i];
    const next = source[i + 1];
    if (/\s/.test(char)) {
      i++;
    } else if (char === "-" && next === "-") {
      while (i < source.length && source[i] !== "\n") i++;
    } else if (char === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end < 0 ? source.length : end + 2;
    } else if (char === "'") {
      i++;
      while (i < source.length) {
        if (source[i] === "'" && source[i + 1] === "'") i += 2;
        else if (source[i] === "'") break;
        else i++;
      }
      i++;
      tokens.push({ value: "'", kind: "punct" });
    } else if (char === '"' || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      let value = "";
      i++;
      while (i < source.length) {
        if (source[i] === close && source[i + 1] === close && close !== "]") {
          value += close;
          i += 2;
        } else if (source[i] === close) {
          break;
        } else {
          value += source[i++];
        }
      }
      i++;
      tokens.push({ value, kind: "quoted" });
    } else if (/[A-Za-z0-9_$]/.test(char)) {
      let value = "";
      while (i < source.length && /[A-Za-z0-9_$]/.test(source[i])) {
        value += source[i++];
      }
      tokens.push({ value, kind: "word" });
    } else {
      tokens.push({ value: char, kind: "punct" });
      i++;
    }
  }
  return tokens;
}

/** Statements a plugin migration may never contain. */
const REFUSED_STATEMENTS = new Set([
  "ATTACH",
  "DETACH",
  "PRAGMA",
  "GRANT",
  "REVOKE",
  "COPY",
  "LOAD",
  "DO",
  "CALL",
  "HANDLER",
  "WITH",
  "SET",
  "VACUUM",
]);

/** What a migration may CREATE, ALTER or DROP. Anything else is refused. */
const TABLE_OBJECTS = new Set(["TABLE", "VIEW"]);
const HARMLESS_OBJECTS = new Set(["SEQUENCE", "TYPE"]);

const CREATE_MODIFIERS = [
  "OR",
  "REPLACE",
  "TEMP",
  "TEMPORARY",
  "UNLOGGED",
  "GLOBAL",
  "LOCAL",
  "VIRTUAL",
  "UNIQUE",
  "CONCURRENTLY",
];

/**
 * Every problem with the tables a migration writes to.
 *
 * The check has to hold against a plugin that is trying, not only one that
 * made a typo, so it reads each statement the way the engine does rather
 * than matching one pattern: a comment between a keyword and a name, bracket
 * quoting, a second name in a DROP list, a schema-qualified name and
 * `ALTER ... RENAME TO users` are all seen. Reads (FROM, JOIN, REFERENCES)
 * are allowed; writes outside the plugin's prefix are not.
 *
 * `ownedLegacy` lists the legacy core tables this plugin adopts.
 */
export function findUnownedTableWrites(
  pluginId: string,
  sql: string,
  ownedLegacy: ReadonlySet<string> = new Set(),
): string[] {
  const prefix = tablePrefix(pluginId);
  const problems: string[] = [];

  for (const statement of splitStatements(sql)) {
    const tokens = tokenize(statement);
    if (tokens.length === 0) continue;
    const upper = (at: number) =>
      tokens[at]?.kind === "word" ? tokens[at].value.toUpperCase() : "";

    /** Checks the table name at `at`, returns the index after it. */
    const table = (at: number): number => {
      const name = tokens[at];
      if (!name || name.kind === "punct") {
        problems.push("a statement writes to a table with no name");
        return at + 1;
      }
      if (tokens[at + 1]?.value === ".") {
        problems.push(
          `"${name.value}.${tokens[at + 2]?.value ?? ""}" names a schema; a plugin may only write its own tables`,
        );
        return at + 3;
      }
      if (!name.value.startsWith(prefix) && !ownedLegacy.has(name.value)) {
        problems.push(
          `writes to "${name.value}", which is not prefixed "${prefix}"`,
        );
      }
      return at + 1;
    };
    const skip = (at: number, words: string[]) => {
      while (words.includes(upper(at))) at++;
      return at;
    };
    const find = (word: string, from = 0) => {
      for (let at = from; at < tokens.length; at++) {
        if (upper(at) === word) return at;
      }
      return -1;
    };

    const first = upper(0);
    if (REFUSED_STATEMENTS.has(first)) {
      problems.push(`${first} is not allowed in a plugin migration`);
      continue;
    }

    if (first === "CREATE" || first === "ALTER" || first === "DROP") {
      let at = skip(1, CREATE_MODIFIERS);
      const object = upper(at);
      if (object === "INDEX") {
        // The index name is free; the table after ON is what it writes to.
        const on = find("ON", at);
        if (on > 0) table(skip(on + 1, ["ONLY"]));
        continue;
      }
      if (HARMLESS_OBJECTS.has(object)) continue;
      if (!TABLE_OBJECTS.has(object)) {
        problems.push(
          `${first} ${object || tokens[at]?.value || ""} is not allowed in a plugin migration`.trim(),
        );
        continue;
      }
      at = table(skip(at + 1, ["IF", "NOT", "EXISTS", "ONLY"]));
      // DROP TABLE a, b drops both.
      while (first === "DROP" && tokens[at]?.value === ",") {
        at = table(at + 1);
      }
      // ALTER TABLE p_x RENAME TO users moves a table out of the namespace.
      // RENAME [COLUMN] a TO b renames a column and is fine.
      for (let rename = find("RENAME", at); rename > 0;) {
        const next = upper(rename + 1);
        if (next === "TO" || next === "AS") table(rename + 2);
        rename = find("RENAME", rename + 1);
      }
      continue;
    }

    if (first === "RENAME") {
      // RENAME TABLE a TO b, c TO d
      let at = skip(1, ["TABLE"]);
      while (at < tokens.length) {
        at = table(at);
        if (upper(at) !== "TO") break;
        at = table(at + 1);
        if (tokens[at]?.value !== ",") break;
        at++;
      }
      continue;
    }

    if (first === "TRUNCATE") {
      let at = table(skip(1, ["TABLE", "ONLY"]));
      while (tokens[at]?.value === ",") at = table(at + 1);
      continue;
    }

    if (first === "INSERT" || first === "REPLACE") {
      const into = find("INTO");
      if (into > 0) table(into + 1);
      else problems.push(`${first} without INTO is not allowed`);
      continue;
    }

    if (first === "UPDATE") {
      table(
        skip(1, [
          "OR",
          "ROLLBACK",
          "ABORT",
          "REPLACE",
          "FAIL",
          "IGNORE",
          "ONLY",
          "LOW_PRIORITY",
        ]),
      );
      continue;
    }

    if (first === "DELETE") {
      const from = find("FROM");
      if (from > 0) table(skip(from + 1, ["ONLY"]));
      else problems.push("DELETE without FROM is not allowed");
      continue;
    }

    if (first !== "SELECT" && first !== "COMMENT") {
      problems.push(
        `"${tokens[0].value}" statements are not allowed in a plugin migration`,
      );
    }
  }

  return problems;
}
