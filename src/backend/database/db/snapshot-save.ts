/**
 * Writes the in-memory SQLite database to disk. A failure is passed to the
 * caller, so a forced save that did not land never looks like it did.
 */

import fs from "fs";
import { DatabaseSaveTrigger } from "../../utils/database-save-trigger.js";
import { databaseLogger } from "../../utils/logger.js";

/** A failed write leaves the old file in place instead of a cut one. */
export async function writeFileAtomic(
  target: string,
  data: Buffer,
): Promise<void> {
  const tmp = `${target}.tmp-${process.pid}`;
  try {
    await fs.promises.writeFile(tmp, data);
    await fs.promises.rename(tmp, target);
  } catch (error) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {});
    throw error;
  }
}

export async function saveSnapshot(options: {
  serialize: () => Buffer;
  write: (buffer: Buffer) => Promise<void>;
  encrypted: boolean;
}): Promise<void> {
  try {
    // Before the copy, so a write during the slow part stays dirty.
    DatabaseSaveTrigger.markClean();
    await options.write(options.serialize());
  } catch (error) {
    DatabaseSaveTrigger.markDirty();
    databaseLogger.error("Failed to save in-memory database", error, {
      operation: "memory_db_save_failed",
      enableFileEncryption: options.encrypted,
    });
    throw error;
  }
}
