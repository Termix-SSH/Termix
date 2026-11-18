/**
 * Before 26.11.2 ctx.secrets.seal used core's own system key, so one plugin
 * could open what another sealed, and a sealed value looked like one of
 * core's. Now each plugin seals with its own key (plugins/plugin-seal.ts)
 * and unseal refuses the old kind. This moves old values found in a
 * plugin's own tables and kv rows to that plugin's key. A value whose owner
 * can't be told stays as it is. Runs on every start; once done it only
 * finds nothing.
 */
import { sql } from "drizzle-orm";
import { resolveDatabaseDialect } from "../database/db/dialect.js";
import { decryptSystemSecret } from "../utils/system-secret-crypto.js";
import { sealForPlugin } from "../plugins/plugin-seal.js";
import {
  exec,
  query,
  rawDb,
  SEALED,
  textColumns,
} from "../utils/key-rotation.js";
import { databaseLogger } from "../utils/logger.js";

const MARKER = "%sysenc:v1:%";

/** The plugin a p_ table belongs to: the longest id whose prefix fits. */
export function tableOwner(
  table: string,
  pluginIds: readonly string[],
): string | null {
  const name = table.toLowerCase();
  let best: string | null = null;
  let bestLength = 0;
  for (const id of pluginIds) {
    const prefix = `p_${id.replace(/-/g, "_")}_`;
    if (name.startsWith(prefix) && prefix.length > bestLength) {
      best = id;
      bestLength = prefix.length;
    }
  }
  return best;
}

/** Text with every old sealed value in it moved to the plugin's key. */
export async function moveSealedText(
  text: string,
  pluginId: string,
): Promise<{ text: string; moved: number; failed: number }> {
  let out = text;
  let moved = 0;
  let failed = 0;
  for (const match of new Set(text.match(SEALED) ?? [])) {
    try {
      const plain = await decryptSystemSecret(match);
      out = out.split(match).join(await sealForPlugin(pluginId, plain));
      moved++;
    } catch {
      failed++;
    }
  }
  return { text: out, moved, failed };
}

export async function runPluginSealMigration(): Promise<{
  moved: number;
  failed: number;
}> {
  const dialect = resolveDatabaseDialect();
  const db = await rawDb();
  const pluginIds = (await query(db, dialect, sql`SELECT id FROM plugins`)).map(
    (row) => String(row.id),
  );
  let moved = 0;
  let failed = 0;

  for (const { table, column } of await textColumns(db, dialect)) {
    if (!table.toLowerCase().startsWith("p_")) continue;
    const owner = tableOwner(table, pluginIds);
    if (!owner) continue;
    const t = sql.identifier(table);
    const c = sql.identifier(column);
    const rows = await query(
      db,
      dialect,
      sql`SELECT DISTINCT ${c} AS v FROM ${t} WHERE ${c} LIKE ${MARKER}`,
    );
    for (const row of rows) {
      if (typeof row.v !== "string") continue;
      const result = await moveSealedText(row.v, owner);
      failed += result.failed;
      if (result.moved === 0) continue;
      // A sealed value has a random IV, so the old text is unique.
      await exec(
        db,
        dialect,
        sql`UPDATE ${t} SET ${c} = ${result.text} WHERE ${c} = ${row.v}`,
      );
      moved += result.moved;
    }
  }

  const kv = await query(
    db,
    dialect,
    sql`SELECT id, plugin_id AS p, value AS v FROM plugin_storage WHERE value LIKE ${MARKER}`,
  );
  for (const row of kv) {
    if (typeof row.v !== "string") continue;
    const result = await moveSealedText(row.v, String(row.p));
    failed += result.failed;
    if (result.moved === 0) continue;
    await exec(
      db,
      dialect,
      sql`UPDATE plugin_storage SET value = ${result.text} WHERE id = ${row.id}`,
    );
    moved += result.moved;
  }

  if (moved > 0 || failed > 0) {
    databaseLogger.info(
      `Moved ${moved} plugin sealed value(s) to their plugin's own key`,
      { operation: "plugin_seal_migration", moved, failed },
    );
  }
  if (moved > 0) {
    const { DatabaseSaveTrigger } =
      await import("../utils/database-save-trigger.js");
    await DatabaseSaveTrigger.forceSave("plugin_seal_migration");
  }
  return { moved, failed };
}
