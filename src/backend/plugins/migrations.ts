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
import { LEGACY_TABLE_OWNERS } from "@termix/plugin-sdk/db";
import {
  findUnownedTableWrites,
  splitStatements,
} from "@termix/plugin-sdk/ddl";

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
  // A symlinked folder or file could feed in SQL from anywhere on disk.
  const realRoot = fs.realpathSync(pluginDir);
  const inside = (target: string) => {
    const relative = path.relative(realRoot, fs.realpathSync(target));
    return !relative.startsWith("..") && !path.isAbsolute(relative);
  };
  if (!inside(dir)) {
    throw new Error("The migrations folder resolves outside the plugin");
  }

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
    if (!inside(path.join(dir, file))) {
      throw new Error(`Migration "${file}" resolves outside the plugin`);
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
 * Checks that every table a migration writes to belongs to this plugin.
 *
 * A plugin owns the p_<id>_ namespace and nothing else. Enforced here as well
 * as in the CLI, because a plugin installed from a tarball never ran the CLI.
 * A legacy core table is allowed only for the bundled plugin that adopts it:
 * a user plugin with the same id gets no exemption.
 */
export function assertOwnedTables(
  pluginId: string,
  sql: string,
  options: { bundled?: boolean } = {},
): void {
  const legacy = new Set(
    options.bundled
      ? Object.entries(LEGACY_TABLE_OWNERS)
          .filter(([, owner]) => owner === pluginId)
          .map(([table]) => table)
      : [],
  );
  const problems = findUnownedTableWrites(pluginId, sql, legacy).map(
    (problem) => {
      // Name the owner when the table is another plugin's legacy table.
      const table = /writes to "([^"]+)"/.exec(problem)?.[1];
      const owner = table ? LEGACY_TABLE_OWNERS[table] : undefined;
      return owner && owner !== pluginId
        ? `may not touch "${table}": it belongs to the "${owner}" plugin`
        : problem;
    },
  );
  if (problems.length > 0) {
    throw new Error(
      `Plugin "${pluginId}" migration refused: ${problems.join("; ")}`,
    );
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
  options: { bundled?: boolean } = {},
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
      assertOwnedTables(pluginId, migration.sql, options);
      const statements = splitStatements(migration.sql);
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
