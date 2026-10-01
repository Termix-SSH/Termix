/**
 * Moves Remote Desktop's settings out of core and into the remote-desktop
 * plugin's own settings.
 *
 * Admin keys from `settings`: guac_enabled and guac_url. Per user, the RDP
 * defaults JSON in user_preferences.rdp_defaults. Per host, the option
 * columns in ssh_data: the three protocol switches and ports, rdp_security,
 * rdp_ignore_cert and guacamole_config, folding in the older security,
 * ignore_cert and connection_type-only shapes, plus enable_terminal_toolbar,
 * which also drove the remote desktop toolbar.
 *
 * The logins (users, passwords, credential ids, auth types, domain) stay in
 * core, next to the host, where sharing needs them.
 *
 * The columns stay in the database, unused: core's drizzle migrations run
 * before this does, so dropping them there would lose the data first.
 *
 * Idempotent: an admin key already set, or a user or host that already has
 * any remote-desktop row, is skipped, so this is safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../database/repositories/factory.js";
import {
  runStatement,
  selectRows,
} from "../utils/crypto-migration/raw-rows.js";

const PLUGIN_ID = "remote-desktop";
const PROTOCOLS = ["rdp", "vnc", "telnet"] as const;
const DEFAULT_PORTS = { rdp: 3389, vnc: 5900, telnet: 23 };

type Flag = number | boolean | string | null | undefined;

/** true, 1 and "1" are on; null means the column was never set. */
function flag(value: Flag): boolean | undefined {
  if (value === null || value === undefined) return undefined;
  return value === true || value === 1 || value === "1" || value === "true";
}

function port(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535
    ? parsed
    : undefined;
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "string" || !value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? parsed
      : undefined;
  } catch {
    return undefined;
  }
}

interface LegacyHostRow {
  id: number;
  port: number | null;
  connection_type: string | null;
  enable_rdp: Flag;
  enable_vnc: Flag;
  enable_telnet: Flag;
  rdp_port: number | null;
  vnc_port: number | null;
  telnet_port: number | null;
  rdp_security: string | null;
  rdp_ignore_cert: Flag;
  security: string | null;
  ignore_cert: Flag;
  guacamole_config: string | null;
  enable_terminal_toolbar: Flag;
}

/** The plugin's host settings for one legacy row, defaults left out. */
export function hostSettingsFromRow(
  row: LegacyHostRow,
): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const flags = {
    rdp: flag(row.enable_rdp) === true,
    vnc: flag(row.enable_vnc) === true,
    telnet: flag(row.enable_telnet) === true,
  };
  const legacyType = PROTOCOLS.find((p) => p === row.connection_type);
  // Hosts from before the per-protocol switches only had connection_type.
  if (!flags.rdp && !flags.vnc && !flags.telnet && legacyType) {
    flags[legacyType] = true;
  }
  const ports = {
    rdp: port(row.rdp_port),
    vnc: port(row.vnc_port),
    telnet: port(row.telnet_port),
  };
  if (legacyType && ports[legacyType] === undefined) {
    ports[legacyType] = port(row.port);
  }

  for (const protocol of PROTOCOLS) {
    const key = `enable${protocol[0].toUpperCase()}${protocol.slice(1)}`;
    if (flags[protocol]) values[key] = true;
    const value = ports[protocol];
    if (value !== undefined && value !== DEFAULT_PORTS[protocol]) {
      values[`${protocol}Port`] = value;
    }
  }

  const security = row.rdp_security || row.security;
  if (security) values.rdpSecurity = security;
  const ignoreCert = flag(row.rdp_ignore_cert) ?? flag(row.ignore_cert);
  if (ignoreCert) values.rdpIgnoreCert = true;
  const config = jsonObject(row.guacamole_config);
  if (config && Object.keys(config).length > 0) values.guacamoleConfig = config;
  if (flag(row.enable_terminal_toolbar) === false) values.enableToolbar = false;
  return values;
}

/** Old camelCase defaults JSON -> the plugin's user settings. */
function userSettingsFromDefaults(
  defaults: Record<string, unknown>,
): Record<string, string> {
  const values: Record<string, string> = {};
  const depth = Number(defaults.colorDepth);
  if ([16, 24, 32].includes(depth)) values.colorDepth = String(depth);
  if (
    defaults.resizeMethod === "display-update" ||
    defaults.resizeMethod === "reconnect"
  ) {
    values.resizeMethod = defaults.resizeMethod;
  }
  for (const key of [
    "forceLossless",
    "enableWallpaper",
    "enableFontSmoothing",
    "enableDesktopComposition",
    "disableAudio",
    "enablePrinting",
    "enableDrive",
    "disableCopy",
    "disablePaste",
  ]) {
    if (typeof defaults[key] === "boolean") {
      values[key] = defaults[key] ? "on" : "off";
    }
  }
  return values;
}

export interface RemoteDesktopSettingsMigrationResult {
  moved: string[];
  usersMoved: number;
  hostsMoved: number;
  hostsSkipped: number;
}

export async function runRemoteDesktopSettingsMigration(): Promise<RemoteDesktopSettingsMigrationResult> {
  const result: RemoteDesktopSettingsMigrationResult = {
    moved: [],
    usersMoved: 0,
    hostsMoved: 0,
    hostsSkipped: 0,
  };

  // plugin_settings has a foreign key to plugins: nothing to migrate into
  // until the plugin row exists.
  try {
    const plugin = await createCurrentPluginRepository().findById(PLUGIN_ID);
    if (!plugin) return result;
  } catch {
    return result;
  }

  const pluginSettings = createCurrentPluginSettingsRepository();
  const write = (
    scope: "admin" | "user" | "host",
    scopeId: string | null,
    key: string,
    value: unknown,
  ) =>
    pluginSettings.set(PLUGIN_ID, scope, scopeId, key, JSON.stringify(value));

  try {
    const settings = createCurrentSettingsRepository();
    const moves: [string, string, (raw: string) => unknown][] = [
      ["guac_enabled", "enabled", (raw) => raw !== "false" && raw !== "0"],
      ["guac_url", "guacdUrl", (raw) => raw],
    ];
    for (const [legacyKey, field, parse] of moves) {
      const legacy = await settings.get(legacyKey);
      if (legacy === null || legacy === "") continue;
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "admin",
        null,
        field,
      );
      if (existing && existing.value !== null) continue;
      await write("admin", null, field, parse(legacy));
      result.moved.push(legacyKey);
    }
  } catch (error) {
    databaseLogger.warn("Remote Desktop admin settings migration failed", {
      operation: "remote_desktop_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const rows = await selectRows<{
      user_id: string;
      rdp_defaults: string | null;
    }>(sql`SELECT user_id, rdp_defaults FROM user_preferences`);
    for (const row of rows) {
      const defaults = jsonObject(row.rdp_defaults);
      if (!defaults) continue;
      const values = userSettingsFromDefaults(defaults);
      if (Object.keys(values).length === 0) continue;
      const existing = await pluginSettings.getAll(
        PLUGIN_ID,
        "user",
        row.user_id,
      );
      if (existing.length > 0) continue;
      for (const [key, value] of Object.entries(values)) {
        await write("user", row.user_id, key, value);
      }
      result.usersMoved++;
    }
  } catch {
    // A fresh install never had the column.
  }

  try {
    // Raw SQL: schema.ts no longer declares these columns.
    const rows = await selectRows<LegacyHostRow>(sql`
      SELECT id, port, connection_type, enable_rdp, enable_vnc, enable_telnet,
        rdp_port, vnc_port, telnet_port, rdp_security, rdp_ignore_cert,
        security, ignore_cert, guacamole_config, enable_terminal_toolbar
      FROM ssh_data
    `);
    for (const row of rows) {
      const values = hostSettingsFromRow(row);
      if (Object.keys(values).length === 0) continue;
      const scopeId = String(row.id);
      const existing = await pluginSettings.getAll(PLUGIN_ID, "host", scopeId);
      if (existing.length > 0) {
        result.hostsSkipped++;
        continue;
      }
      for (const [key, value] of Object.entries(values)) {
        await write("host", scopeId, key, value);
      }
      result.hostsMoved++;
    }

    // Those same connection_type-only hosts kept the enable_ssh default of
    // on, which core used to correct on every read. FALSE and NOT read the
    // same on SQLite's integers and on real booleans.
    await runStatement(sql`
      UPDATE ssh_data SET enable_ssh = FALSE
      WHERE connection_type IN ('rdp', 'vnc', 'telnet')
        AND (enable_rdp IS NULL OR NOT enable_rdp)
        AND (enable_vnc IS NULL OR NOT enable_vnc)
        AND (enable_telnet IS NULL OR NOT enable_telnet)
    `);
  } catch {
    // A fresh install never had the columns.
  }

  if (
    result.moved.length > 0 ||
    result.usersMoved > 0 ||
    result.hostsMoved > 0
  ) {
    databaseLogger.info(
      `Moved ${result.moved.length} Remote Desktop setting(s), ${result.usersMoved} user(s) and ${result.hostsMoved} host(s) into plugin settings`,
      { operation: "remote_desktop_settings_migration" },
    );
  }
  return result;
}
