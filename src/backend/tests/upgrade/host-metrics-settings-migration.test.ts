/**
 * Host Metrics' settings leaving core: the two admin keys, the new-host
 * default inside host_defaults, and the metrics half of every host's
 * stats_config. Nothing may be lost, and a second run must change nothing.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
}

const state = vi.hoisted(() => ({
  coreSettings: new Map<string, string>(),
  pluginRows: [] as Array<{
    scope: string;
    scopeId: string | null;
    key: string;
    value: string | null;
  }>,
  pluginInstalled: true,
  db: null as unknown,
}));

const find = (scope: string, scopeId: string | null, key: string) =>
  state.pluginRows.find(
    (row) => row.scope === scope && row.scopeId === scopeId && row.key === key,
  );

vi.mock("../../database/db/index.js", () => ({ getDb: () => state.db }));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "host-metrics" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      _pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) => find(scope, scopeId, key) ?? null,
    getAll: async (_pluginId: string, scope: string, scopeId: string | null) =>
      state.pluginRows.filter(
        (row) => row.scope === scope && row.scopeId === scopeId,
      ),
    set: async (
      _pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      const existing = find(scope, scopeId, key);
      if (existing) existing.value = value;
      else state.pluginRows.push({ scope, scopeId, key, value });
    },
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.coreSettings.get(key) ?? null,
  }),
}));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

const { runHostMetricsSettingsMigration, hostSettingsFromStatsConfig } =
  await import("../../upgrade/host-metrics-settings-migration.js");

let sqlite: Database.Database;

const value = (scope: string, scopeId: string | null, key: string) => {
  const row = find(scope, scopeId, key) as Row | undefined;
  return row?.value == null ? undefined : JSON.parse(row.value);
};

beforeEach(() => {
  state.coreSettings.clear();
  state.pluginRows = [];
  state.pluginInstalled = true;
  sqlite = new Database(":memory:");
  sqlite.exec(
    "CREATE TABLE ssh_data (id INTEGER PRIMARY KEY, stats_config TEXT)",
  );
  state.db = drizzle(sqlite);
});

describe("hostSettingsFromStatsConfig", () => {
  it("keeps only what differs from the defaults", () => {
    expect(
      hostSettingsFromStatsConfig(
        JSON.stringify({
          statusCheckEnabled: false,
          metricsEnabled: false,
          metricsInterval: 45,
          useGlobalMetricsInterval: false,
          enabledWidgets: ["cpu", "disk"],
          excludedMounts: ["/snap"],
          monitoredMounts: [{ path: "/data", label: "Data" }, { bad: 1 }],
        }),
      ),
    ).toEqual({
      metricsEnabled: false,
      metricsInterval: 45,
      enabledWidgets: ["cpu", "disk"],
      excludedMounts: ["/snap"],
      monitoredMounts: [{ path: "/data", label: "Data" }],
    });
  });

  it("ignores the host's interval while it followed the global one", () => {
    expect(
      hostSettingsFromStatsConfig(JSON.stringify({ metricsInterval: 45 })),
    ).toEqual({});
  });

  it("reads a value that was stringified twice", () => {
    expect(
      hostSettingsFromStatsConfig(
        JSON.stringify(JSON.stringify({ metricsEnabled: false })),
      ),
    ).toEqual({ metricsEnabled: false });
  });
});

describe("runHostMetricsSettingsMigration", () => {
  it("moves the admin keys, the new-host default and every host", async () => {
    state.coreSettings.set("global_metrics_interval", "20");
    state.coreSettings.set("metrics_history_retention_days", "30");
    state.coreSettings.set(
      "host_defaults",
      JSON.stringify({ metricsEnabled: false, statusCheckEnabled: true }),
    );
    const insert = sqlite.prepare(
      "INSERT INTO ssh_data (id, stats_config) VALUES (?, ?)",
    );
    insert.run(1, JSON.stringify({ metricsEnabled: false }));
    insert.run(2, JSON.stringify({ enabledWidgets: ["cpu"] }));
    insert.run(3, JSON.stringify({ statusCheckEnabled: false }));
    insert.run(4, null);

    const result = await runHostMetricsSettingsMigration();

    expect(result.moved.sort()).toEqual([
      "global_metrics_interval",
      "host_defaults.metricsEnabled",
      "metrics_history_retention_days",
    ]);
    expect(value("admin", null, "metricsInterval")).toBe(20);
    expect(value("admin", null, "historyRetentionDays")).toBe(30);
    expect(value("admin", null, "enabledForNewHosts")).toBe(false);
    expect(value("host", "1", "metricsEnabled")).toBe(false);
    expect(value("host", "2", "enabledWidgets")).toEqual(["cpu"]);
    // Only the status half, which is core's: nothing for the plugin.
    expect(state.pluginRows.filter((row) => row.scopeId === "3")).toEqual([]);
    expect(result.hostsMoved).toBe(2);
  });

  it("changes nothing the second time", async () => {
    state.coreSettings.set("global_metrics_interval", "20");
    sqlite
      .prepare("INSERT INTO ssh_data (id, stats_config) VALUES (?, ?)")
      .run(1, JSON.stringify({ metricsEnabled: false }));
    await runHostMetricsSettingsMigration();

    // Changed through the plugin after the upgrade.
    const interval = find("admin", null, "metricsInterval")!;
    interval.value = "90";
    const enabled = find("host", "1", "metricsEnabled")!;
    enabled.value = "true";

    const second = await runHostMetricsSettingsMigration();
    expect(second).toEqual({ moved: [], hostsMoved: 0, hostsSkipped: 1 });
    expect(value("admin", null, "metricsInterval")).toBe(90);
    expect(value("host", "1", "metricsEnabled")).toBe(true);
  });

  it("waits until the plugin row exists", async () => {
    state.pluginInstalled = false;
    state.coreSettings.set("global_metrics_interval", "20");
    expect(await runHostMetricsSettingsMigration()).toEqual({
      moved: [],
      hostsMoved: 0,
      hostsSkipped: 0,
    });
    expect(state.pluginRows).toEqual([]);
  });

  it("skips values out of range", async () => {
    state.coreSettings.set("global_metrics_interval", "1");
    state.coreSettings.set("metrics_history_retention_days", "900");
    await runHostMetricsSettingsMigration();
    expect(state.pluginRows).toEqual([]);
  });
});
