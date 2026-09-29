/**
 * Moves the terminal's look and behavior out of core and into the
 * ssh-terminal plugin's settings.
 *
 * Per host, the terminal keys of ssh_data.terminal_config become host
 * settings: every behavior key the host saved (tmux, mosh, auto-fill, link
 * and echo modes, syntax highlighting and the rest), and its look only when
 * it saved one. 2.8 stripped the look from a host that followed the user's
 * defaults, so a host with any look key had opted out: it gets
 * inheritAppearance false and its look copied. The SSH connection options in
 * the same JSON are core's and move to ssh_data.ssh_options
 * (ssh-options-migration.ts); startupSnippetId and a legacy sudo password
 * stay where they are.
 *
 * Per user, user_preferences.terminal_defaults, custom_themes and
 * command_autocomplete become user settings.
 *
 * The columns keep their values until 3.0.0 drops them.
 *
 * Idempotent: a host that already has any of these rows, and a user key that
 * is already set, are skipped, so this is safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../utils/logger.js";
import { selectLegacyRows } from "../utils/crypto-migration/raw-rows.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
} from "../database/repositories/factory.js";

const PLUGIN_ID = "ssh-terminal";

const APPEARANCE_KEYS = [
  "theme",
  "cursorBlink",
  "cursorStyle",
  "fontSize",
  "fontFamily",
  "scrollback",
  "letterSpacing",
  "lineHeight",
  "bellStyle",
  "minimumContrastRatio",
  "backgroundImage",
  "backgroundImageOpacity",
  "customThemeColors",
];

const BEHAVIOR_KEYS = [
  "rightClickSelectsWord",
  "macOptionIsMeta",
  "fastScrollModifier",
  "fastScrollSensitivity",
  "backspaceMode",
  "autoMosh",
  "moshCommand",
  "autoTmux",
  "useSSHTitle",
  "syntaxHighlighting",
  "syntaxHighlightingOptions",
  "linkClickBehavior",
  "localEcho",
  "passwordPromptAutoFill",
  "sudoPasswordAutoFill",
];

const HOST_KEYS = ["inheritAppearance", ...APPEARANCE_KEYS, ...BEHAVIOR_KEYS];

/** The plugin's select fields, which refuse anything outside their options. */
const ENUMS: Record<string, string[]> = {
  cursorStyle: ["block", "underline", "bar"],
  bellStyle: ["none", "sound", "visual", "both"],
  fastScrollModifier: ["alt", "ctrl", "shift"],
  backspaceMode: ["normal", "control-h"],
  linkClickBehavior: ["default", "confirm", "direct"],
  localEcho: ["default", "off", "auto", "on"],
};

const NUMBER_KEYS = new Set([
  "fontSize",
  "scrollback",
  "letterSpacing",
  "lineHeight",
  "minimumContrastRatio",
  "backgroundImageOpacity",
  "fastScrollSensitivity",
]);

const LEGACY_TERMIX_THEMES = [
  "Termix Dark",
  "Termix Light",
  "termixDark",
  "termixLight",
];

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string" || !value) return undefined;
  try {
    let parsed = JSON.parse(value);
    // Some rows were stringified twice.
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed;
  } catch {
    return undefined;
  }
}

/** One key's value in the type its plugin field declares, else undefined. */
export function terminalValue(key: string, value: unknown): unknown {
  if (value === undefined) return undefined;
  if (ENUMS[key]) {
    return typeof value === "string" && ENUMS[key].includes(value)
      ? value
      : undefined;
  }
  if (NUMBER_KEYS.has(key)) {
    if (value === null || value === "") return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  switch (key) {
    case "theme":
      if (typeof value !== "string" || !value) return undefined;
      return LEGACY_TERMIX_THEMES.includes(value) ? "termix" : value;
    case "fontFamily":
      return typeof value === "string" && value ? value : undefined;
    case "backgroundImage":
    case "moshCommand":
      return value === null
        ? ""
        : typeof value === "string"
          ? value
          : undefined;
    case "customThemeColors":
      return isObject(value) ? value : undefined;
    case "syntaxHighlightingOptions":
      return isObject(value) ? value : undefined;
    default:
      return typeof value === "boolean" ? value : undefined;
  }
}

/** The ssh-terminal host settings one 2.8 terminal_config value carried. */
export function hostSettingsFromTerminalConfig(
  raw: unknown,
): Record<string, unknown> {
  const config = typeof raw === "string" ? parseJson(raw) : raw;
  if (!isObject(config)) return {};
  const values: Record<string, unknown> = {};
  for (const key of BEHAVIOR_KEYS) {
    const value = terminalValue(key, config[key]);
    if (value !== undefined) values[key] = value;
  }
  if (APPEARANCE_KEYS.some((key) => key in config)) {
    values.inheritAppearance = false;
    for (const key of APPEARANCE_KEYS) {
      const value = terminalValue(key, config[key]);
      if (value !== undefined) values[key] = value;
    }
  }
  return values;
}

/** The ssh-terminal user settings one user_preferences row carried. */
export function userSettingsFromPreferences(row: {
  terminal_defaults?: unknown;
  custom_themes?: unknown;
  command_autocomplete?: unknown;
}): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  const defaults = parseJson(row.terminal_defaults);
  if (isObject(defaults)) {
    const picked: Record<string, unknown> = {};
    for (const key of APPEARANCE_KEYS) {
      const value = terminalValue(key, defaults[key]);
      if (value !== undefined) picked[key] = value;
    }
    if (Object.keys(picked).length > 0) values.terminalDefaults = picked;
  }
  const themes = parseJson(row.custom_themes);
  if (Array.isArray(themes) && themes.length > 0) values.customThemes = themes;
  const autocomplete = row.command_autocomplete;
  if (autocomplete !== null && autocomplete !== undefined) {
    values.commandAutocomplete =
      autocomplete === true ||
      autocomplete === 1 ||
      autocomplete === "1" ||
      autocomplete === "true";
  }
  return values;
}

export interface SshTerminalLookMigrationResult {
  hostsMoved: number;
  hostsSkipped: number;
  usersMoved: number;
}

export async function runSshTerminalLookMigration(): Promise<SshTerminalLookMigrationResult> {
  const result: SshTerminalLookMigrationResult = {
    hostsMoved: 0,
    hostsSkipped: 0,
    usersMoved: 0,
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

  try {
    const rows = await selectLegacyRows<{
      id: number;
      terminal_config: string | null;
    }>(sql`
      SELECT id, terminal_config FROM ssh_data
      WHERE terminal_config IS NOT NULL
    `);
    const moves = rows
      .map((row) => ({
        scopeId: String(row.id),
        values: hostSettingsFromTerminalConfig(row.terminal_config),
      }))
      .filter((move) => Object.keys(move.values).length > 0);
    // A few reads for every candidate host rather than one per host.
    const done = new Set<string | null>();
    for (let i = 0; i < moves.length; i += 500) {
      const existing = await pluginSettings.getAllForScopeIds(
        "host",
        moves.slice(i, i + 500).map((move) => move.scopeId),
      );
      for (const setting of existing) {
        if (setting.pluginId === PLUGIN_ID && HOST_KEYS.includes(setting.key)) {
          done.add(setting.scopeId);
        }
      }
    }
    for (const { scopeId, values } of moves) {
      if (done.has(scopeId)) {
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
    databaseLogger.warn("SSH terminal host look migration failed", {
      operation: "ssh_terminal_look_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const rows = await selectLegacyRows<{
      user_id: string;
      terminal_defaults: string | null;
      custom_themes: string | null;
      command_autocomplete: unknown;
    }>(sql`
      SELECT user_id, terminal_defaults, custom_themes, command_autocomplete
      FROM user_preferences
    `);
    for (const row of rows) {
      const values = userSettingsFromPreferences(row);
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
    databaseLogger.warn("SSH terminal user settings migration failed", {
      operation: "ssh_terminal_look_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  if (result.hostsMoved > 0 || result.usersMoved > 0) {
    databaseLogger.info(
      `Moved the terminal settings of ${result.hostsMoved} host(s) and ${result.usersMoved} user(s) into plugin settings`,
      { operation: "ssh_terminal_look_migration" },
    );
  }
  return result;
}
