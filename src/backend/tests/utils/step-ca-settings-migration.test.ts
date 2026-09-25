/**
 * The Step CA settings migration: a 2.8 CA configuration and its private
 * endpoint allowlist come through into the step-ca plugin's admin settings,
 * the old redirect URI stays in use, and a second run changes nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  legacy: {} as Record<string, string>,
  pluginRows: [] as Array<{ key: string; value: string | null }>,
  pluginInstalled: true,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "step-ca" ? { id } : null,
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.legacy[key] ?? null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      _pluginId: string,
      _scope: string,
      _scopeId: string | null,
      key: string,
    ) => state.pluginRows.find((row) => row.key === key) ?? null,
    set: async (
      _pluginId: string,
      _scope: string,
      _scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      state.pluginRows = state.pluginRows.filter((row) => row.key !== key);
      state.pluginRows.push({ key, value });
    },
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import { runStepCaSettingsMigration } from "../../utils/crypto-migration/step-ca-settings-migration.js";

const value = (key: string) => {
  const row = state.pluginRows.find((candidate) => candidate.key === key);
  return row?.value == null ? undefined : JSON.parse(row.value);
};

beforeEach(() => {
  state.legacy = {
    step_ca_url: "https://ca.internal:9000",
    step_ca_fingerprint: "a".repeat(64),
    step_ca_provisioner: "oidc",
    step_ca_private_endpoint_allowlist: JSON.stringify([
      "ca.internal",
      "SSO.internal",
    ]),
  };
  state.pluginRows = [];
  state.pluginInstalled = true;
});

describe("runStepCaSettingsMigration", () => {
  it("moves the 2.8 settings and keeps the old redirect URI", async () => {
    const result = await runStepCaSettingsMigration();
    expect(result.moved).toEqual([
      "step_ca_url",
      "step_ca_fingerprint",
      "step_ca_provisioner",
      "step_ca_private_endpoint_allowlist",
    ]);
    expect(result.legacyCallback).toBe(true);
    expect(value("caUrl")).toBe("https://ca.internal:9000");
    expect(value("fingerprint")).toBe("a".repeat(64));
    expect(value("provisioner")).toBe("oidc");
    expect(value("privateEndpoints")).toBe("ca.internal, sso.internal");
    expect(value("legacyCallback")).toBe(true);
  });

  it("changes nothing the second time", async () => {
    await runStepCaSettingsMigration();
    const before = JSON.stringify(state.pluginRows);
    const again = await runStepCaSettingsMigration();
    expect(again).toEqual({ moved: [], legacyCallback: false });
    expect(JSON.stringify(state.pluginRows)).toBe(before);
  });

  it("never overwrites a value set in the plugin", async () => {
    state.pluginRows = [
      { key: "caUrl", value: JSON.stringify("https://new.ca") },
      { key: "legacyCallback", value: JSON.stringify(false) },
    ];
    await runStepCaSettingsMigration();
    expect(value("caUrl")).toBe("https://new.ca");
    expect(value("legacyCallback")).toBe(false);
    expect(value("provisioner")).toBe("oidc");
  });

  it("leaves an install that never used Step CA alone", async () => {
    state.legacy = {};
    const result = await runStepCaSettingsMigration();
    expect(result).toEqual({ moved: [], legacyCallback: false });
    expect(state.pluginRows).toEqual([]);
  });

  it("does nothing until the plugin row exists", async () => {
    state.pluginInstalled = false;
    await runStepCaSettingsMigration();
    expect(state.pluginRows).toEqual([]);
  });
});
