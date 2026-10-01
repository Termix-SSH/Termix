/**
 * Boots core the way starter.ts does, against a real SQLite database that
 * starts in 2.8 shape, with the plugin loader pointed at the built bundles in
 * dist/plugins rather than source. Shared by the boot and upgrade tests.
 *
 * Needs `npm run build` (or build:sdk and build:plugins) first.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { DATA_DIR_TOKEN } from "../fixtures/upgrade/rows.js";
import { remoteTestDialect, seedRemote28 } from "./remote-seed.js";

export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const BUILT_PLUGINS_DIR = path.join(REPO_ROOT, "dist", "plugins");
const SCHEMA_28 = path.join(__dirname, "../fixtures/sqlite-2.8-schema.sql");
/** The committed 2.8 install: db.sqlite, the fixture.env it was keyed with and its files. */
export const UPGRADE_FIXTURE_DIR = path.join(__dirname, "../fixtures/upgrade");

/** Every plugin in the repo, by folder. */
export function sourcePluginIds(): string[] {
  const root = path.join(REPO_ROOT, "plugins");
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(root, entry.name, "manifest.json")),
    )
    .map((entry) => entry.name)
    .sort();
}

/** Throws with the fix when dist/plugins is missing a plugin. */
export function assertPluginsBuilt(): void {
  const missing = sourcePluginIds().filter(
    (id) =>
      !fs.existsSync(path.join(BUILT_PLUGINS_DIR, id, "dist", "backend.js")),
  );
  if (missing.length > 0) {
    throw new Error(
      `dist/plugins is missing ${missing.join(", ")}. Run npm run build first.`,
    );
  }
}

export function builtManifest(id: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(BUILT_PLUGINS_DIR, id, "manifest.json"), "utf8"),
  );
}

type Row = Record<string, unknown>;

/** A 2.8 database in memory, with a helper that ignores unknown columns. */
export function create28Database() {
  const sqlite = new Database(":memory:");
  sqlite.exec(fs.readFileSync(SCHEMA_28, "utf8"));
  const columns = new Map<string, Set<string>>();
  const insert = (table: string, row: Row): number => {
    let known = columns.get(table);
    if (!known) {
      known = new Set(
        (
          sqlite.prepare(`PRAGMA table_info("${table}")`).all() as Array<{
            name: string;
          }>
        ).map((column) => column.name),
      );
      columns.set(table, known);
    }
    const entries = Object.entries(row).filter(([key]) => known!.has(key));
    const sql = `INSERT INTO "${table}" (${entries
      .map(([key]) => `"${key}"`)
      .join(", ")}) VALUES (${entries.map(() => "?").join(", ")})`;
    const values = entries.map(([, value]) =>
      typeof value === "boolean"
        ? value
          ? 1
          : 0
        : value !== null && typeof value === "object"
          ? JSON.stringify(value)
          : value,
    );
    return Number(sqlite.prepare(sql).run(...values).lastInsertRowid);
  };
  return { sqlite, insert };
}

export interface BootedCore {
  dataDir: string;
  /** The live database core and the plugins write to; null on Postgres and MySQL. */
  sqlite: Database.Database | null;
  /** The 2.8 database file exactly as it was written to DATA_DIR, if one was. */
  seed: Buffer | null;
  /** keepDataDir writes the database to disk and leaves DATA_DIR for another boot. */
  shutdown: (options?: { keepDataDir?: boolean }) => Promise<void>;
}

/** A 2.8 data directory to boot: a seeded database, or a folder holding one. */
export type BootSource =
  Database.Database | { fixtureDir: string } | { reuseDataDir: string };

/**
 * Lays a committed 2.8 install (fixtures/upgrade) into DATA_DIR: its key file
 * and the files its rows point at, with the fixture's DATA_DIR token in those
 * rows swapped for the real path, as 2.8 stored them absolute.
 */
function placeFixture(fixtureDir: string, dataDir: string): Buffer {
  fs.copyFileSync(
    path.join(fixtureDir, "fixture.env"),
    path.join(dataDir, ".env"),
  );
  fs.cpSync(path.join(fixtureDir, "files"), dataDir, { recursive: true });

  const sqlite = new Database(
    fs.readFileSync(path.join(fixtureDir, "db.sqlite")),
  );
  try {
    sqlite
      .prepare(
        "UPDATE session_recordings SET recording_path = replace(recording_path, ?, ?)",
      )
      .run(DATA_DIR_TOKEN, dataDir.split(path.sep).join("/"));
    return sqlite.serialize();
  } finally {
    sqlite.close();
  }
}

const SYSTEM_SECRETS = [
  "JWT_SECRET",
  "DATABASE_KEY",
  "ENCRYPTION_KEY",
  "INTERNAL_AUTH_TOKEN",
];

/**
 * Writes the seeded database into a fresh DATA_DIR and runs starter.ts's boot
 * sequence up to, not including, opening the HTTP server: the pre-upgrade
 * backup, the database, core's migrations, then the plugins and their data
 * moves. Call vi.resetModules() before, so module state from other tests is
 * gone.
 */
export async function bootCore(source: BootSource): Promise<BootedCore> {
  const dataDir =
    "reuseDataDir" in source
      ? source.reuseDataDir
      : fs.mkdtempSync(path.join(os.tmpdir(), "termix-boot-"));
  process.env.DATA_DIR = dataDir;
  process.env.DB_FILE_ENCRYPTION = "false";
  process.env.ALLOW_EMPTY_DATA_DIR = "true";
  process.env.TERMIX_BUNDLED_PLUGINS_DIR = BUILT_PLUGINS_DIR;
  // SystemCrypto prefers these over DATA_DIR/.env, and a previous boot in
  // this worker set them.
  for (const key of SYSTEM_SECRETS) delete process.env[key];

  let seed: Buffer | null = null;
  if (source instanceof Database) {
    seed = source.serialize();
  } else if ("fixtureDir" in source) {
    seed = placeFixture(source.fixtureDir, dataDir);
  }

  // TEST_DIALECT=postgres|mysql puts the same 2.8 data on a real server.
  const remote = remoteTestDialect();
  if (remote) {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) throw new Error(`TEST_DIALECT=${remote} needs TEST_DATABASE_URL`);
    process.env.DATABASE_DIALECT = remote;
    process.env.DATABASE_URL = url;
    if (seed) await seedRemote28(remote, url, seed);
  } else if (seed) {
    fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed);
  }

  const { SystemCrypto } = await import("../../utils/system-crypto.js");
  const systemCrypto = SystemCrypto.getInstance();
  await systemCrypto.initializeJWTSecret();
  await systemCrypto.initializeDatabaseKey();
  await systemCrypto.initializeEncryptionKey();
  await systemCrypto.initializeInternalAuthToken();

  const { backupBeforeUpgrade, runCoreBootMigrations } =
    await import("../../boot.js");
  await backupBeforeUpgrade({ dataDir, version: "2.9.0-test" });

  const db = await import("../../database/db/index.js");
  await db.initializeDatabase();

  await runCoreBootMigrations();

  const { primeKnownPermissions } =
    await import("../../utils/known-permissions.js");
  await primeKnownPermissions();

  const { initializePlugins, shutdownPlugins } =
    await import("../../plugins/index.js");
  await initializePlugins();

  const { runPluginDataMigrations } =
    await import("../../upgrade/boot-migrations.js");
  await runPluginDataMigrations();

  return {
    dataDir,
    sqlite: remote ? null : db.getSqlite(),
    seed,
    shutdown: async ({ keepDataDir = false } = {}) => {
      await shutdownPlugins();
      if (keepDataDir) {
        if (!remote) {
          fs.writeFileSync(
            path.join(dataDir, "db.sqlite"),
            db.getSqlite().serialize(),
          );
        }
        return;
      }
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
