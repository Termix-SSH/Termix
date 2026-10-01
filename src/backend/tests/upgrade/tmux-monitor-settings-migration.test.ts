/**
 * The tmux monitor host-column migration.
 *
 * An upgrade must be lossless: a host with the monitor on must keep it on
 * once the ssh_data column is dropped. Running it twice must not duplicate
 * or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface HostRow {
  id: number;
  enable_tmux_monitor: boolean;
}

interface SettingsRow {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
}

const hostRows: HostRow[] = [];
const settingsRows: SettingsRow[] = [];

const find = (
  pluginId: string,
  scope: string,
  scopeId: string | null,
  key: string,
) =>
  settingsRows.find(
    (row) =>
      row.pluginId === pluginId &&
      row.scope === scope &&
      row.scopeId === scopeId &&
      row.key === key,
  );

const pluginSettingsRepository = {
  get: async (
    pluginId: string,
    scope: string,
    scopeId: string | null,
    key: string,
  ) => find(pluginId, scope, scopeId, key) ?? null,
  set: async (
    pluginId: string,
    scope: string,
    scopeId: string | null,
    key: string,
    value: string | null,
  ) => {
    const existing = find(pluginId, scope, scopeId, key);
    if (existing) {
      existing.value = value;
      return;
    }
    settingsRows.push({ pluginId, scope, scopeId, key, value });
  },
};

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginSettingsRepository: () => pluginSettingsRepository,
}));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => ({
    all: async () => hostRows.filter((row) => row.enable_tmux_monitor),
  }),
}));

const { runTmuxMonitorSettingsMigration } =
  await import("../../upgrade/tmux-monitor-settings-migration.js");

function storedValue(hostId: number, key: string): unknown {
  const row = settingsRows.find(
    (entry) => entry.scopeId === String(hostId) && entry.key === key,
  );
  return row?.value === null || row?.value === undefined
    ? undefined
    : JSON.parse(row.value);
}

beforeEach(() => {
  hostRows.length = 0;
  settingsRows.length = 0;
});

describe("runTmuxMonitorSettingsMigration", () => {
  it("moves a host's enabled switch into plugin settings", async () => {
    hostRows.push({ id: 1, enable_tmux_monitor: true });

    const result = await runTmuxMonitorSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(1, "enableTmuxMonitor")).toBe(true);
    expect(settingsRows.every((row) => row.pluginId === "tmux-monitor")).toBe(
      true,
    );
    expect(settingsRows.every((row) => row.scope === "host")).toBe(true);
  });

  it("leaves a disabled host untouched", async () => {
    hostRows.push({ id: 3, enable_tmux_monitor: false });

    const result = await runTmuxMonitorSettingsMigration();

    expect(result.moved).toBe(0);
    expect(storedValue(3, "enableTmuxMonitor")).toBeUndefined();
  });

  it("does nothing on a fresh install", async () => {
    const result = await runTmuxMonitorSettingsMigration();

    expect(result.moved).toBe(0);
    expect(settingsRows).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    hostRows.push({ id: 2, enable_tmux_monitor: true });

    await runTmuxMonitorSettingsMigration();
    const afterFirst = JSON.parse(JSON.stringify(settingsRows));

    const second = await runTmuxMonitorSettingsMigration();

    expect(second.moved).toBe(0);
    expect(second.skipped).toBe(1);
    expect(settingsRows).toEqual(afterFirst);
  });

  it("does not overwrite a value the plugin already saved", async () => {
    hostRows.push({ id: 5, enable_tmux_monitor: true });
    await pluginSettingsRepository.set(
      "tmux-monitor",
      "host",
      "5",
      "enableTmuxMonitor",
      "false",
    );

    const result = await runTmuxMonitorSettingsMigration();

    expect(result.skipped).toBe(1);
    expect(storedValue(5, "enableTmuxMonitor")).toBe(false);
  });
});
