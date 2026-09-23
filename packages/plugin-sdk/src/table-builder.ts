/**
 * Turns a plugin's table definition into the Drizzle table it is queried
 * through.
 *
 * One table object for every dialect. The sqlite-core definitions already
 * encode correctly on each engine at query time, so the repositories use them
 * everywhere; only DDL genuinely differs, and that lives in the SDK's ddl
 * entry so the CLI and the server share one mapping.
 */

import {
  sqliteTable,
  text as sqliteText,
  integer as sqliteInteger,
  index as sqliteIndex,
  uniqueIndex as sqliteUniqueIndex,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";
import { prefixedTableName } from "./db.js";
import type { PluginTableDefinition } from "./db.js";
import { columnName } from "./ddl.js";

type ColumnChain = {
  notNull: () => unknown;
  primaryKey: () => unknown;
  unique: () => unknown;
  default: (value: unknown) => unknown;
};

/**
 * Builds the queryable table object.
 *
 * Always sqlite-core, on every dialect. drizzle's three table classes share no
 * base class, and the query-builder surface a plugin uses is identical across
 * them.
 */
export function buildTable(
  pluginId: string,
  definition: PluginTableDefinition,
): unknown {
  const physical = prefixedTableName(pluginId, definition.name);

  const columns: Record<string, unknown> = {};
  for (const [property, column] of Object.entries(definition.columns)) {
    const name = columnName(property, column);
    let built: unknown;

    switch (column.type) {
      case "id":
        built = sqliteInteger(name).primaryKey({ autoIncrement: true });
        break;
      case "integer":
      case "bigint":
      case "refHost":
        built = sqliteInteger(name);
        break;
      case "boolean":
        built = sqliteInteger(name, { mode: "boolean" });
        break;
      default:
        built = sqliteText(name);
        break;
    }

    if (column.type !== "id") {
      if (column.primaryKey) built = (built as ColumnChain).primaryKey();
      if (column.notNull) built = (built as ColumnChain).notNull();
      if (column.unique) built = (built as ColumnChain).unique();
      if (column.defaultNow) {
        built = (built as ColumnChain).default(sql`CURRENT_TIMESTAMP`);
      } else if (column.defaultValue !== undefined) {
        built = (built as ColumnChain).default(column.defaultValue);
      }
    }

    columns[property] = built;
  }

  return sqliteTable(physical, columns as never, (table) =>
    definition.indexes.map((entry) => {
      const make = entry.unique ? sqliteUniqueIndex : sqliteIndex;
      const target = table as unknown as Record<string, AnySQLiteColumn>;
      return make(entry.name).on(
        ...(entry.columns.map((c) => target[c]) as [
          AnySQLiteColumn,
          ...AnySQLiteColumn[],
        ]),
      );
    }),
  );
}

/**
 * A minimal stand-in for a core table, for tests that join against users or
 * ssh_data without core's schema. Only what createTestDb's stubs declare.
 */
export function buildRefTable(
  name: string,
  columns: Record<string, "text" | "integer">,
): unknown {
  const built: Record<string, unknown> = {};
  for (const [property, type] of Object.entries(columns)) {
    built[property] =
      type === "integer" ? sqliteInteger(property) : sqliteText(property);
  }
  return sqliteTable(name, built as never);
}
