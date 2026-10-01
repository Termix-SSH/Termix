/**
 * The status half of ssh_data.stats_config moving into the core
 * status_check_enabled and status_check_interval columns. Run against a real
 * SQLite database through the same raw SQL helpers the boot path uses.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, string>(),
  db: null as unknown,
}));

vi.mock("../../database/db/index.js", () => ({ getDb: () => state.db }));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings.get(key) ?? null,
    set: async (key: string, value: string) => {
      state.settings.set(key, value);
    },
  }),
}));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

const {
  runHostStatusConfigMigration,
  statusConfigFromStatsConfig,
  HOST_STATUS_CONFIG_MIGRATED,
} =
  await import("../../utils/crypto-migration/host-status-config-migration.js");

let sqlite: Database.Database;

function createHosts(withStatsConfig = true) {
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE ssh_data (
      id INTEGER PRIMARY KEY,
      ${withStatsConfig ? "stats_config TEXT," : ""}
      status_check_enabled INTEGER NOT NULL DEFAULT 1,
      status_check_interval INTEGER
    );
  `);
  state.db = drizzle(sqlite);
}

const hosts = () =>
  sqlite
    .prepare(
      "SELECT id, status_check_enabled AS enabled, status_check_interval AS interval FROM ssh_data ORDER BY id",
    )
    .all();

beforeEach(() => {
  state.settings.clear();
  createHosts();
});

describe("statusConfigFromStatsConfig", () => {
  it.each([
    [null, true, null],
    ["{}", true, null],
    ['{"statusCheckEnabled":false}', false, null],
    ['{"disableTcpPing":true}', false, null],
    ['{"useGlobalStatusInterval":false,"statusCheckInterval":45}', true, 45],
    ['{"useGlobalStatusInterval":true,"statusCheckInterval":45}', true, null],
    ['{"useGlobalStatusInterval":false,"statusCheckInterval":2}', true, null],
    [
      JSON.stringify(JSON.stringify({ statusCheckEnabled: false })),
      false,
      null,
    ],
    ["not json", true, null],
  ])("%s", (raw, enabled, interval) => {
    expect(statusConfigFromStatsConfig(raw)).toEqual({
      statusCheckEnabled: enabled,
      statusCheckInterval: interval,
    });
  });
});

describe("runHostStatusConfigMigration", () => {
  it("copies each host's status options into the new columns", async () => {
    const insert = sqlite.prepare(
      "INSERT INTO ssh_data (id, stats_config) VALUES (?, ?)",
    );
    insert.run(1, JSON.stringify({ statusCheckEnabled: false }));
    insert.run(
      2,
      JSON.stringify({
        useGlobalStatusInterval: false,
        statusCheckInterval: 45,
      }),
    );
    insert.run(
      3,
      JSON.stringify({ disableTcpPing: true, metricsEnabled: false }),
    );
    insert.run(4, JSON.stringify({ metricsInterval: 10 }));
    insert.run(5, null);

    const result = await runHostStatusConfigMigration();

    expect(result).toEqual({ skipped: false, hostsMoved: 3 });
    expect(hosts()).toEqual([
      { id: 1, enabled: 0, interval: null },
      { id: 2, enabled: 1, interval: 45 },
      { id: 3, enabled: 0, interval: null },
      { id: 4, enabled: 1, interval: null },
      { id: 5, enabled: 1, interval: null },
    ]);
    expect(state.settings.get(HOST_STATUS_CONFIG_MIGRATED)).toBe("true");
  });

  it("changes nothing the second time", async () => {
    sqlite
      .prepare("INSERT INTO ssh_data (id, stats_config) VALUES (?, ?)")
      .run(1, JSON.stringify({ statusCheckEnabled: false }));
    await runHostStatusConfigMigration();

    // The user turns checks back on after the upgrade.
    sqlite.exec("UPDATE ssh_data SET status_check_enabled = 1 WHERE id = 1");
    expect(await runHostStatusConfigMigration()).toEqual({
      skipped: true,
      hostsMoved: 0,
    });
    expect(hosts()).toEqual([{ id: 1, enabled: 1, interval: null }]);
  });

  it("finishes on a fresh install that never had stats_config", async () => {
    createHosts(false);
    sqlite.exec("INSERT INTO ssh_data (id) VALUES (1)");
    expect(await runHostStatusConfigMigration()).toEqual({
      skipped: false,
      hostsMoved: 0,
    });
    expect(state.settings.get(HOST_STATUS_CONFIG_MIGRATED)).toBe("true");
  });
});
