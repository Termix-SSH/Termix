/**
 * Moves the terminal's settings out of core and into the ssh-terminal
 * plugin's own settings.
 *
 * Admin keys from the core `settings` table: session persistence, command
 * history, touch input tuning and terminal image storage. The image storage
 * local directory was never sent to a browser, so it lands as a secret field,
 * which keeps it that way. The legacy rows are left in place for a release;
 * nothing reads them any more.
 *
 * Host columns from ssh_data: enable_terminal, enable_terminal_toolbar and
 * enable_command_history. All three default to on in the plugin, so only
 * hosts that turned one off need a row.
 *
 * Idempotent: an admin key already set in the plugin, or a host that already
 * has an enableTerminal row, is skipped, so this is safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import { getDb } from "../../database/db/index.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../../database/repositories/factory.js";
import { encryptSystemSecret } from "../system-secret-crypto.js";

const PLUGIN_ID = "ssh-terminal";

type Parse = (raw: string) => unknown;

const asNumber: Parse = (raw) => {
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
};
const asBoolean: Parse = (raw) =>
  raw === "true" || raw === "1"
    ? true
    : raw === "false" || raw === "0"
      ? false
      : undefined;
const asString: Parse = (raw) => raw;
const asJson: Parse = (raw) => {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
};

/** Legacy core key -> the admin field the plugin declares. */
const ADMIN_MOVES: {
  legacyKey: string;
  field: string;
  parse: Parse;
  secret?: boolean;
}[] = [
  {
    legacyKey: "terminal_session_timeout_minutes",
    field: "sessionTimeoutMinutes",
    parse: asNumber,
  },
  {
    legacyKey: "terminal_session_persistence_enabled",
    field: "sessionPersistence",
    parse: asBoolean,
  },
  {
    legacyKey: "command_history_enabled",
    field: "commandHistoryEnabled",
    parse: asBoolean,
  },
  { legacyKey: "touch_input_settings", field: "touchInput", parse: asJson },
  {
    legacyKey: "terminal_image_storage_mode",
    field: "imageStorageMode",
    parse: asString,
  },
  {
    legacyKey: "terminal_image_local_dir",
    field: "imageLocalDir",
    parse: asString,
    secret: true,
  },
  {
    legacyKey: "terminal_image_host_path",
    field: "imageHostPath",
    parse: asString,
  },
  { legacyKey: "terminal_image_ttl_ms", field: "imageTtlMs", parse: asNumber },
  {
    legacyKey: "terminal_image_max_count",
    field: "imageMaxCount",
    parse: asNumber,
  },
  {
    legacyKey: "terminal_image_max_storage_bytes",
    field: "imageMaxBytes",
    parse: asNumber,
  },
];

interface LegacyTerminalHostRow {
  id: number;
  enable_terminal: number | boolean | null;
  enable_terminal_toolbar: number | boolean | null;
  enable_command_history: number | boolean | null;
}

/** A column that was never set keeps the old default, on. */
function isOn(value: number | boolean | null): boolean {
  return value === null || value === undefined ? true : !!value;
}

export interface SshTerminalSettingsMigrationResult {
  moved: string[];
  skipped: string[];
  hostsMoved: number;
  hostsSkipped: number;
}

export async function runSshTerminalSettingsMigration(): Promise<SshTerminalSettingsMigrationResult> {
  const result: SshTerminalSettingsMigrationResult = {
    moved: [],
    skipped: [],
    hostsMoved: 0,
    hostsSkipped: 0,
  };

  try {
    // plugin_settings has a foreign key to plugins: nothing to migrate into
    // until the plugin row exists.
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;

    const settingsRepository = createCurrentSettingsRepository();
    const pluginSettingsRepository = createCurrentPluginSettingsRepository();

    for (const move of ADMIN_MOVES) {
      const legacyValue = await settingsRepository.get(move.legacyKey);
      if (legacyValue === null || legacyValue === "") continue;

      const existing = await pluginSettingsRepository.get(
        PLUGIN_ID,
        "admin",
        null,
        move.field,
      );
      if (existing && existing.value !== null) {
        result.skipped.push(move.legacyKey);
        continue;
      }

      const parsed = move.parse(legacyValue);
      if (parsed === undefined) {
        result.skipped.push(move.legacyKey);
        continue;
      }

      const stored = move.secret
        ? await encryptSystemSecret(String(parsed))
        : parsed;
      await pluginSettingsRepository.set(
        PLUGIN_ID,
        "admin",
        null,
        move.field,
        JSON.stringify(stored),
        !!move.secret,
      );
      result.moved.push(move.legacyKey);
    }

    // Raw SQL, not the typed schema, so this keeps working once schema.ts
    // stops declaring these columns.
    const rows = await getDb().all<LegacyTerminalHostRow>(sql`
      SELECT id, enable_terminal, enable_terminal_toolbar, enable_command_history
      FROM ssh_data
      WHERE enable_terminal = false
        OR enable_terminal_toolbar = false
        OR enable_command_history = false
    `);

    for (const row of rows) {
      const scopeId = String(row.id);
      const existing = await pluginSettingsRepository.get(
        PLUGIN_ID,
        "host",
        scopeId,
        "enableTerminal",
      );
      if (existing && existing.value !== null) {
        result.hostsSkipped++;
        continue;
      }

      const values: Record<string, boolean> = {
        enableTerminal: isOn(row.enable_terminal),
        enableTerminalToolbar: isOn(row.enable_terminal_toolbar),
        enableCommandHistory: isOn(row.enable_command_history),
      };
      for (const [key, value] of Object.entries(values)) {
        await pluginSettingsRepository.set(
          PLUGIN_ID,
          "host",
          scopeId,
          key,
          JSON.stringify(value),
        );
      }
      result.hostsMoved++;
    }

    if (result.moved.length > 0 || result.hostsMoved > 0) {
      databaseLogger.info(
        `Moved ${result.moved.length} terminal setting(s) and ${result.hostsMoved} host(s) into plugin settings`,
        {
          operation: "ssh_terminal_settings_migration",
          moved: result.moved.join(", "),
          hostsMoved: result.hostsMoved,
        },
      );
    }
  } catch (error) {
    // A failed migration must not stop the backend. The terminal falls back
    // to its defaults, which is a visible, recoverable state.
    databaseLogger.warn("SSH terminal settings migration failed", {
      operation: "ssh_terminal_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  return result;
}
