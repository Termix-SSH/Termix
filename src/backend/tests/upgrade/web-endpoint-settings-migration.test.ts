/**
 * The web endpoint host-columns migration.
 *
 * An upgrade must be lossless: a host with web endpoints on and a saved
 * config must keep both once the ssh_data columns are dropped. Running it
 * twice must not duplicate or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface HostRow {
  id: number;
  enable_web_ui: boolean;
  web_ui_config: string | null;
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
    all: async () =>
      hostRows.filter((row) => row.enable_web_ui || row.web_ui_config !== null),
  }),
}));

const { runWebEndpointSettingsMigration } =
  await import("../../upgrade/web-endpoint-settings-migration.js");

function storedValue(hostId: number, key: string): unknown {
  const row = settingsRows.find(
    (entry) => entry.scopeId === String(hostId) && entry.key === key,
  );
  return row?.value === null || row?.value === undefined
    ? undefined
    : JSON.parse(row.value);
}

const endpoint = {
  id: "e1",
  label: "Proxmox",
  scheme: "https",
  port: 8006,
  path: "/",
  access: "direct",
  render: "embedded",
};

beforeEach(() => {
  hostRows.length = 0;
  settingsRows.length = 0;
});

describe("runWebEndpointSettingsMigration", () => {
  it("moves a host's switch and saved config into plugin settings", async () => {
    hostRows.push({
      id: 1,
      enable_web_ui: true,
      web_ui_config: JSON.stringify({ endpoints: [endpoint] }),
    });

    const result = await runWebEndpointSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(1, "enableWebUi")).toBe(true);
    expect(storedValue(1, "webUiConfig")).toEqual({ endpoints: [endpoint] });
    expect(settingsRows.every((row) => row.pluginId === "web-endpoint")).toBe(
      true,
    );
    expect(settingsRows.every((row) => row.scope === "host")).toBe(true);
  });

  it("keeps a disabled host's saved config and its disabled switch", async () => {
    hostRows.push({
      id: 3,
      enable_web_ui: false,
      web_ui_config: JSON.stringify({ endpoints: [endpoint] }),
    });

    await runWebEndpointSettingsMigration();

    expect(storedValue(3, "enableWebUi")).toBe(false);
    expect(storedValue(3, "webUiConfig")).toEqual({ endpoints: [endpoint] });
  });

  it("stores an unreadable config as null rather than failing", async () => {
    hostRows.push({ id: 4, enable_web_ui: true, web_ui_config: "{nope" });

    const result = await runWebEndpointSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(4, "webUiConfig")).toBeNull();
  });

  it("does nothing on a fresh install", async () => {
    const result = await runWebEndpointSettingsMigration();

    expect(result.moved).toBe(0);
    expect(settingsRows).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    hostRows.push({ id: 2, enable_web_ui: true, web_ui_config: null });

    await runWebEndpointSettingsMigration();
    const afterFirst = JSON.parse(JSON.stringify(settingsRows));

    const second = await runWebEndpointSettingsMigration();

    expect(second.moved).toBe(0);
    expect(second.skipped).toBe(1);
    expect(settingsRows).toEqual(afterFirst);
  });

  it("does not overwrite a value the plugin already saved", async () => {
    hostRows.push({
      id: 5,
      enable_web_ui: true,
      web_ui_config: JSON.stringify({ endpoints: [endpoint] }),
    });
    await pluginSettingsRepository.set(
      "web-endpoint",
      "host",
      "5",
      "enableWebUi",
      "false",
    );

    const result = await runWebEndpointSettingsMigration();

    expect(result.skipped).toBe(1);
    expect(storedValue(5, "enableWebUi")).toBe(false);
    expect(storedValue(5, "webUiConfig")).toBeUndefined();
  });
});
