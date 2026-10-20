/**
 * The audit forwarding settings migration.
 *
 * An upgrade must keep forwarding working: the collector URL and token have to
 * reach the audit-tools plugin's settings (token encrypted) and be gone from
 * the core settings table. Running it twice must not clobber anything.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
  encrypted: boolean;
}

const state = vi.hoisted(() => ({
  pluginRows: [] as Row[],
  core: new Map<string, string>(),
  pluginInstalled: true,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "audit-tools" ? { id } : null,
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
      encrypted = false,
    ) => {
      state.pluginRows = state.pluginRows.filter(
        (row) => !(row.scope === scope && row.key === key),
      );
      state.pluginRows.push({ scope, scopeId, key, value, encrypted });
    },
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.core.get(key) ?? null,
    delete: async (key: string) => {
      state.core.delete(key);
    },
  }),
}));

vi.mock("../../utils/system-secret-crypto.js", () => ({
  encryptSystemSecret: async (value: string) => `enc(${value})`,
}));

import { runAuditForwardingMigration } from "../../upgrade/audit-forwarding-migration.js";

const row = (key: string) =>
  state.pluginRows.find((entry) => entry.key === key);

beforeEach(() => {
  state.pluginRows = [];
  state.core = new Map();
  state.pluginInstalled = true;
});

describe("audit forwarding migration", () => {
  it("does nothing until the plugin exists", async () => {
    state.pluginInstalled = false;
    state.core.set("audit_log_forward_url", "https://siem.test/in");

    expect(await runAuditForwardingMigration()).toEqual({
      url: false,
      token: false,
    });
    expect(state.core.get("audit_log_forward_url")).toBe(
      "https://siem.test/in",
    );
  });

  it("copies the url and encrypts the token, then clears core", async () => {
    state.core.set("audit_log_forward_url", " https://siem.test/in ");
    state.core.set("audit_log_forward_token", "secret");

    expect(await runAuditForwardingMigration()).toEqual({
      url: true,
      token: true,
    });

    expect(JSON.parse(row("url")!.value!)).toBe("https://siem.test/in");
    expect(row("url")!.encrypted).toBe(false);
    expect(JSON.parse(row("token")!.value!)).toBe("enc(secret)");
    expect(row("token")!.encrypted).toBe(true);
    expect(state.core.size).toBe(0);
  });

  it("is safe to run twice", async () => {
    state.core.set("audit_log_forward_url", "https://siem.test/in");
    state.core.set("audit_log_forward_token", "secret");

    await runAuditForwardingMigration();
    const again = await runAuditForwardingMigration();

    expect(again).toEqual({ url: false, token: false });
    expect(state.pluginRows).toHaveLength(2);
  });

  it("keeps what the plugin already has", async () => {
    state.pluginRows.push({
      scope: "admin",
      scopeId: null,
      key: "url",
      value: JSON.stringify("https://new.test/in"),
      encrypted: false,
    });
    state.core.set("audit_log_forward_url", "https://old.test/in");

    const result = await runAuditForwardingMigration();

    expect(result.url).toBe(false);
    expect(JSON.parse(row("url")!.value!)).toBe("https://new.test/in");
    expect(state.core.has("audit_log_forward_url")).toBe(false);
  });

  it("drops a stray token when there is no url", async () => {
    state.core.set("audit_log_forward_token", "orphan");

    await runAuditForwardingMigration();

    expect(state.core.has("audit_log_forward_token")).toBe(false);
    expect(state.pluginRows).toHaveLength(0);
  });
});
