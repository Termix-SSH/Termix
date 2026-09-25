/**
 * The live database side of plugin-owned data.
 *
 * Holds the table definitions each plugin has registered, builds the runner
 * that applies its migrations against the real database, and drops everything
 * again on uninstall. The pure logic lives in migrations.ts so it can be
 * tested without a database; this file is the part that needs one.
 */

import { sql } from "drizzle-orm";
import { pluginLogger } from "../utils/logger.js";
import { resolveDatabaseDialect } from "../database/db/dialect.js";
import type { DatabaseDialect } from "../database/db/dialect.js";
import type { PluginTableDefinition } from "@termix/plugin-sdk/db";
import { prefixedTableName, tablePrefix } from "@termix/plugin-sdk/db";
import { buildTable } from "./table-builder.js";
import {
  applyPluginMigrations,
  readMigrations,
  type MigrationRunner,
} from "./migrations.js";

/** Definitions registered by a plugin, in the order it declared them. */
const registered = new Map<string, PluginTableDefinition[]>();
/** Built table objects, keyed by plugin id then definition name. */
const built = new Map<string, Map<string, unknown>>();

export function registerTable(
  pluginId: string,
  definition: PluginTableDefinition,
): unknown {
  const definitions = registered.get(pluginId) ?? [];
  const existing = definitions.find((entry) => entry.name === definition.name);
  if (existing) {
    // Re-registering on re-activation is normal: the module is cached, so
    // activate runs again against the same definitions.
    return getTable(pluginId, definition.name);
  }

  definitions.push(definition);
  registered.set(pluginId, definitions);

  const table = buildTable(pluginId, definition);
  const tables = built.get(pluginId) ?? new Map<string, unknown>();
  tables.set(definition.name, table);
  built.set(pluginId, tables);

  return table;
}

function getTable(pluginId: string, name: string): unknown {
  return built.get(pluginId)?.get(name);
}

function listTables(pluginId: string): PluginTableDefinition[] {
  return [...(registered.get(pluginId) ?? [])];
}

/** Every registered definition, with the plugin that owns it. */
export function listAllTables(): Array<{
  pluginId: string;
  definition: PluginTableDefinition;
}> {
  return [...registered.entries()].flatMap(([pluginId, definitions]) =>
    definitions.map((definition) => ({ pluginId, definition })),
  );
}

/** Forgets a plugin's definitions. Used by the tests and by uninstall. */
function forgetTables(pluginId: string): void {
  registered.delete(pluginId);
  built.delete(pluginId);
}

export function resetPluginData(): void {
  registered.clear();
  built.clear();
}

async function execute(statements: string[]): Promise<void> {
  const { getDb } = await import("../database/db/index.js");
  const db = getDb();
  for (const statement of statements) {
    await db.run(sql.raw(statement));
  }
}

/**
 * Builds the runner that applies migrations against the live database.
 *
 * No transaction on any engine: MySQL commits implicitly on DDL, and each
 * migration is recorded once it has run, so a retry after a failure starts
 * at the migration that failed.
 */
async function createMigrationRunner(
  dialect: DatabaseDialect = resolveDatabaseDialect(),
): Promise<MigrationRunner> {
  const { createCurrentPluginMigrationRepository } =
    await import("../database/repositories/factory.js");
  const repository = createCurrentPluginMigrationRepository();

  return {
    dialect,
    listApplied: async (pluginId) => {
      const rows = await repository.listByPlugin(pluginId);
      return rows.map((row) => ({
        migrationId: row.migrationId,
        checksum: row.checksum,
      }));
    },
    execute,
    record: async (pluginId, migration) => {
      await repository.record(pluginId, migration.id, migration.checksum);
    },
  };
}

/**
 * Applies a plugin's migrations. Throws so the loader can fail the plugin.
 *
 * Returns early when the plugin ships none, before anything asks for a
 * database handle: most plugins own no tables, and activating one should not
 * require a connection it never uses.
 */
export async function migratePlugin(
  pluginId: string,
  pluginDir: string,
  options: { bundled?: boolean; dialect?: DatabaseDialect } = {},
): Promise<string[]> {
  const dialect = options.dialect ?? resolveDatabaseDialect();
  if (readMigrations(pluginDir, dialect).length === 0) return [];

  const runner = await createMigrationRunner(dialect);
  return applyPluginMigrations(pluginId, pluginDir, runner, {
    bundled: options.bundled,
  });
}

/**
 * Removes everything a plugin owns.
 *
 * Tables are found in the database's own catalog by the plugin's prefix, not
 * from what it registered this boot, so a plugin that never activated since
 * the restart still loses its tables. A longer prefix that belongs to another
 * known plugin is left alone. Disabling a plugin never calls this: data
 * outlives being turned off, and only an explicit uninstall throws it away.
 * Role permissions stay, so a role keeps them if the plugin comes back.
 */
export async function removePluginData(
  pluginId: string,
  options: { knownPluginIds?: string[]; dialect?: DatabaseDialect } = {},
): Promise<{ tables: string[]; kvKeys: number; migrations: number }> {
  const dialect = options.dialect ?? resolveDatabaseDialect();
  const tables = ownedTableNames(
    pluginId,
    await listDatabaseTables(dialect),
    options.knownPluginIds ?? [],
  );

  // Registered order reversed first, so a referencing table goes before the
  // one it points at; anything else after.
  const registeredOrder = listTables(pluginId)
    .map((definition) => prefixedTableName(pluginId, definition.name))
    .reverse();
  const ordered = [
    ...registeredOrder.filter((table) => tables.includes(table)),
    ...tables.filter((table) => !registeredOrder.includes(table)),
  ];

  const dropped: string[] = [];
  for (const table of ordered) {
    await execute([dropTableByName(dialect, table)]);
    dropped.push(table);
  }

  const {
    createCurrentPluginStorageRepository,
    createCurrentPluginMigrationRepository,
    createCurrentPluginPermissionGrantRepository,
    createCurrentPluginSettingsRepository,
  } = await import("../database/repositories/factory.js");

  const kvKeys =
    await createCurrentPluginStorageRepository().deleteByPlugin(pluginId);
  const migrations =
    await createCurrentPluginMigrationRepository().deleteByPlugin(pluginId);
  await createCurrentPluginPermissionGrantRepository().deleteByPlugin(pluginId);
  // Settings and the plugin's encrypted secrets go with it.
  await createCurrentPluginSettingsRepository().deleteByPlugin(pluginId);

  forgetTables(pluginId);

  pluginLogger.info(
    `Removed data for plugin ${pluginId}: ${dropped.length} table(s), ${kvKeys} kv key(s)`,
    { operation: "plugin_remove_data" },
  );

  return { tables: dropped, kvKeys, migrations };
}

/**
 * The tables in `all` that belong to this plugin: its prefix, minus any that
 * sit under a longer prefix another plugin owns.
 */
export function ownedTableNames(
  pluginId: string,
  all: string[],
  knownPluginIds: string[],
): string[] {
  const prefix = tablePrefix(pluginId);
  const longer = knownPluginIds
    .filter((id) => id !== pluginId)
    .map((id) => tablePrefix(id))
    .filter((other) => other.startsWith(prefix));
  return all.filter(
    (table) =>
      table.startsWith(prefix) &&
      !longer.some((other) => table.startsWith(other)),
  );
}

function dropTableByName(dialect: DatabaseDialect, table: string): string {
  const quoted = dialect === "mysql" ? "`" + table + "`" : `"${table}"`;
  return `DROP TABLE IF EXISTS ${quoted};`;
}

async function listDatabaseTables(dialect: DatabaseDialect): Promise<string[]> {
  const { getDb } = await import("../database/db/index.js");
  const db = getDb() as unknown as {
    all?: (query: unknown) => Promise<Array<Record<string, unknown>>>;
    execute?: (query: unknown) => Promise<unknown>;
  };
  if (dialect === "sqlite") {
    const rows = await db.all!(
      sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
    );
    return rows.map((row) => String(row.name));
  }
  const query =
    dialect === "postgres"
      ? sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = current_schema()`
      : sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = DATABASE()`;
  const result = await db.execute!(query);
  // node-postgres answers { rows }, mysql2 answers [rows, fields].
  const rows = (
    Array.isArray(result) ? result[0] : (result as { rows?: unknown[] }).rows
  ) as Array<Record<string, unknown>>;
  return rows.map((row) => String(row.name ?? row.NAME));
}
