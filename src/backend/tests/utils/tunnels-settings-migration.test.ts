/**
 * The tunnel host-columns migration.
 *
 * An upgrade must be lossless: a host with tunnels on and a saved tunnel list
 * must keep both once the ssh_data columns are dropped. Running it twice
 * must not duplicate or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface HostRow {
  id: number;
  enable_tunnel: boolean;
  tunnel_connections: string | null;
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
      hostRows.filter(
        (row) => row.enable_tunnel || row.tunnel_connections !== null,
      ),
  }),
}));

const { runTunnelsSettingsMigration } =
  await import("../../utils/crypto-migration/tunnels-settings-migration.js");

function storedValue(hostId: number, key: string): unknown {
  const row = settingsRows.find(
    (entry) => entry.scopeId === String(hostId) && entry.key === key,
  );
  return row?.value === null || row?.value === undefined
    ? undefined
    : JSON.parse(row.value);
}

const tunnel = {
  scope: "s2s",
  mode: "local",
  sourcePort: 8080,
  endpointHost: "db",
  endpointPort: 5432,
  maxRetries: 3,
  retryInterval: 10,
  autoStart: true,
};

beforeEach(() => {
  hostRows.length = 0;
  settingsRows.length = 0;
});

describe("runTunnelsSettingsMigration", () => {
  it("moves a host's switch and saved tunnels into plugin settings", async () => {
    hostRows.push({
      id: 1,
      enable_tunnel: true,
      tunnel_connections: JSON.stringify([tunnel]),
    });

    const result = await runTunnelsSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(1, "enableTunnel")).toBe(true);
    expect(storedValue(1, "tunnelConnections")).toEqual([tunnel]);
    expect(settingsRows.every((row) => row.pluginId === "tunnels")).toBe(true);
    expect(settingsRows.every((row) => row.scope === "host")).toBe(true);
  });

  it("keeps a disabled host's saved tunnels and its disabled switch", async () => {
    hostRows.push({
      id: 3,
      enable_tunnel: false,
      tunnel_connections: JSON.stringify([tunnel]),
    });

    await runTunnelsSettingsMigration();

    expect(storedValue(3, "enableTunnel")).toBe(false);
    expect(storedValue(3, "tunnelConnections")).toEqual([tunnel]);
  });

  it("stores an unreadable tunnel list as empty rather than failing", async () => {
    hostRows.push({ id: 4, enable_tunnel: true, tunnel_connections: "{nope" });

    const result = await runTunnelsSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(4, "tunnelConnections")).toEqual([]);
  });

  it("does nothing on a fresh install", async () => {
    const result = await runTunnelsSettingsMigration();

    expect(result.moved).toBe(0);
    expect(settingsRows).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    hostRows.push({ id: 2, enable_tunnel: true, tunnel_connections: null });

    await runTunnelsSettingsMigration();
    const afterFirst = JSON.parse(JSON.stringify(settingsRows));

    const second = await runTunnelsSettingsMigration();

    expect(second.moved).toBe(0);
    expect(second.skipped).toBe(1);
    expect(settingsRows).toEqual(afterFirst);
  });

  it("does not overwrite a value the plugin already saved", async () => {
    hostRows.push({
      id: 5,
      enable_tunnel: true,
      tunnel_connections: JSON.stringify([tunnel]),
    });
    await pluginSettingsRepository.set(
      "tunnels",
      "host",
      "5",
      "enableTunnel",
      "false",
    );

    const result = await runTunnelsSettingsMigration();

    expect(result.skipped).toBe(1);
    expect(storedValue(5, "enableTunnel")).toBe(false);
    expect(storedValue(5, "tunnelConnections")).toBeUndefined();
  });
});
