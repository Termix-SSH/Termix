/**
 * The Tailscale settings migration.
 *
 * An upgrade must be lossless: an install that had a working API key must keep
 * working without anyone re-entering it. That is the whole point of the test,
 * and running it twice proves a restart cannot corrupt what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
  encrypted: boolean;
}

const coreSettings = new Map<string, string>();
const pluginRows: Row[] = [];
let pluginInstalled = true;

const pluginSettingsRepository = {
  get: async (
    pluginId: string,
    scope: string,
    scopeId: string | null,
    key: string,
  ) =>
    pluginRows.find(
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
    encrypted = false,
  ) => {
    const existing = pluginRows.find(
      (row) =>
        row.pluginId === pluginId &&
        row.scope === scope &&
        row.scopeId === scopeId &&
        row.key === key,
    );
    if (existing) {
      existing.value = value;
      existing.encrypted = encrypted;
      return;
    }
    pluginRows.push({ pluginId, scope, scopeId, key, value, encrypted });
  },
};

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      pluginInstalled && id === "tailscale" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => pluginSettingsRepository,
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => coreSettings.get(key) ?? null,
    delete: async (key: string) => coreSettings.delete(key),
  }),
}));

vi.mock("../../utils/system-secret-crypto.js", () => ({
  isSystemEncrypted: (value: string) => value.startsWith("sysenc:v1:"),
  encryptSystemSecret: async (plaintext: string) =>
    !plaintext || plaintext.startsWith("sysenc:v1:")
      ? plaintext
      : `sysenc:v1:${Buffer.from(plaintext, "utf8").toString("base64")}`,
  decryptSystemSecret: async (stored: string) =>
    stored.startsWith("sysenc:v1:")
      ? Buffer.from(stored.slice("sysenc:v1:".length), "base64").toString(
          "utf8",
        )
      : stored,
}));

const { runTailscaleSettingsMigration } =
  await import("../../upgrade/tailscale-settings-migration.js");

function storedValue(key: string): unknown {
  const row = pluginRows.find((entry) => entry.key === key);
  return row?.value === null || row?.value === undefined
    ? undefined
    : JSON.parse(row.value);
}

beforeEach(() => {
  coreSettings.clear();
  pluginRows.length = 0;
  pluginInstalled = true;
});

describe("runTailscaleSettingsMigration", () => {
  it("moves an existing key and base URL into plugin settings", async () => {
    coreSettings.set("tailscale_api_key", "tskey-api-legacy");
    coreSettings.set("tailscale_api_base_url", "https://headscale.example");

    const result = await runTailscaleSettingsMigration();

    expect(result.moved).toEqual([
      "tailscale_api_key",
      "tailscale_api_base_url",
    ]);
    expect(storedValue("apiKey")).toMatch(/^sysenc:v1:/);
    expect(storedValue("apiBaseUrl")).toBe("https://headscale.example");
  });

  it("encrypts the key, which was stored in plaintext before", async () => {
    coreSettings.set("tailscale_api_key", "tskey-api-legacy");

    await runTailscaleSettingsMigration();

    const row = pluginRows.find((entry) => entry.key === "apiKey")!;
    expect(row.encrypted).toBe(true);
    expect(row.value).not.toContain("tskey-api-legacy");
  });

  it("leaves the base URL readable, since it is not a secret", async () => {
    coreSettings.set("tailscale_api_base_url", "https://headscale.example");

    await runTailscaleSettingsMigration();

    const row = pluginRows.find((entry) => entry.key === "apiBaseUrl")!;
    expect(row.encrypted).toBe(false);
  });

  it("removes the legacy rows so no plaintext key is left behind", async () => {
    coreSettings.set("tailscale_api_key", "tskey-api-legacy");
    coreSettings.set("tailscale_api_base_url", "https://headscale.example");

    await runTailscaleSettingsMigration();

    expect(coreSettings.has("tailscale_api_key")).toBe(false);
    expect(coreSettings.has("tailscale_api_base_url")).toBe(false);
  });

  it("is idempotent: a second run changes nothing", async () => {
    coreSettings.set("tailscale_api_key", "tskey-api-legacy");
    coreSettings.set("tailscale_api_base_url", "https://headscale.example");

    await runTailscaleSettingsMigration();
    const afterFirst = JSON.parse(JSON.stringify(pluginRows));

    const second = await runTailscaleSettingsMigration();

    expect(second.moved).toEqual([]);
    expect(pluginRows).toEqual(afterFirst);
  });

  it("cannot double-encrypt the key across runs", async () => {
    coreSettings.set("tailscale_api_key", "tskey-api-legacy");

    await runTailscaleSettingsMigration();
    const first = storedValue("apiKey");

    await runTailscaleSettingsMigration();

    expect(storedValue("apiKey")).toBe(first);
    expect(String(storedValue("apiKey")).match(/sysenc:v1:/g)).toHaveLength(1);
  });

  it("drops a stale legacy row when the value was already moved", async () => {
    // An interrupted run, or a downgrade that rewrote the old key.
    await pluginSettingsRepository.set(
      "tailscale",
      "admin",
      null,
      "apiKey",
      JSON.stringify("sysenc:v1:already"),
      true,
    );
    coreSettings.set("tailscale_api_key", "tskey-plaintext-leftover");

    const result = await runTailscaleSettingsMigration();

    expect(result.skipped).toContain("tailscale_api_key");
    expect(storedValue("apiKey")).toBe("sysenc:v1:already");
    expect(coreSettings.has("tailscale_api_key")).toBe(false);
  });

  it("does nothing on a fresh install with no legacy rows", async () => {
    const result = await runTailscaleSettingsMigration();

    expect(result.moved).toEqual([]);
    expect(pluginRows).toEqual([]);
  });

  it("skips an empty legacy value rather than storing one", async () => {
    coreSettings.set("tailscale_api_key", "");

    const result = await runTailscaleSettingsMigration();

    expect(result.moved).toEqual([]);
    expect(pluginRows).toEqual([]);
  });

  it("waits for the plugin row, because of the foreign key", async () => {
    pluginInstalled = false;
    coreSettings.set("tailscale_api_key", "tskey-api-legacy");

    const result = await runTailscaleSettingsMigration();

    expect(result.moved).toEqual([]);
    expect(pluginRows).toEqual([]);
    // Still there for the next boot, once the plugin is seeded.
    expect(coreSettings.get("tailscale_api_key")).toBe("tskey-api-legacy");
  });

  it("moves each key independently", async () => {
    coreSettings.set("tailscale_api_key", "tskey-api-legacy");

    const result = await runTailscaleSettingsMigration();

    expect(result.moved).toEqual(["tailscale_api_key"]);
    expect(storedValue("apiBaseUrl")).toBeUndefined();
  });
});
