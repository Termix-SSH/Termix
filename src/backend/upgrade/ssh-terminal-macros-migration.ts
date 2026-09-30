/**
 * Moves user_preferences.terminal_macros into the ssh-terminal plugin's
 * macros user setting. Macros a browser kept on its own (storage mode
 * "local") are moved by the plugin's frontend the first time the panel opens.
 *
 * The column keeps its value until 3.0.0 drops it.
 *
 * Idempotent: a user whose macros setting is already set is skipped.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import { selectLegacyRows } from "../utils/crypto-migration/raw-rows.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../database/repositories/factory.js";

const PLUGIN_ID = "ssh-terminal";
const MAX_MACROS = 100;

/** The saved macros in a 2.8 terminal_macros value, or null for none. */
export function macrosFromPreferences(value: unknown): unknown[] | null {
  if (typeof value !== "string" || !value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const macros = parsed
    .filter(
      (macro) =>
        !!macro &&
        typeof macro === "object" &&
        typeof (macro as { id?: unknown }).id === "string" &&
        typeof (macro as { name?: unknown }).name === "string" &&
        Array.isArray((macro as { steps?: unknown }).steps),
    )
    .slice(0, MAX_MACROS);
  return macros.length > 0 ? macros : null;
}

export async function runSshTerminalMacrosMigration(): Promise<{
  usersMoved: number;
}> {
  const result = { usersMoved: 0 };
  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
  } catch {
    return result;
  }

  const pluginSettings = createCurrentPluginSettingsRepository();
  try {
    const rows = await selectLegacyRows<{
      user_id: string;
      terminal_macros: unknown;
    }>(sql`
      SELECT user_id, terminal_macros FROM user_preferences
      WHERE terminal_macros IS NOT NULL
    `);
    for (const row of rows) {
      const macros = macrosFromPreferences(row.terminal_macros);
      if (!macros) continue;
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "user",
        row.user_id,
        "macros",
      );
      if (existing && existing.value !== null) continue;
      await pluginSettings.set(
        PLUGIN_ID,
        "user",
        row.user_id,
        "macros",
        JSON.stringify(macros),
      );
      result.usersMoved++;
    }
  } catch (error) {
    databaseLogger.warn("Terminal macros migration failed", {
      operation: "ssh_terminal_macros_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (result.usersMoved > 0) {
    databaseLogger.info(
      `Moved the terminal macros of ${result.usersMoved} user(s) into plugin settings`,
      { operation: "ssh_terminal_macros_migration" },
    );
  }
  return result;
}
