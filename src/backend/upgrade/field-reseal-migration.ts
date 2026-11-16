/**
 * Moves every sealed host and credential secret to the record id it belongs
 * to. Before 26.11.2 new hosts and credentials, and every edit, were sealed
 * under a temporary id, and decrypt trusted whatever id the value carried, so
 * a sealed value copied to another row still opened there. Decrypt now
 * refuses a value sealed for another record, which needs every stored value
 * to carry its real id first.
 *
 * Lossless: a value is only rewritten once it opens, and the old values of
 * each batch go into a backup file before the batch is written. Values that
 * do not open stay as they are. Resumable: a run that stops part way is
 * finished by the next one, since rows already moved are skipped. The marker
 * is set only once no row is left, so a user whose data key only opens at
 * their next login keeps the check running until then.
 */

import fs from "fs";
import path from "path";
import { FieldCrypto } from "../utils/field-crypto.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { databaseLogger } from "../utils/logger.js";
import type {
  ResealRow,
  ResealTable,
} from "../database/repositories/field-reseal-repository.js";

export const FIELD_RESEAL_MARKER = "field_reseal_v1";
const BATCH = 500;

export interface FieldResealResult {
  resealed: number;
  /** Values whose owner's data key is not open yet. */
  pending: number;
  /** Values that did not open with their owner's key. */
  unreadable: number;
  backupFile: string | null;
}

export interface FieldResealDeps {
  tables: ResealTable[];
  dataKey(userId: string): Buffer | null;
  backupDir: string;
  now?: () => Date;
}

const LEGACY_NAMES: Record<string, string> = {
  keyPassword: "key_password",
  sudoPassword: "sudo_password",
  socks5Password: "socks5_password",
  privateKey: "private_key",
  publicKey: "public_key",
};

function openAnyName(value: string, key: Buffer, fieldName: string): string {
  try {
    return FieldCrypto.decryptSealedField(value, key, fieldName);
  } catch (error) {
    const legacy = LEGACY_NAMES[fieldName];
    if (!legacy) throw error;
    return FieldCrypto.decryptSealedField(value, key, legacy);
  }
}

function openBackup(dir: string, now: Date): { file: string; fd: number } {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `field-reseal-${stamp}.jsonl`);
  const fd = fs.openSync(file, "a", 0o600);
  return { file, fd };
}

/** Runs the reseal over the given tables. Exported for tests. */
export async function resealFields(
  deps: FieldResealDeps,
): Promise<FieldResealResult> {
  const result: FieldResealResult = {
    resealed: 0,
    pending: 0,
    unreadable: 0,
    backupFile: null,
  };
  let backup: { file: string; fd: number } | null = null;

  try {
    for (const table of deps.tables) {
      let afterId = 0;
      for (;;) {
        const rows: ResealRow[] = await table.list(afterId, BATCH);
        if (rows.length === 0) break;
        afterId = rows[rows.length - 1].id;

        const changes: Array<{
          row: ResealRow;
          values: Record<string, string>;
          old: Record<string, string>;
        }> = [];
        for (const row of rows) {
          const values: Record<string, string> = {};
          const old: Record<string, string> = {};
          let key: Buffer | null | undefined;
          for (const [column, fieldName] of Object.entries(table.fields)) {
            const value = row.values[column];
            if (!value || !FieldCrypto.isEncrypted(value)) continue;
            if (FieldCrypto.sealedRecordId(value) === row.recordId) continue;
            if (key === undefined) key = deps.dataKey(row.ownerId);
            if (!key) {
              result.pending++;
              continue;
            }
            let plain: string;
            try {
              plain = openAnyName(value, key, fieldName);
            } catch {
              result.unreadable++;
              continue;
            }
            values[column] = FieldCrypto.encryptField(
              plain,
              key,
              row.recordId,
              fieldName,
            );
            old[column] = value;
          }
          if (Object.keys(values).length) changes.push({ row, values, old });
        }
        if (changes.length === 0) continue;

        backup ??= openBackup(deps.backupDir, deps.now?.() ?? new Date());
        result.backupFile = backup.file;
        const lines = changes
          .map(({ row, old }) =>
            JSON.stringify({ table: table.name, id: row.id, values: old }),
          )
          .join("\n");
        fs.writeSync(backup.fd, `${lines}\n`);
        fs.fsyncSync(backup.fd);

        for (const { row, values } of changes) {
          await table.update(row.id, values);
          result.resealed += Object.keys(values).length;
        }
      }
    }
  } finally {
    if (backup) fs.closeSync(backup.fd);
  }
  return result;
}

let running: Promise<FieldResealResult | null> | null = null;

/**
 * Boot entry. Also called when a user's data key opens for the first time, so
 * their rows move before anything reads them.
 */
export function runFieldResealMigration(): Promise<FieldResealResult | null> {
  running ??= runOnce().finally(() => {
    running = null;
  });
  return running;
}

async function runOnce(): Promise<FieldResealResult | null> {
  const {
    createCurrentFieldResealRepository,
    createCurrentSettingsRepository,
  } = await import("../database/repositories/factory.js");
  const settings = createCurrentSettingsRepository();
  if ((await settings.get(FIELD_RESEAL_MARKER)) === "done") return null;

  const dataDir = path.resolve(process.env.DATA_DIR || "./db/data");
  const result = await resealFields({
    tables: createCurrentFieldResealRepository().tables(),
    dataKey: (userId) => DataCrypto.getUserDataKey(userId),
    backupDir: path.join(dataDir, "backups"),
  });

  if (result.resealed > 0) {
    const { DatabaseSaveTrigger } =
      await import("../utils/database-save-trigger.js");
    await DatabaseSaveTrigger.forceSave("field_reseal");
  }
  if (result.pending === 0) {
    await settings.set(FIELD_RESEAL_MARKER, "done");
  }

  const log = result.unreadable > 0 ? databaseLogger.warn : databaseLogger.info;
  if (result.resealed || result.pending || result.unreadable) {
    log.call(databaseLogger, "Moved saved secrets to their own records", {
      operation: "field_reseal",
      resealed: result.resealed,
      pending: result.pending,
      unreadable: result.unreadable,
      backupFile: result.backupFile,
    });
  }
  return result;
}
