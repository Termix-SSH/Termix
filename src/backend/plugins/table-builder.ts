/**
 * Turns a plugin's table definition into the Drizzle table it is queried
 * through. The implementation lives in the SDK so createTestDb builds exactly
 * the table the server does; the DDL emitters are there too, because
 * termix-plugin writes the same SQL this server applies. Re-exported here so
 * core keeps one import site.
 */

export { buildTable } from "@termix/plugin-sdk/table-builder";
export {
  createTableSql,
  adoptTableSql,
  dropTableSql,
  addColumnSql,
  keyedColumns,
  columnName,
  REFERENCEABLE,
} from "@termix/plugin-sdk/ddl";
