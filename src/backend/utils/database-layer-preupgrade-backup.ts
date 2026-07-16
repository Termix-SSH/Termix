import fs from "fs";
import path from "path";
import { databaseLogger } from "./logger.js";

export const DATABASE_LAYER_PREUPGRADE_BACKUP_MARKER =
  ".database-layer-preupgrade-backup.json";
export const DATABASE_LAYER_PREUPGRADE_BACKUP_PREFIX =
  "pre-database-layer-refactor";
export const DATABASE_LAYER_SKIP_PREUPGRADE_BACKUP_ENV =
  "DATABASE_LAYER_SKIP_PREUPGRADE_BACKUP";
export const DATABASE_LAYER_PREUPGRADE_BACKUP_KEEP_ENV =
  "DATABASE_LAYER_PREUPGRADE_BACKUP_KEEP";

interface PreupgradeBackupOptions {
  dataDir?: string;
  version?: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}

interface BackupFileEntry {
  source: string;
  backup: string;
  size: number;
}

export interface PreupgradeBackupManifest {
  reason: "pre-database-layer-refactor";
  createdAt: string;
  sourceVersion: string;
  dataDir: string;
  backupDir: string;
  files: BackupFileEntry[];
}

export interface PreupgradeBackupResult {
  status: "created" | "skipped";
  reason: "backup_created" | "skip_env" | "marker_exists" | "no_database_file";
  backupDir?: string;
  markerPath: string;
}

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function timestampForPath(now: Date): string {
  return now.toISOString().replace(/[:.]/g, "-");
}

function parseKeepCount(env: NodeJS.ProcessEnv): number {
  const raw = env[DATABASE_LAYER_PREUPGRADE_BACKUP_KEEP_ENV];
  if (!raw) return 3;

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 3;
  return parsed;
}

function copyIfExists(
  source: string,
  backupDir: string,
): BackupFileEntry | null {
  if (!fs.existsSync(source)) return null;

  const backup = path.join(backupDir, path.basename(source));
  fs.copyFileSync(source, backup);

  return {
    source,
    backup,
    size: fs.statSync(backup).size,
  };
}

function cleanupOldBackups(backupsRoot: string, keepCount: number): void {
  if (!fs.existsSync(backupsRoot)) return;

  const entries = fs
    .readdirSync(backupsRoot, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        entry.name.startsWith(`${DATABASE_LAYER_PREUPGRADE_BACKUP_PREFIX}-`),
    )
    .map((entry) => {
      const fullPath = path.join(backupsRoot, entry.name);
      return {
        fullPath,
        mtimeMs: fs.statSync(fullPath).mtimeMs,
      };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const entry of entries.slice(keepCount)) {
    fs.rmSync(entry.fullPath, { recursive: true, force: true });
  }
}

export function ensureDatabaseLayerPreupgradeBackup(
  options: PreupgradeBackupOptions = {},
): PreupgradeBackupResult {
  const env = options.env ?? process.env;
  const dataDir = path.resolve(options.dataDir ?? env.DATA_DIR ?? "./db/data");
  const markerPath = path.join(
    dataDir,
    DATABASE_LAYER_PREUPGRADE_BACKUP_MARKER,
  );

  if (
    TRUE_VALUES.has(
      env[DATABASE_LAYER_SKIP_PREUPGRADE_BACKUP_ENV]?.trim().toLowerCase() ??
        "",
    )
  ) {
    databaseLogger.warn("Database layer pre-upgrade backup skipped by env", {
      operation: "database_layer_preupgrade_backup_skipped",
      envKey: DATABASE_LAYER_SKIP_PREUPGRADE_BACKUP_ENV,
    });
    return { status: "skipped", reason: "skip_env", markerPath };
  }

  if (fs.existsSync(markerPath)) {
    return { status: "skipped", reason: "marker_exists", markerPath };
  }

  const encryptedDbPath = path.join(dataDir, "db.sqlite.encrypted");
  const encryptedMetadataPath = `${encryptedDbPath}.meta`;
  const plaintextDbPath = path.join(dataDir, "db.sqlite");
  const envPath = path.join(dataDir, ".env");
  const databaseFiles = [
    encryptedDbPath,
    encryptedMetadataPath,
    plaintextDbPath,
  ].filter((file) => fs.existsSync(file));

  if (databaseFiles.length === 0) {
    return { status: "skipped", reason: "no_database_file", markerPath };
  }

  const backupsRoot = path.join(dataDir, "backups");
  const backupDir = path.join(
    backupsRoot,
    `${DATABASE_LAYER_PREUPGRADE_BACKUP_PREFIX}-${timestampForPath(
      options.now ?? new Date(),
    )}`,
  );

  try {
    fs.mkdirSync(backupDir, { recursive: true });

    const files = [...databaseFiles, envPath]
      .map((source) => copyIfExists(source, backupDir))
      .filter((entry): entry is BackupFileEntry => entry !== null);

    const manifest: PreupgradeBackupManifest = {
      reason: "pre-database-layer-refactor",
      createdAt: (options.now ?? new Date()).toISOString(),
      sourceVersion: options.version ?? env.VERSION ?? "unknown",
      dataDir,
      backupDir,
      files,
    };

    fs.writeFileSync(
      path.join(backupDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
    fs.writeFileSync(markerPath, JSON.stringify(manifest, null, 2));

    cleanupOldBackups(backupsRoot, parseKeepCount(env));

    databaseLogger.info("Database layer pre-upgrade backup created", {
      operation: "database_layer_preupgrade_backup_created",
      backupDir,
      files: files.map((file) => path.basename(file.backup)),
    });

    return {
      status: "created",
      reason: "backup_created",
      backupDir,
      markerPath,
    };
  } catch (error) {
    databaseLogger.error(
      "Failed to create database layer pre-upgrade backup",
      error,
      {
        operation: "database_layer_preupgrade_backup_failed",
        dataDir,
        backupDir,
      },
    );
    throw new Error(
      `Failed to create database layer pre-upgrade backup. Set ${DATABASE_LAYER_SKIP_PREUPGRADE_BACKUP_ENV}=1 only if you already have a verified external backup.`,
      { cause: error },
    );
  }
}
