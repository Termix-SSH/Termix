/**
 * The Vault host settings migration.
 *
 * Every host's ssh_data.vault_profile_id must come through into the vault
 * plugin's profileId host setting, and an install that used Vault keeps the
 * 2.8 redirect URI. Running it twice must change nothing.
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
  legacyProfiles: 0,
  adoptedProfiles: 0,
  pluginInstalled: true,
  columnGone: false,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "vault" ? { id } : null,
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
  selectRows: async (query: unknown) => {
    const text = JSON.stringify(query);
    if (text.includes("vault_profile_id")) {
      if (state.columnGone) throw new Error("no such column");
      return state.hostRows.filter((row) => row.vault_profile_id != null);
    }
    const count = text.includes("p_vault_profiles")
      ? state.adoptedProfiles
      : state.legacyProfiles;
    return Array.from({ length: Math.min(count, 1) }, () => ({ "1": 1 }));
  },
  runStatement: async () => {},
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import { runVaultSettingsMigration } from "../../upgrade/vault-settings-migration.js";

const setting = (scopeId: string | null, key: string) =>
  state.pluginRows.find((row) => row.scopeId === scopeId && row.key === key)
    ?.value;

beforeEach(() => {
  state.pluginRows = [];
  state.hostRows = [];
  state.legacyProfiles = 0;
  state.adoptedProfiles = 0;
  state.pluginInstalled = true;
  state.columnGone = false;
});

describe("runVaultSettingsMigration", () => {
  it("moves every host's profile, keeps the old redirect URI, and a second run changes nothing", async () => {
    state.hostRows = [
      { id: 1, vault_profile_id: 7 },
      { id: 2, vault_profile_id: null },
      { id: 3, vault_profile_id: "9" },
    ];
    state.adoptedProfiles = 2;

    const first = await runVaultSettingsMigration();
    expect(first).toEqual({
      hostsMoved: 2,
      hostsSkipped: 0,
      legacyCallback: true,
    });
    expect(setting("1", "profileId")).toBe("7");
    expect(setting("2", "profileId")).toBeUndefined();
    expect(setting("3", "profileId")).toBe("9");
    expect(setting(null, "legacyCallback")).toBe("true");

    const rows = state.pluginRows.length;
    const second = await runVaultSettingsMigration();
    expect(second).toEqual({
      hostsMoved: 0,
      hostsSkipped: 2,
      legacyCallback: false,
    });
    expect(state.pluginRows).toHaveLength(rows);
  });

  it("keeps a host's value already set in the plugin", async () => {
    state.pluginRows.push({
      scope: "host",
      scopeId: "1",
      key: "profileId",
      value: "4",
    });
    state.hostRows = [{ id: 1, vault_profile_id: 7 }];
    await runVaultSettingsMigration();
    expect(setting("1", "profileId")).toBe("4");
  });

  it("keeps the old redirect URI for profiles the plugin has not adopted yet", async () => {
    state.legacyProfiles = 1;
    const result = await runVaultSettingsMigration();
    expect(result.legacyCallback).toBe(true);
  });

  it("uses the new redirect URI on a fresh install, and profiles made later do not change that", async () => {
    state.columnGone = true;
    const first = await runVaultSettingsMigration();
    expect(first.legacyCallback).toBe(false);
    expect(setting(null, "legacyCallback")).toBe("false");

    state.adoptedProfiles = 3;
    await runVaultSettingsMigration();
    expect(setting(null, "legacyCallback")).toBe("false");
  });

  it("waits for the plugin row", async () => {
    state.pluginInstalled = false;
    state.hostRows = [{ id: 1, vault_profile_id: 7 }];
    await runVaultSettingsMigration();
    expect(state.pluginRows).toHaveLength(0);
  });
});
