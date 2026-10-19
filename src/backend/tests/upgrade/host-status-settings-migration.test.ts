/**
 * The status check interval moves into the host-status plugin once. A value
 * the plugin already holds is kept, and running it twice changes nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  core: new Map<string, string>(),
  plugin: new Map<string, string>(),
  installed: true,
}));

vi.mock("../../utils/logger.js", () => {
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { databaseLogger: log };
});
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) => (h.installed ? { id } : null),
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => h.core.get(key) ?? null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (_p: string, _s: string, _id: string | null, key: string) =>
      h.plugin.has(key) ? { value: h.plugin.get(key) } : null,
    set: async (
      _p: string,
      _s: string,
      _id: string | null,
      key: string,
      value: string,
    ) => {
      h.plugin.set(key, value);
    },
  }),
}));

const { runHostStatusSettingsMigration } =
  await import("../../upgrade/host-status-settings-migration.js");

beforeEach(() => {
  h.core.clear();
  h.plugin.clear();
  h.installed = true;
});

describe("host status settings migration", () => {
  it("copies the interval into the plugin", async () => {
    h.core.set("global_status_check_interval", "90");
    expect(await runHostStatusSettingsMigration()).toBe(90);
    expect(h.plugin.get("intervalSeconds")).toBe("90");
  });

  it("keeps a value the plugin already has", async () => {
    h.core.set("global_status_check_interval", "90");
    h.plugin.set("intervalSeconds", "45");
    expect(await runHostStatusSettingsMigration()).toBeNull();
    expect(h.plugin.get("intervalSeconds")).toBe("45");
  });

  it("does nothing twice", async () => {
    h.core.set("global_status_check_interval", "120");
    await runHostStatusSettingsMigration();
    expect(await runHostStatusSettingsMigration()).toBeNull();
    expect(h.plugin.get("intervalSeconds")).toBe("120");
  });

  it.each(["abc", "4", "7200", "1.5", ""])(
    "ignores the invalid value %j",
    async (value) => {
      h.core.set("global_status_check_interval", value);
      expect(await runHostStatusSettingsMigration()).toBeNull();
      expect(h.plugin.has("intervalSeconds")).toBe(false);
    },
  );

  it("does nothing without a stored interval or the plugin", async () => {
    expect(await runHostStatusSettingsMigration()).toBeNull();
    h.core.set("global_status_check_interval", "90");
    h.installed = false;
    expect(await runHostStatusSettingsMigration()).toBeNull();
    expect(h.plugin.size).toBe(0);
  });
});
