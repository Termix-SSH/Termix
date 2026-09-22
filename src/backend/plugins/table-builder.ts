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
import { prefixedTableName } from "@termix/plugin-sdk/db";
import type { PluginTableDefinition } from "@termix/plugin-sdk/db";
import { columnName } from "@termix/plugin-sdk/ddl";

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
 * them - the same deliberate approximation repositories/database-context.ts
 * documents for core.
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

// The DDL emitters live in the SDK, because termix-plugin writes the same SQL
// this server applies. Re-exported here so core keeps one import site.
export {
  createTableSql,
  dropTableSql,
  addColumnSql,
  keyedColumns,
  columnName,
  REFERENCEABLE,
} from "@termix/plugin-sdk/ddl";
