import { is } from "drizzle-orm/entity";
import { Table, getTableName } from "drizzle-orm/table";

/**
 * The name of a Drizzle table, or undefined for anything else. Drizzle's
 * `is` reads the prototype's constructor, so objects without a prototype
 * (an EventEmitter's `_events`) are skipped first.
 */
export function drizzleTableName(value: object): string | undefined {
  if (Object.getPrototypeOf(value) === null) return undefined;
  return is(value, Table) ? getTableName(value as never) : undefined;
}
