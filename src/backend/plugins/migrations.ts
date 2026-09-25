/**
 * Applies a plugin's migrations before it activates.
 *
 * A plugin ships plain SQL per dialect in migrations/<dialect>/NNNN_name.sql.
 * Not drizzle-kit: core's own SQLite schema is hand-written DDL and only the
 * client-server engines use drizzle migrations, so a plugin that used
 * drizzle-kit would still need a hand-rolled SQLite path. One runner for all
 * three keeps a plugin's tables identical everywhere.
 *
 * Failures are contained. An edited migration that already ran blocks that
 * plugin; a migration that throws marks it failed. Core keeps booting either
 * way, because one plugin's bad SQL is not a reason to take the server down.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { pluginLogger } from "../utils/logger.js";
import type { DatabaseDialect } from "../database/db/dialect.js";
import { tablePrefix, LEGACY_TABLE_OWNERS } from "@termix/plugin-sdk/db";
import { splitStatements } from "@termix/plugin-sdk/ddl";

// The splitter is shared with createTestDb in the SDK, so tests apply a
// migration exactly the way this runner does.
export { LEGACY_TABLE_OWNERS, splitStatements };

/** Dialect directory names, matching DatabaseDialect exactly. */
const DIALECTS: readonly DatabaseDialect[] = ["sqlite", "postgres", "mysql"];

const FILE_PATTERN = /^(\d{4})_([a-z0-9_]+)\.sql$/;

export interface PluginMigration {
  /** The file's stem, e.g. "0001_init". Stable across dialects. */
  id: string;
  sequence: number;
  file: string;
  sql: string;
  checksum: string;
}

/** Raised when an already-applied migration no longer matches its checksum. */
export class PluginMigrationChecksumError extends Error {
  readonly code = "EPLUGINMIGRATIONCHECKSUM";
  constructor(pluginId: string, migrationId: string) {
    super(
      `Plugin "${pluginId}" migration "${migrationId}" has changed since it was applied. ` +
        `An applied migration is immutable: add a new one instead of editing this file.`,
    );
    this.name = "PluginMigrationChecksumError";
  }
}

export function checksum(contents: string): string {
  // Normalised so a line-ending change between platforms is not a mismatch.
  const normalised = contents.replace(/\r\n/g, "\n").trimEnd();
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

function migrationsDir(pluginDir: string, dialect: DatabaseDialect): string {
  return path.join(pluginDir, "migrations", dialect);
}

/** Reads the migrations a plugin ships for one dialect, in sequence order. */
export function readMigrations(
  pluginDir: string,
  dialect: DatabaseDialect,
): PluginMigration[] {
  const dir = migrationsDir(pluginDir, dialect);
  if (!fs.existsSync(dir)) return [];

  const migrations: PluginMigration[] = [];
  for (const file of fs.readdirSync(dir).sort()) {
    const match = FILE_PATTERN.exec(file);
    if (!match) {
      if (file.endsWith(".sql")) {
        throw new Error(
          `Migration "${file}" must be named NNNN_name.sql, lower snake_case`,
        );
      }
      continue;
    }
    const contents = fs.readFileSync(path.join(dir, file), "utf8");
    migrations.push({
      id: file.replace(/\.sql$/, ""),
      sequence: Number(match[1]),
      file,
      sql: contents,
      checksum: checksum(contents),
    });
  }

  migrations.sort((a, b) => a.sequence - b.sequence);
  return migrations;
}

/**
 * Tables a migration may create or alter.
 *
 * A plugin owns the p_<id>_ namespace and nothing else. Enforced here as well
 * as in the CLI, because a plugin installed from a tarball never ran the CLI.
 */
const CREATE_OR_ALTER =
  /\b(?:CREATE\s+(?:TEMP\s+|TEMPORARY\s+)?TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE|DROP\s+TABLE(?:\s+IF\s+EXISTS)?|TRUNCATE\s+TABLE)\s+([`"']?)([a-zA-Z0-9_]+)\1/gi;

/**
 * Checks that every table a migration touches belongs to this plugin.
 *
 * A legacy table it is allowed to adopt is permitted too, because adoption
 * renames it into the plugin's namespace in the same migration.
 */
export function assertOwnedTables(
  pluginId: string,
  statements: string[],
): void {
  const prefix = tablePrefix(pluginId);

  for (const statement of statements) {
    CREATE_OR_ALTER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CREATE_OR_ALTER.exec(statement)) !== null) {
      const table = match[2];
      if (table.startsWith(prefix)) continue;
      if (LEGACY_TABLE_OWNERS[table] === pluginId) continue;

      const owner = LEGACY_TABLE_OWNERS[table];
      throw new Error(
        owner
          ? `Plugin "${pluginId}" may not touch "${table}": it belongs to the "${owner}" plugin.`
          : `Plugin "${pluginId}" may only create or alter tables prefixed "${prefix}", not "${table}".`,
      );
    }
  }
}

export interface AppliedMigration {
  migrationId: string;
  checksum: string;
}

export interface MigrationRunner {
  dialect: DatabaseDialect;
  listApplied: (pluginId: string) => Promise<AppliedMigration[]>;
  execute: (statements: string[]) => Promise<void>;
  record: (pluginId: string, migration: PluginMigration) => Promise<void>;
  /** Runs fn inside a transaction where the dialect supports DDL in one. */
  transaction?: (fn: () => Promise<void>) => Promise<void>;
}

/**
 * Brings one plugin's tables up to date.
 *
 * Returns the ids applied, so a caller can log what changed. Throws on a
 * checksum mismatch or a failing statement; the loader turns either into a
 * failed plugin without disturbing the rest of the server.
 */
export async function applyPluginMigrations(
  pluginId: string,
  pluginDir: string,
  runner: MigrationRunner,
): Promise<string[]> {
  const migrations = readMigrations(pluginDir, runner.dialect);
  if (migrations.length === 0) return [];

  const applied = new Map(
    (await runner.listApplied(pluginId)).map((row) => [
      row.migrationId,
      row.checksum,
    ]),
  );

  const pending: PluginMigration[] = [];
  for (const migration of migrations) {
    const previous = applied.get(migration.id);
    if (previous === undefined) {
      pending.push(migration);
      continue;
    }
    if (previous !== migration.checksum) {
      throw new PluginMigrationChecksumError(pluginId, migration.id);
    }
  }

  if (pending.length === 0) return [];

  const run = async () => {
    for (const migration of pending) {
      const statements = splitStatements(migration.sql);
      assertOwnedTables(pluginId, statements);
      await runner.execute(statements);
      await runner.record(pluginId, migration);
    }
  };

  if (runner.transaction) {
    await runner.transaction(run);
  } else {
    await run();
  }

  pluginLogger.info(
    `Applied ${pending.length} migration(s) for plugin ${pluginId}: ${pending
      .map((m) => m.id)
      .join(", ")}`,
    { operation: "plugin_migrate" },
  );

  return pending.map((migration) => migration.id);
}

/**
 * Renames a legacy core table into a plugin's namespace, or creates it fresh.
 *
 * Adoption is how a feature keeps its data when it moves out of core. The
 * table is renamed rather than copied so nothing is duplicated and nothing has
 * to be migrated row by row.
 */
export function adoptLegacyTableSql(
  dialect: DatabaseDialect,
  legacyName: string,
  newName: string,
): string {
  if (dialect === "mysql") {
    return `RENAME TABLE \`${legacyName}\` TO \`${newName}\`;`;
  }
  return `ALTER TABLE "${legacyName}" RENAME TO "${newName}";`;
}

/** Whether a table exists, asked in the dialect's own catalog. */
export function tableExistsSql(dialect: DatabaseDialect, table: string) {
  if (dialect === "sqlite") {
    return sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${table}`;
  }
  if (dialect === "postgres") {
    return sql`SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ${table}`;
  }
  return sql`SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ${table}`;
}
