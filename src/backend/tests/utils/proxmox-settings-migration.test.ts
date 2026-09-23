/**
 * The Proxmox host-columns migration.
 *
 * An upgrade must be lossless: a host that already had Proxmox discovery or
 * stats configured must keep that configuration once the ssh_data columns
 * are dropped. Running it twice must not duplicate or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface HostRow {
  id: number;
  enable_proxmox: boolean;
  proxmox_config: string | null;
  enable_proxmox_stats: boolean;
  proxmox_stats_config: string | null;
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

const pluginSettingsRepository = {
  get: async (
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
    ) ?? null,
  set: async (
    pluginId: string,
    scope: string,
    scopeId: string | null,
    key: string,
    value: string | null,
  ) => {
    const existing = settingsRows.find(
      (row) =>
        row.pluginId === pluginId &&
        row.scope === scope &&
        row.scopeId === scopeId &&
        row.key === key,
    );
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
        (row) =>
          row.enable_proxmox ||
          row.proxmox_config !== null ||
          row.enable_proxmox_stats ||
          row.proxmox_stats_config !== null,
      ),
  }),
}));

const { runProxmoxSettingsMigration } =
  await import("../../utils/crypto-migration/proxmox-settings-migration.js");

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

describe("runProxmoxSettingsMigration", () => {
  it("moves an enabled host's columns into plugin settings", async () => {
    hostRows.push({
      id: 1,
      enable_proxmox: true,
      proxmox_config: JSON.stringify({ defaultAuthType: "password" }),
      enable_proxmox_stats: true,
      proxmox_stats_config: JSON.stringify({ nodeName: "pve1" }),
    });

    const result = await runProxmoxSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(1, "enableProxmox")).toBe(true);
    expect(storedValue(1, "proxmoxConfig")).toEqual({
      defaultAuthType: "password",
    });
    expect(storedValue(1, "enableProxmoxStats")).toBe(true);
    expect(storedValue(1, "proxmoxStatsConfig")).toEqual({ nodeName: "pve1" });
  });

  it("does nothing on a fresh install with no proxmox hosts", async () => {
    const result = await runProxmoxSettingsMigration();

    expect(result.moved).toBe(0);
    expect(settingsRows).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    hostRows.push({
      id: 2,
      enable_proxmox: false,
      proxmox_config: JSON.stringify({ autoSyncEnabled: true }),
      enable_proxmox_stats: false,
      proxmox_stats_config: null,
    });

    await runProxmoxSettingsMigration();
    const afterFirst = JSON.parse(JSON.stringify(settingsRows));

    const second = await runProxmoxSettingsMigration();

    expect(second.moved).toBe(0);
    expect(second.skipped).toBe(1);
    expect(settingsRows).toEqual(afterFirst);
  });

  it("moves each host independently", async () => {
    hostRows.push(
      {
        id: 1,
        enable_proxmox: true,
        proxmox_config: null,
        enable_proxmox_stats: false,
        proxmox_stats_config: null,
      },
      {
        id: 2,
        enable_proxmox: false,
        proxmox_config: null,
        enable_proxmox_stats: true,
        proxmox_stats_config: JSON.stringify({ nodeName: "pve2" }),
      },
    );

    const result = await runProxmoxSettingsMigration();

    expect(result.moved).toBe(2);
    expect(storedValue(1, "enableProxmox")).toBe(true);
    expect(storedValue(2, "proxmoxStatsConfig")).toEqual({ nodeName: "pve2" });
  });
});
