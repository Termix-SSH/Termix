/**
 * Moves what core kept for snippets into the snippets plugin's settings.
 *
 * Per host: ssh_data.quick_actions becomes the quickActions host setting,
 * and terminal_config.startupSnippetId the startupSnippetId one. Per user:
 * user_preferences.confirm_snippet_execution and folders_collapsed become the
 * confirmExecution and foldersCollapsed user settings.
 *
 * The columns keep their values until 3.0.0 drops them.
 *
 * Idempotent: a host that already has either host setting, and a user key
 * already set, are skipped, so this is safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  legacyFlag,
  selectLegacyRows,
} from "../utils/crypto-migration/raw-rows.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../database/repositories/factory.js";

const PLUGIN_ID = "snippets";
const HOST_KEYS = ["quickActions", "startupSnippetId"];

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return value ?? undefined;
  try {
    let parsed = JSON.parse(value);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

function snippetId(value: unknown): number | null {
  const id = typeof value === "string" ? Number(value) : value;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** The snippets host settings one 2.8 ssh_data row carried. */
export function snippetHostSettingsFromRow(row: {
  quick_actions?: unknown;
  terminal_config?: unknown;
}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const actions = parseJson(row.quick_actions);
  if (Array.isArray(actions)) {
    const quickActions = actions.flatMap((entry) => {
      const id = snippetId((entry as { snippetId?: unknown })?.snippetId);
      if (id === null) return [];
      const name = (entry as { name?: unknown }).name;
      return [{ name: typeof name === "string" ? name : "", snippetId: id }];
    });
    if (quickActions.length > 0) values.quickActions = quickActions;
  }
  const config = parseJson(row.terminal_config) as
    { startupSnippetId?: unknown } | undefined;
  const startup = snippetId(config?.startupSnippetId);
  if (startup !== null) values.startupSnippetId = startup;
  return values;
}

export interface SnippetsSettingsMigrationResult {
  hostsMoved: number;
  hostsSkipped: number;
  usersMoved: number;
}

export async function runSnippetsSettingsMigration(): Promise<SnippetsSettingsMigrationResult> {
  const result: SnippetsSettingsMigrationResult = {
    hostsMoved: 0,
    hostsSkipped: 0,
    usersMoved: 0,
  };

  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
  } catch {
    return result;
  }

  const pluginSettings = createCurrentPluginSettingsRepository();

  try {
    const rows = await selectLegacyRows<{
      id: number;
      quick_actions: unknown;
      terminal_config: unknown;
    }>(sql`
      SELECT id, quick_actions, terminal_config FROM ssh_data
      WHERE quick_actions IS NOT NULL OR terminal_config IS NOT NULL
    `);
    for (const row of rows) {
      const values = snippetHostSettingsFromRow(row);
      if (Object.keys(values).length === 0) continue;
      const scopeId = String(row.id);
      let done = false;
      for (const key of HOST_KEYS) {
        if (await pluginSettings.get(PLUGIN_ID, "host", scopeId, key)) {
          done = true;
        }
      }
      if (done) {
        result.hostsSkipped++;
        continue;
      }
      for (const [key, value] of Object.entries(values)) {
        await pluginSettings.set(
          PLUGIN_ID,
          "host",
          scopeId,
          key,
          JSON.stringify(value),
        );
      }
      result.hostsMoved++;
    }
  } catch (error) {
    databaseLogger.warn("Snippets host settings migration failed", {
      operation: "snippets_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const rows = await selectLegacyRows<{
      user_id: string;
      confirm_snippet_execution: unknown;
      folders_collapsed: unknown;
    }>(sql`
      SELECT user_id, confirm_snippet_execution, folders_collapsed
      FROM user_preferences
    `);
    for (const row of rows) {
      const values: Record<string, boolean> = {};
      if (row.confirm_snippet_execution != null) {
        values.confirmExecution = legacyFlag(
          row.confirm_snippet_execution,
          false,
        );
      }
      if (row.folders_collapsed != null) {
        values.foldersCollapsed = legacyFlag(row.folders_collapsed, true);
      }
      let moved = false;
      for (const [key, value] of Object.entries(values)) {
        const existing = await pluginSettings.get(
          PLUGIN_ID,
          "user",
          row.user_id,
          key,
        );
        if (existing && existing.value !== null) continue;
        await pluginSettings.set(
          PLUGIN_ID,
          "user",
          row.user_id,
          key,
          JSON.stringify(value),
        );
        moved = true;
      }
      if (moved) result.usersMoved++;
    }
  } catch (error) {
    databaseLogger.warn("Snippets user settings migration failed", {
      operation: "snippets_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (result.hostsMoved > 0 || result.usersMoved > 0) {
    databaseLogger.info(
      `Moved the snippet settings of ${result.hostsMoved} host(s) and ${result.usersMoved} user(s) into plugin settings`,
      { operation: "snippets_settings_migration" },
    );
  }
  return result;
}
