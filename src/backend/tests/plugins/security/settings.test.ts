/**
 * Settings: a secret is encrypted at rest and never read back, and every
 * write path goes through the same checks, including the host import path
 * that used to write rows straight into plugin_settings.
 *
 * The HTTP scope checks (admin needs admin.plugins.manage, a user only ever
 * writes their own, a host needs edit access) are covered route by route in
 * settings-routes.test.ts.
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

const state = vi.hoisted(() => ({
  rows: [] as Row[],
  manifests: [] as unknown[],
  normalizer: null as null | ((raw: Record<string, unknown>) => unknown),
}));

vi.mock("../../../utils/logger.js", () => {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  return { sshLogger: log, pluginLogger: log };
});
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentPluginSettingsRepository: () => ({
    get: async (p: string, s: string, id: string | null, k: string) =>
      state.rows.find(
        (row) =>
          row.pluginId === p &&
          row.scope === s &&
          row.scopeId === id &&
          row.key === k,
      ) ?? null,
    getAll: async (p: string, s: string, id: string | null) =>
      state.rows.filter(
        (row) => row.pluginId === p && row.scope === s && row.scopeId === id,
      ),
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
      encrypted = false,
    ) => {
      state.rows = state.rows.filter(
        (row) =>
          !(
            row.pluginId === pluginId &&
            row.scope === scope &&
            row.scopeId === scopeId &&
            row.key === key
          ),
      );
      state.rows.push({ pluginId, scope, scopeId, key, value, encrypted });
    },
  }),
}));
vi.mock("../../../utils/system-secret-crypto.js", () => ({
  isSystemEncrypted: (value: string) => value.startsWith("sysenc:v1:"),
  encryptSystemSecret: async (plaintext: string) =>
    `sysenc:v1:${Buffer.from(plaintext, "utf8").toString("base64")}`,
  decryptSystemSecret: async (stored: string) =>
    Buffer.from(stored.slice("sysenc:v1:".length), "base64").toString("utf8"),
}));
vi.mock("../../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: {
      list: () =>
        state.manifests.map((manifest) => ({ state: "active", manifest })),
    },
  }),
}));
vi.mock("../../../plugins/registry.js", () => ({
  consume: () => state.normalizer,
}));

const { applyPluginHostImportSettings } =
  await import("../../../database/routes/host-plugin-settings.js");
const { getAllSettings, setSetting } =
  await import("../../../plugins/settings.js");

const MANIFEST = {
  id: "vaultish",
  name: "Vaultish",
  version: "1.0.0",
  capabilities: [],
  contributes: {
    settings: {
      host: {
        fields: [
          { key: "token", type: "secret", labelKey: "k" },
          { key: "port", type: "number", labelKey: "k", min: 1, max: 65535 },
        ],
      },
      admin: [{ key: "apiKey", type: "secret", labelKey: "k" }],
    },
  },
};

beforeEach(() => {
  state.rows = [];
  state.manifests = [MANIFEST];
  state.normalizer = null;
});

describe("secrets at rest", () => {
  it("are stored encrypted and read back only as { set }", async () => {
    await setSetting(MANIFEST as never, "admin", null, "apiKey", "hunter2");
    const row = state.rows.find((entry) => entry.key === "apiKey")!;
    expect(row.encrypted).toBe(true);
    expect(row.value).not.toContain("hunter2");

    const shown = await getAllSettings(MANIFEST as never, "admin", null, {
      redactSecrets: true,
    });
    expect(shown.apiKey).toEqual({ set: true });
  });
});

describe("the host import path", () => {
  it("encrypts a secret a plugin's normalizer returns", async () => {
    state.normalizer = () => ({ token: "from-import", port: 8200 });
    await applyPluginHostImportSettings(7, {});

    const token = state.rows.find((entry) => entry.key === "token")!;
    expect(token.encrypted).toBe(true);
    expect(token.value).not.toContain("from-import");
    expect(state.rows.find((entry) => entry.key === "port")?.value).toBe(
      "8200",
    );
  });

  it("refuses a key the manifest does not declare, and a bad value", async () => {
    state.normalizer = () => ({ injected: "x", port: 999999 });
    await applyPluginHostImportSettings(7, {});
    expect(state.rows).toEqual([]);
  });

  it("never restores a secret carried in an export", async () => {
    await applyPluginHostImportSettings(7, {
      pluginSettings: { vaultish: { token: "leaked", port: 22 } },
    });
    expect(state.rows.map((entry) => entry.key)).toEqual(["port"]);
  });
});
