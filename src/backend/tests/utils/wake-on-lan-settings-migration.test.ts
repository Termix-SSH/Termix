/**
 * The Wake-on-LAN host settings migration.
 *
 * An upgrade must be lossless: every host with a MAC address or a broadcast
 * address must come through into the wake-on-lan plugin's host settings.
 * Running it twice must not duplicate or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pluginRows: [] as Array<{
    pluginId: string;
    scope: string;
    scopeId: string | null;
    key: string;
    value: string | null;
  }>,
  hostRows: [] as Array<Record<string, unknown>>,
  pluginInstalled: true,
  columnsGone: false,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "wake-on-lan" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    getAll: async (_pluginId: string, scope: string, scopeId: string | null) =>
      state.pluginRows.filter(
        (row) => row.scope === scope && row.scopeId === scopeId,
      ),
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      const existing = state.pluginRows.find(
        (row) =>
          row.scope === scope && row.scopeId === scopeId && row.key === key,
      );
      if (existing) {
        existing.value = value;
        return;
      }
      state.pluginRows.push({ pluginId, scope, scopeId, key, value });
    },
  }),
}));

vi.mock("../../utils/crypto-migration/raw-rows.js", () => ({
  selectRows: async () => {
    if (state.columnsGone) throw new Error("no such column: mac_address");
    return state.hostRows;
  },
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import {
  wakeOnLanSettingsFromRow,
  runWakeOnLanSettingsMigration,
} from "../../utils/crypto-migration/wake-on-lan-settings-migration.js";

const hostValues = (hostId: number) =>
  Object.fromEntries(
    state.pluginRows
      .filter((row) => row.scope === "host" && row.scopeId === String(hostId))
      .map((row) => [row.key, JSON.parse(row.value ?? "null")]),
  );

beforeEach(() => {
  state.pluginRows = [];
  state.hostRows = [];
  state.pluginInstalled = true;
  state.columnsGone = false;
});

describe("wakeOnLanSettingsFromRow", () => {
  it("carries over a MAC address", () => {
    expect(
      wakeOnLanSettingsFromRow({
        id: 1,
        mac_address: "aa:bb:cc:dd:ee:ff",
        wol_broadcast_address: null,
      }),
    ).toEqual({ macAddress: "aa:bb:cc:dd:ee:ff" });
  });

  it("carries over a broadcast address alongside the MAC address", () => {
    expect(
      wakeOnLanSettingsFromRow({
        id: 1,
        mac_address: "aa:bb:cc:dd:ee:ff",
        wol_broadcast_address: "192.168.1.255",
      }),
    ).toEqual({
      macAddress: "aa:bb:cc:dd:ee:ff",
      broadcastAddress: "192.168.1.255",
    });
  });

  it("produces nothing for a host with neither set", () => {
    expect(
      wakeOnLanSettingsFromRow({
        id: 1,
        mac_address: null,
        wol_broadcast_address: null,
      }),
    ).toEqual({});
  });
});

describe("runWakeOnLanSettingsMigration", () => {
  it("moves every host's wake-on-lan settings and skips hosts with nothing set", async () => {
    state.hostRows = [
      { id: 1, mac_address: "aa:bb:cc:dd:ee:ff", wol_broadcast_address: null },
      {
        id: 2,
        mac_address: "11:22:33:44:55:66",
        wol_broadcast_address: "192.168.1.255",
      },
      { id: 3, mac_address: null, wol_broadcast_address: null },
    ];

    const result = await runWakeOnLanSettingsMigration();

    expect(result).toEqual({ hostsMoved: 2, hostsSkipped: 0 });
    expect(hostValues(1)).toEqual({ macAddress: "aa:bb:cc:dd:ee:ff" });
    expect(hostValues(2)).toEqual({
      macAddress: "11:22:33:44:55:66",
      broadcastAddress: "192.168.1.255",
    });
    expect(hostValues(3)).toEqual({});
  });

  it("changes nothing when run twice", async () => {
    state.hostRows = [
      { id: 1, mac_address: "aa:bb:cc:dd:ee:ff", wol_broadcast_address: null },
    ];
    await runWakeOnLanSettingsMigration();
    const before = JSON.stringify(state.pluginRows);

    const second = await runWakeOnLanSettingsMigration();

    expect(second).toEqual({ hostsMoved: 0, hostsSkipped: 1 });
    expect(JSON.stringify(state.pluginRows)).toBe(before);
  });

  it("keeps a value already saved in the plugin", async () => {
    state.pluginRows.push({
      pluginId: "wake-on-lan",
      scope: "host",
      scopeId: "1",
      key: "macAddress",
      value: JSON.stringify("11:11:11:11:11:11"),
    });
    state.hostRows = [
      { id: 1, mac_address: "aa:bb:cc:dd:ee:ff", wol_broadcast_address: null },
    ];

    await runWakeOnLanSettingsMigration();

    expect(hostValues(1)).toEqual({ macAddress: "11:11:11:11:11:11" });
  });

  it("does nothing before the plugin row exists or once the columns are gone", async () => {
    state.hostRows = [
      { id: 1, mac_address: "aa:bb:cc:dd:ee:ff", wol_broadcast_address: null },
    ];
    state.pluginInstalled = false;
    expect(await runWakeOnLanSettingsMigration()).toEqual({
      hostsMoved: 0,
      hostsSkipped: 0,
    });

    state.pluginInstalled = true;
    state.columnsGone = true;
    expect(await runWakeOnLanSettingsMigration()).toEqual({
      hostsMoved: 0,
      hostsSkipped: 0,
    });
    expect(state.pluginRows).toEqual([]);
  });
});
