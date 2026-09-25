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

export const REPO_ROOT = path.resolve(__dirname, "../../../..");
export const BUILT_PLUGINS_DIR = path.join(REPO_ROOT, "dist", "plugins");
const SCHEMA_28 = path.join(__dirname, "../fixtures/sqlite-2.8-schema.sql");

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
  /** The live database core and the plugins write to. */
  sqlite: Database.Database;
  shutdown: () => Promise<void>;
}

/**
 * Writes the seeded database into a fresh DATA_DIR and runs starter.ts's boot
 * sequence up to, not including, opening the HTTP server. Call
 * vi.resetModules() before, so module state from other tests is gone.
 */
export async function bootCore(seed: Database.Database): Promise<BootedCore> {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "termix-boot-"));
  process.env.DATA_DIR = dataDir;
  process.env.DB_FILE_ENCRYPTION = "false";
  process.env.ALLOW_EMPTY_DATA_DIR = "true";
  process.env.TERMIX_BUNDLED_PLUGINS_DIR = BUILT_PLUGINS_DIR;
  fs.writeFileSync(path.join(dataDir, "db.sqlite"), seed.serialize());

  const { SystemCrypto } = await import("../../utils/system-crypto.js");
  const systemCrypto = SystemCrypto.getInstance();
  await systemCrypto.initializeJWTSecret();
  await systemCrypto.initializeDatabaseKey();
  await systemCrypto.initializeEncryptionKey();
  await systemCrypto.initializeInternalAuthToken();

  const db = await import("../../database/db/index.js");
  await db.initializeDatabase();

  const { runCoreBootMigrations } = await import("../../boot.js");
  await runCoreBootMigrations();

  const { primeKnownPermissions } =
    await import("../../utils/known-permissions.js");
  await primeKnownPermissions();

  const { initializePlugins, shutdownPlugins } =
    await import("../../plugins/index.js");
  await initializePlugins();

  const { runPluginDataMigrations } =
    await import("../../plugins/boot-migrations.js");
  await runPluginDataMigrations();

  return {
    dataDir,
    sqlite: db.getSqlite(),
    shutdown: async () => {
      await shutdownPlugins();
      fs.rmSync(dataDir, { recursive: true, force: true });
    },
  };
}
