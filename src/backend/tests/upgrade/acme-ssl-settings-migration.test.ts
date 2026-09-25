/**
 * The ACME settings migration: a 2.8 acme_ssl_settings row comes through into
 * the acme-ssl plugin's admin settings, the Cloudflare token stays encrypted
 * and leaves the old row, and a second run changes nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  legacy: {} as Record<string, string>,
  pluginRows: [] as Array<{
    key: string;
    value: string | null;
    encrypted: boolean;
  }>,
  pluginInstalled: true,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "acme-ssl" ? { id } : null,
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.legacy[key] ?? null,
    set: async (key: string, value: string) => {
      state.legacy[key] = value;
    },
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
      encrypted = false,
    ) => {
      state.pluginRows = state.pluginRows.filter((row) => row.key !== key);
      state.pluginRows.push({ key, value, encrypted });
    },
  }),
}));

vi.mock("../../utils/system-secret-crypto.js", () => ({
  encryptSystemSecret: async (value: string) => `enc:${value}`,
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import { runAcmeSslSettingsMigration } from "../../upgrade/acme-ssl-settings-migration.js";

const value = (key: string) => {
  const row = state.pluginRows.find((candidate) => candidate.key === key);
  return row?.value == null ? undefined : JSON.parse(row.value);
};

beforeEach(() => {
  state.legacy = {
    acme_ssl_settings: JSON.stringify({
      enabled: true,
      domain: "termix.example.com",
      email: "admin@example.com",
      challengeType: "dns-cloudflare",
      cloudflareToken: "cf-token",
      lastIssuedAt: "2026-01-01T00:00:00.000Z",
    }),
  };
  state.pluginRows = [];
  state.pluginInstalled = true;
});

describe("runAcmeSslSettingsMigration", () => {
  it("moves every field and encrypts the token", async () => {
    const result = await runAcmeSslSettingsMigration();
    expect(result.moved.sort()).toEqual(
      [
        "autoRenew",
        "challengeType",
        "cloudflareToken",
        "domain",
        "email",
      ].sort(),
    );
    expect(value("domain")).toBe("termix.example.com");
    expect(value("email")).toBe("admin@example.com");
    expect(value("challengeType")).toBe("dns-cloudflare");
    expect(value("autoRenew")).toBe(true);
    expect(value("cloudflareToken")).toBe("enc:cf-token");
    expect(
      state.pluginRows.find((row) => row.key === "cloudflareToken")?.encrypted,
    ).toBe(true);

    const left = JSON.parse(state.legacy.acme_ssl_settings);
    expect(left.cloudflareToken).toBeUndefined();
    expect(left.domain).toBe("termix.example.com");
  });

  it("maps the webroot challenge and turns renewal off for manual", async () => {
    state.legacy.acme_ssl_settings = JSON.stringify({
      enabled: true,
      domain: "a.example",
      email: "a@example.com",
      challengeType: "http-webroot",
    });
    await runAcmeSslSettingsMigration();
    expect(value("challengeType")).toBe("http-01");
    expect(value("autoRenew")).toBe(true);

    state.pluginRows = [];
    state.legacy.acme_ssl_settings = JSON.stringify({
      enabled: true,
      challengeType: "manual",
    });
    await runAcmeSslSettingsMigration();
    expect(value("autoRenew")).toBe(false);
    expect(value("challengeType")).toBeUndefined();
  });

  it("changes nothing on a second run or over values already set", async () => {
    await runAcmeSslSettingsMigration();
    const snapshot = JSON.stringify(state.pluginRows);
    const second = await runAcmeSslSettingsMigration();
    expect(second.moved).toEqual([]);
    expect(JSON.stringify(state.pluginRows)).toBe(snapshot);
  });

  it("does nothing before the plugin row exists or without a legacy row", async () => {
    state.pluginInstalled = false;
    expect((await runAcmeSslSettingsMigration()).moved).toEqual([]);
    state.pluginInstalled = true;
    state.legacy = {};
    expect((await runAcmeSslSettingsMigration()).moved).toEqual([]);
    expect(state.pluginRows).toEqual([]);
  });
});
