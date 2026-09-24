/**
 * Moves Host Metrics' settings out of core and into the host-metrics
 * plugin's own settings.
 *
 * Admin keys from `settings`: global_metrics_interval,
 * metrics_history_retention_days and metricsEnabled inside host_defaults (the
 * default for new hosts). Per host, the metrics half of
 * ssh_data.stats_config: metricsEnabled, the host's own interval, the enabled
 * widgets and the mount lists. The status half is core and moved by
 * host-status-config-migration.ts.
 *
 * The old settings rows and the column stay in place, unused.
 *
 * Idempotent: an admin key already set, or a host that already has any
 * host-metrics row, is skipped, so this is safe on every boot.
 */

import { sql } from "drizzle-orm";
import { databaseLogger } from "../logger.js";
import {
  createCurrentPluginRepository,
  createCurrentPluginSettingsRepository,
  createCurrentSettingsRepository,
} from "../../database/repositories/factory.js";
import { selectRows } from "./raw-rows.js";

const PLUGIN_ID = "host-metrics";

/** A JSON object stored as text, or {} when it is anything else. */
function parseStatsConfig(raw: string | null): Record<string, unknown> {
  try {
    let parsed: unknown = raw ? JSON.parse(raw) : null;
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function seconds(value: unknown, min: number, max: number): number | null {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

/** The plugin's host settings for one stats_config value, defaults left out. */
export function hostSettingsFromStatsConfig(
  raw: string | null,
): Record<string, unknown> {
  const config = parseStatsConfig(raw);
  const values: Record<string, unknown> = {};
  if (config.metricsEnabled === false) values.metricsEnabled = false;
  if (config.useGlobalMetricsInterval === false) {
    const interval = seconds(config.metricsInterval, 5, 3600);
    if (interval !== null) values.metricsInterval = interval;
  }
  if (Array.isArray(config.enabledWidgets)) {
    values.enabledWidgets = config.enabledWidgets.filter(
      (widget): widget is string => typeof widget === "string",
    );
  }
  if (Array.isArray(config.excludedMounts) && config.excludedMounts.length) {
    values.excludedMounts = config.excludedMounts.filter(
      (mount): mount is string => typeof mount === "string",
    );
  }
  if (Array.isArray(config.monitoredMounts) && config.monitoredMounts.length) {
    values.monitoredMounts = config.monitoredMounts.filter(
      (mount) =>
        !!mount &&
        typeof mount === "object" &&
        typeof (mount as { path?: unknown }).path === "string",
    );
  }
  return values;
}

export interface HostMetricsSettingsMigrationResult {
  moved: string[];
  hostsMoved: number;
  hostsSkipped: number;
}

export async function runHostMetricsSettingsMigration(): Promise<HostMetricsSettingsMigrationResult> {
  const result: HostMetricsSettingsMigrationResult = {
    moved: [],
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
    scope: "admin" | "host",
    scopeId: string | null,
    key: string,
    value: unknown,
  ) =>
    pluginSettings.set(PLUGIN_ID, scope, scopeId, key, JSON.stringify(value));

  try {
    const settings = createCurrentSettingsRepository();
    const moves: [string, string, number, number][] = [
      ["global_metrics_interval", "metricsInterval", 5, 3600],
      ["metrics_history_retention_days", "historyRetentionDays", 1, 90],
    ];
    for (const [legacyKey, field, min, max] of moves) {
      const value = seconds(await settings.get(legacyKey), min, max);
      if (value === null) continue;
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "admin",
        null,
        field,
      );
      if (existing && existing.value !== null) continue;
      await write("admin", null, field, value);
      result.moved.push(legacyKey);
    }

    const defaults = parseStatsConfig(await settings.get("host_defaults"));
    if (defaults.metricsEnabled === false) {
      const existing = await pluginSettings.get(
        PLUGIN_ID,
        "admin",
        null,
        "enabledForNewHosts",
      );
      if (!existing || existing.value === null) {
        await write("admin", null, "enabledForNewHosts", false);
        result.moved.push("host_defaults.metricsEnabled");
      }
    }
  } catch (error) {
    databaseLogger.warn("Host Metrics admin settings migration failed", {
      operation: "host_metrics_settings_migration",
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    // Raw SQL: schema.ts no longer declares stats_config.
    const rows = await selectRows<{ id: number; stats_config: string | null }>(
      sql`SELECT id, stats_config FROM ssh_data WHERE stats_config IS NOT NULL`,
    );
    for (const row of rows) {
      const values = hostSettingsFromStatsConfig(row.stats_config);
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
  } catch {
    // A fresh install never had the column.
  }

  if (result.moved.length > 0 || result.hostsMoved > 0) {
    databaseLogger.info(
      `Moved ${result.moved.length} Host Metrics setting(s) and ${result.hostsMoved} host(s) into plugin settings`,
      { operation: "host_metrics_settings_migration" },
    );
  }
  return result;
}
