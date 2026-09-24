/**
 * The AI settings migration.
 *
 * An upgrade must be lossless: the admin switch, the private endpoint list,
 * every user's opt-in, every host's switch and every provider key have to
 * reach the ai plugin, keys encrypted and gone from the table. Running it
 * twice must not duplicate or clobber anything.
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
  pluginRows: [] as Row[],
  coreSettings: new Map<string, string>(),
  preferences: [] as Array<Record<string, unknown>>,
  hosts: [] as Array<Record<string, unknown>>,
  providers: new Map<string, Array<Record<string, unknown>>>(),
  pluginInstalled: true,
  deks: new Set<string>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "ai" ? { id } : null,
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.coreSettings.get(key) ?? null,
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
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
      encrypted = false,
    ) => {
      state.pluginRows.push({
        pluginId,
        scope,
        scopeId,
        key,
        value,
        encrypted,
      });
    },
  }),
}));

/** The SQL text of a drizzle sql`` query, identifiers included. */
function text(query: { queryChunks: unknown[] }): string {
  return query.queryChunks
    .map((chunk) => {
      if (typeof chunk === "string") return chunk;
      const value = (chunk as { value?: unknown; name?: unknown }) ?? {};
      if (Array.isArray(value.value)) return value.value.join("");
      // sql.identifier() is a Name chunk carrying the table name.
      if (typeof value.value === "string") return value.value;
      if (typeof value.name === "string") return value.name;
      return String(chunk);
    })
    .join("");
}

vi.mock("../../utils/crypto-migration/raw-rows.js", () => ({
  selectRows: async (query: { queryChunks: unknown[] }) => {
    const sqlText = text(query);
    if (sqlText.includes("FROM user_preferences")) return state.preferences;
    if (sqlText.includes("FROM ssh_data")) return state.hosts;
    for (const [table, rows] of state.providers) {
      if (new RegExp(`FROM ${table} `).test(sqlText)) {
        return rows.filter((row) => row.api_key);
      }
    }
    throw new Error(`no such table in: ${sqlText}`);
  },
  runStatement: async (query: { queryChunks: unknown[] }) => {
    const sqlText = text(query);
    for (const [table, rows] of state.providers) {
      if (!sqlText.includes(`UPDATE ${table} `)) continue;
      const id = query.queryChunks.find((chunk) => typeof chunk === "number");
      for (const row of rows) if (row.id === id) row.api_key = null;
    }
  },
}));

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    getUserDataKey: (userId: string) =>
      state.deks.has(userId) ? Buffer.from(userId) : null,
  },
}));

vi.mock("../../utils/lazy-field-encryption.js", () => ({
  LazyFieldEncryption: {
    // Stands in for FieldCrypto: "enc:<plain>" decrypts, anything else is a
    // legacy plaintext value.
    safeGetFieldValue: (value: string) => value.replace(/^enc:/, ""),
  },
}));

vi.mock("../../utils/system-secret-crypto.js", () => ({
  encryptSystemSecret: async (value: string) => `sysenc:${value}`,
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import {
  allowlistToText,
  runAiSettingsMigration,
} from "../../utils/crypto-migration/ai-settings-migration.js";

const value = (scope: string, scopeId: string | null, key: string) => {
  const row = state.pluginRows.find(
    (entry) =>
      entry.scope === scope && entry.scopeId === scopeId && entry.key === key,
  );
  return row ? JSON.parse(row.value ?? "null") : undefined;
};

beforeEach(() => {
  state.pluginRows = [];
  state.coreSettings = new Map([
    ["ai_globally_enabled", "true"],
    ["ai_private_endpoint_allowlist", '["localhost", "ollama.lan"]'],
  ]);
  state.preferences = [
    { user_id: "u1", ai_assistant_enabled: 1, ai_read_only_commands: 0 },
    { user_id: "u2", ai_assistant_enabled: null, ai_read_only_commands: null },
  ];
  state.hosts = [
    { id: 5, enable_ai_assistant: 1 },
    { id: 6, enable_ai_assistant: 0 },
  ];
  state.providers = new Map([
    [
      "ai_providers",
      [
        { id: 3, user_id: "u1", api_key: "enc:sk-one" },
        { id: 4, user_id: "u2", api_key: "sk-plain" },
      ],
    ],
  ]);
  state.pluginInstalled = true;
  state.deks = new Set(["u1", "u2"]);
});

describe("allowlistToText", () => {
  it("turns the stored JSON array into one host per line", () => {
    expect(allowlistToText('[" a ", "", "b"]')).toBe("a\nb");
    expect(allowlistToText("[]")).toBe("");
    expect(allowlistToText("nope")).toBeNull();
  });
});

describe("runAiSettingsMigration", () => {
  it("moves admin, user and host settings", async () => {
    await runAiSettingsMigration();

    expect(value("admin", null, "globallyEnabled")).toBe(true);
    expect(value("admin", null, "privateEndpoints")).toBe(
      "localhost\nollama.lan",
    );
    expect(value("user", "u1", "enabled")).toBe(true);
    expect(value("user", "u1", "allowReadOnlyCommands")).toBe(false);
    // Never asked stays unset, which the plugin reads as not enabled.
    expect(value("user", "u2", "enabled")).toBeUndefined();
    expect(value("host", "5", "enableAiAssistant")).toBe(true);
    expect(value("host", "6", "enableAiAssistant")).toBeUndefined();
  });

  it("moves each provider key into its owner's secrets, encrypted, and clears the column", async () => {
    await runAiSettingsMigration();

    const secret = state.pluginRows.find(
      (row) => row.scope === "secret" && row.key === "provider:3",
    );
    expect(secret).toMatchObject({
      scopeId: "u1",
      encrypted: true,
      value: JSON.stringify("sysenc:sk-one"),
    });
    expect(value("secret", "u2", "provider:4")).toBe("sysenc:sk-plain");
    expect(
      state.providers.get("ai_providers")!.every((row) => row.api_key === null),
    ).toBe(true);
  });

  it("leaves a key alone while its owner's data key is unavailable", async () => {
    state.deks = new Set(["u1"]);
    await runAiSettingsMigration();

    expect(value("secret", "u2", "provider:4")).toBeUndefined();
    const row = state.providers.get("ai_providers")!.find((r) => r.id === 4);
    expect(row?.api_key).toBe("sk-plain");
  });

  it("reads the adopted table once the plugin has renamed it", async () => {
    state.providers = new Map([
      ["p_ai_providers", [{ id: 8, user_id: "u1", api_key: "enc:sk-late" }]],
    ]);
    await runAiSettingsMigration();

    expect(value("secret", "u1", "provider:8")).toBe("sysenc:sk-late");
  });

  it("changes nothing on a second run", async () => {
    await runAiSettingsMigration();
    const first = JSON.stringify(state.pluginRows);

    await runAiSettingsMigration();

    expect(JSON.stringify(state.pluginRows)).toBe(first);
  });

  it("does not overwrite a value the plugin already has", async () => {
    state.pluginRows.push({
      pluginId: "ai",
      scope: "admin",
      scopeId: null,
      key: "globallyEnabled",
      value: "false",
      encrypted: false,
    });
    await runAiSettingsMigration();

    expect(value("admin", null, "globallyEnabled")).toBe(false);
  });

  it("does nothing until the plugin row exists", async () => {
    state.pluginInstalled = false;
    await runAiSettingsMigration();
    expect(state.pluginRows).toEqual([]);
  });
});
