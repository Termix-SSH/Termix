/**
 * The telemetry settings migration: an instance that turned telemetry off in
 * 2.8 stays off, keeps its instance id, and a second run changes nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface SettingsRow {
  pluginId: string;
  key: string;
  value: string | null;
}

const coreSettings = new Map<string, string>();
const settingsRows: SettingsRow[] = [];
let pluginInstalled = true;

const find = (pluginId: string, key: string) =>
  settingsRows.find((row) => row.pluginId === pluginId && row.key === key);

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) => (pluginInstalled ? { id } : null),
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (pluginId: string, _scope: string, _id: null, key: string) =>
      find(pluginId, key) ?? null,
    set: async (
      pluginId: string,
      _scope: string,
      _id: null,
      key: string,
      value: string | null,
    ) => {
      const existing = find(pluginId, key);
      if (existing) existing.value = value;
      else settingsRows.push({ pluginId, key, value });
    },
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => coreSettings.get(key) ?? null,
  }),
}));

const { runTelemetrySettingsMigration } =
  await import("../../upgrade/telemetry-settings-migration.js");

const stored = (key: string) => {
  const row = find("telemetry", key);
  return row?.value == null ? undefined : JSON.parse(row.value);
};

describe("runTelemetrySettingsMigration", () => {
  beforeEach(() => {
    coreSettings.clear();
    settingsRows.length = 0;
    pluginInstalled = true;
  });

  it("moves a disabled switch and the instance id", async () => {
    coreSettings.set("analytics_enabled", "false");
    coreSettings.set("analytics_instance_id", "abc-123");

    const result = await runTelemetrySettingsMigration();

    expect(result).toEqual({ movedEnabled: true, movedInstanceId: true });
    expect(stored("enabled")).toBe(false);
    expect(stored("instanceId")).toBe("abc-123");
  });

  it("writes nothing for an enabled instance without an id", async () => {
    coreSettings.set("analytics_enabled", "true");
    await runTelemetrySettingsMigration();
    expect(settingsRows).toHaveLength(0);
  });

  it("is idempotent and never overwrites plugin values", async () => {
    coreSettings.set("analytics_enabled", "false");
    coreSettings.set("analytics_instance_id", "old");
    settingsRows.push({
      pluginId: "telemetry",
      key: "instanceId",
      value: JSON.stringify("new"),
    });

    await runTelemetrySettingsMigration();
    const second = await runTelemetrySettingsMigration();

    expect(second).toEqual({ movedEnabled: false, movedInstanceId: false });
    expect(stored("instanceId")).toBe("new");
    expect(settingsRows).toHaveLength(2);
  });

  it("does nothing without the plugin row", async () => {
    pluginInstalled = false;
    coreSettings.set("analytics_enabled", "false");
    await runTelemetrySettingsMigration();
    expect(settingsRows).toHaveLength(0);
  });
});
