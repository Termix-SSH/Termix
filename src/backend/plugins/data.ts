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
import { prefixedTableName } from "@termix/plugin-sdk/db";
import { buildTable, dropTableSql } from "./table-builder.js";
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
 * SQLite gets a transaction; the client-server engines do not, because MySQL
 * commits implicitly on DDL so a "transaction" there would only be a promise
 * the engine does not keep. A half-applied migration is recorded statement by
 * statement either way, so a retry resumes rather than repeating.
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
  dialect: DatabaseDialect = resolveDatabaseDialect(),
): Promise<string[]> {
  if (readMigrations(pluginDir, dialect).length === 0) return [];

  const runner = await createMigrationRunner(dialect);
  return applyPluginMigrations(pluginId, pluginDir, runner);
}

/**
 * Removes everything a plugin owns.
 *
 * Tables go in reverse registration order so a table referenced by a later one
 * is dropped last. Disabling a plugin never calls this: data outlives being
 * turned off, and only an explicit uninstall throws it away.
 */
export async function removePluginData(
  pluginId: string,
  dialect: DatabaseDialect = resolveDatabaseDialect(),
): Promise<{ tables: string[]; kvKeys: number; migrations: number }> {
  const definitions = listTables(pluginId);
  const dropped: string[] = [];

  for (const definition of [...definitions].reverse()) {
    await execute([dropTableSql(dialect, pluginId, definition)]);
    dropped.push(prefixedTableName(pluginId, definition.name));
  }

  const {
    createCurrentPluginStorageRepository,
    createCurrentPluginMigrationRepository,
    createCurrentPluginPermissionGrantRepository,
  } = await import("../database/repositories/factory.js");

  const kvKeys =
    await createCurrentPluginStorageRepository().deleteByPlugin(pluginId);
  const migrations =
    await createCurrentPluginMigrationRepository().deleteByPlugin(pluginId);
  await createCurrentPluginPermissionGrantRepository().deleteByPlugin(pluginId);

  forgetTables(pluginId);

  pluginLogger.info(
    `Removed data for plugin ${pluginId}: ${dropped.length} table(s), ${kvKeys} kv key(s)`,
    { operation: "plugin_remove_data" },
  );

  return { tables: dropped, kvKeys, migrations };
}
