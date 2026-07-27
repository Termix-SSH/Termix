import fs from "fs";
import path from "path";
import { DatabaseFileEncryption } from "./database-file-encryption.js";

export const ALLOW_EMPTY_DATA_DIR_ENV = "ALLOW_EMPTY_DATA_DIR";

/** Thrown when the data directory looks misconfigured rather than empty. */
export class DataDirMisconfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataDirMisconfiguredError";
  }
}

/**
 * Directories Termix has shipped or documented as a data location. A deployment
 * that loses DATA_DIR — an unloaded .env file, an unmounted volume — falls back
 * to the default and finds an empty directory, which is indistinguishable from a
 * first run. Checking these tells the two apart.
 */
const KNOWN_DATA_DIRS = ["db/data", "data", "/app/data"];

const TRUE_VALUES = new Set(["1", "true", "yes", "on"]);

function hasDatabaseFile(dir: string): boolean {
  const dbPath = path.join(dir, "db.sqlite");

  if (DatabaseFileEncryption.isEncryptedDatabaseFile(`${dbPath}.encrypted`)) {
    return true;
  }

  try {
    return fs.statSync(dbPath).size > 0;
  } catch {
    return false;
  }
}

/**
 * Looks for a database outside the configured data directory. Returns the
 * directory holding it, or null when this really is a fresh install.
 */
export function findDatabaseOutsideDataDir(
  dataDir: string,
  cwd: string = process.cwd(),
): string | null {
  const resolvedDataDir = path.resolve(dataDir);

  for (const candidate of KNOWN_DATA_DIRS) {
    const dir = path.resolve(cwd, candidate);
    if (dir === resolvedDataDir) continue;
    if (hasDatabaseFile(dir)) return dir;
  }

  return null;
}

export function isEmptyDataDirAllowed(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return TRUE_VALUES.has(
    env[ALLOW_EMPTY_DATA_DIR_ENV]?.trim().toLowerCase() ?? "",
  );
}

/**
 * Refuses to start with a blank database when an existing one sits elsewhere.
 * Creating a fresh database in that state looks exactly like data loss: the user
 * is asked to register an admin account again while their real data is intact
 * one directory over.
 */
export function assertDataDirIsNotMisconfigured(
  dataDir: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd: string = process.cwd(),
): void {
  if (isEmptyDataDirAllowed(env)) return;

  const existing = findDatabaseOutsideDataDir(dataDir, cwd);
  if (!existing) return;

  throw new DataDirMisconfiguredError(
    `No database found in DATA_DIR (${path.resolve(dataDir)}), but an existing database is present in ${existing}. ` +
      `Starting here would create an empty database and hide your data. ` +
      `Set DATA_DIR=${existing} (check that your .env file is loaded and any volume is mounted), ` +
      `or set ${ALLOW_EMPTY_DATA_DIR_ENV}=true to start with a new database anyway.`,
  );
}
