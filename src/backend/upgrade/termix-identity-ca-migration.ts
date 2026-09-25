/**
 * Reseals 2.8 Termix ID certificate authority keys for the termix-identity
 * plugin.
 *
 * Core encrypted termix_identity_ca.private_key with the owner's data key.
 * The plugin adopts that table as p_termix_identity_ca and reads the key with
 * ctx.secrets.unseal, which only opens installation-key encryption. Each row
 * still under a data key is decrypted and written back with
 * encryptSystemSecret, what ctx.secrets.seal writes.
 *
 * Does nothing until the plugin's table exists. A row whose owner's data key
 * cannot be opened is skipped and tried again next time. Idempotent.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import { DataCrypto } from "../utils/data-crypto.js";
import { LazyFieldEncryption } from "../utils/lazy-field-encryption.js";
import {
  encryptSystemSecret,
  isSystemEncrypted,
} from "../utils/system-secret-crypto.js";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";

const CA_TABLE = "p_termix_identity_ca";

interface CaRow {
  id: number;
  user_id: string;
  private_key: string | null;
}

export async function runTermixIdentityCaMigration(): Promise<number> {
  let rows: CaRow[];
  try {
    rows = await selectRows<CaRow>(
      sql`SELECT id, user_id, private_key FROM ${sql.identifier(CA_TABLE)}`,
    );
  } catch {
    // The plugin has not adopted the table yet.
    return 0;
  }

  let resealed = 0;
  for (const row of rows) {
    if (!row.private_key || isSystemEncrypted(row.private_key)) continue;
    try {
      const dek = DataCrypto.getUserDataKey(row.user_id);
      if (!dek) continue;
      const plain = LazyFieldEncryption.safeGetFieldValue(
        row.private_key,
        dek,
        String(row.id),
        "privateKey",
      );
      if (!plain) continue;
      await runStatement(
        sql`UPDATE ${sql.identifier(CA_TABLE)} SET private_key = ${await encryptSystemSecret(plain)} WHERE id = ${row.id}`,
      );
      resealed++;
    } catch (error) {
      databaseLogger.warn("Termix ID CA reseal failed for a row", {
        operation: "termix_identity_ca_migration",
        caId: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  if (resealed > 0) {
    databaseLogger.info("Resealed Termix ID CA keys for the plugin", {
      operation: "termix_identity_ca_migration",
      resealed,
    });
  }
  return resealed;
}
