/**
 * The Warpgate host settings migration.
 *
 * Every host with use_warpgate on, whatever shape the engine returned it in,
 * and every pre-2.7 host still on auth type "warpgate", must come through
 * into the warpgate plugin's useWarpgate host setting. Running it twice must
 * change nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  pluginRows: [] as Array<{
    scope: string;
    scopeId: string | null;
    key: string;
    value: string | null;
  }>,
  hostRows: [] as Array<Record<string, unknown>>,
  statements: [] as string[],
  pluginInstalled: true,
  columnGone: false,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "warpgate" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      _pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) =>
      state.pluginRows.find(
        (row) =>
          row.scope === scope && row.scopeId === scopeId && row.key === key,
      ) ?? null,
    set: async (
      _pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      state.pluginRows.push({ scope, scopeId, key, value });
    },
  }),
}));

vi.mock("../../utils/crypto-migration/raw-rows.js", () => ({
  selectRows: async (query: { queryChunks?: unknown[] }) => {
    const text = JSON.stringify(query);
    if (text.includes("use_warpgate") && state.columnGone) {
      throw new Error("no such column: use_warpgate");
    }
    return state.hostRows.filter(
      (row) => !text.includes("WHERE") || row.auth_type === "warpgate",
    );
  },
  runStatement: async (query: unknown) => {
    const text = JSON.stringify(query);
    state.statements.push(text);
    const id = (query as { queryChunks: unknown[] }).queryChunks.find(
      (chunk) => typeof chunk === "number",
    );
    const row = state.hostRows.find((candidate) => candidate.id === id);
    if (row) row.auth_type = "none";
  },
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import {
  runWarpgateSettingsMigration,
  usesWarpgate,
} from "../../utils/crypto-migration/warpgate-settings-migration.js";

const enabled = (hostId: number) =>
  state.pluginRows.some(
    (row) =>
      row.scopeId === String(hostId) &&
      row.key === "useWarpgate" &&
      row.value === "true",
  );

beforeEach(() => {
  state.pluginRows = [];
  state.hostRows = [];
  state.statements = [];
  state.pluginInstalled = true;
  state.columnGone = false;
});

describe("usesWarpgate", () => {
  it("reads the flag in every shape the engines return", () => {
    for (const flag of [true, 1, "1", "true"]) {
      expect(
        usesWarpgate({ id: 1, use_warpgate: flag, auth_type: "none" }),
      ).toBe(true);
    }
    for (const flag of [false, 0, "0", null]) {
      expect(
        usesWarpgate({ id: 1, use_warpgate: flag, auth_type: "none" }),
      ).toBe(false);
    }
    expect(usesWarpgate({ id: 1, auth_type: "warpgate" })).toBe(true);
  });
});

describe("runWarpgateSettingsMigration", () => {
  it("moves every flagged host and fixes the old auth type, and a second run changes nothing", async () => {
    state.hostRows = [
      { id: 1, use_warpgate: 1, auth_type: "password" },
      { id: 2, use_warpgate: 0, auth_type: "key" },
      { id: 3, use_warpgate: true, auth_type: "none" },
      { id: 4, use_warpgate: 0, auth_type: "warpgate" },
    ];

    const first = await runWarpgateSettingsMigration();
    expect(first).toEqual({
      hostsMoved: 3,
      hostsSkipped: 0,
      authTypesFixed: 1,
    });
    expect(enabled(1)).toBe(true);
    expect(enabled(2)).toBe(false);
    expect(enabled(3)).toBe(true);
    expect(enabled(4)).toBe(true);
    expect(state.hostRows[3].auth_type).toBe("none");

    const rows = state.pluginRows.length;
    const second = await runWarpgateSettingsMigration();
    // Host 4 is on auth type "none" now, so only the flagged two are seen.
    expect(second).toEqual({
      hostsMoved: 0,
      hostsSkipped: 2,
      authTypesFixed: 0,
    });
    expect(state.pluginRows).toHaveLength(rows);
  });

  it("still fixes old auth types on an install without the column", async () => {
    state.columnGone = true;
    state.hostRows = [{ id: 5, auth_type: "warpgate" }];
    await runWarpgateSettingsMigration();
    expect(enabled(5)).toBe(true);
    expect(state.hostRows[0].auth_type).toBe("none");
  });

  it("waits for the plugin row", async () => {
    state.pluginInstalled = false;
    state.hostRows = [{ id: 1, use_warpgate: 1, auth_type: "password" }];
    await runWarpgateSettingsMigration();
    expect(state.pluginRows).toHaveLength(0);
  });
});
