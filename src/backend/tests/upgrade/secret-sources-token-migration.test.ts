/**
 * The secret source token migration.
 *
 * An upgrade must be lossless: every source's access token has to reach the
 * secret-sources plugin's ctx.secrets, encrypted, and be gone from the
 * table. Running it twice must not duplicate or clobber anything.
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
  sources: new Map<string, Array<Record<string, unknown>>>(),
  pluginInstalled: true,
  deks: new Set<string>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "secret-sources" ? { id } : null,
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
      if (typeof value.value === "string") return value.value;
      if (typeof value.name === "string") return value.name;
      return String(chunk);
    })
    .join("");
}

vi.mock("../../utils/crypto-migration/raw-rows.js", () => ({
  selectRows: async (query: { queryChunks: unknown[] }) => {
    const sqlText = text(query);
    for (const [table, rows] of state.sources) {
      if (new RegExp(`FROM ${table} `).test(sqlText)) {
        return rows.filter((row) => row.token);
      }
    }
    throw new Error(`no such table in: ${sqlText}`);
  },
  runStatement: async (query: { queryChunks: unknown[] }) => {
    const sqlText = text(query);
    for (const [table, rows] of state.sources) {
      if (!sqlText.includes(`UPDATE ${table} `)) continue;
      const id = query.queryChunks.find((chunk) => typeof chunk === "string");
      for (const row of rows) if (row.id === id) row.token = null;
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

import { runSecretSourcesTokenMigration } from "../../upgrade/secret-sources-token-migration.js";

const value = (scopeId: string | null, key: string) => {
  const row = state.pluginRows.find(
    (entry) =>
      entry.scope === "secret" &&
      entry.scopeId === scopeId &&
      entry.key === key,
  );
  return row ? JSON.parse(row.value ?? "null") : undefined;
};

beforeEach(() => {
  state.pluginRows = [];
  state.sources = new Map([
    [
      "secret_sources",
      [
        { id: "src-1", user_id: "u1", token: "enc:tok-one" },
        { id: "src-2", user_id: "u2", token: "tok-plain" },
      ],
    ],
  ]);
  state.pluginInstalled = true;
  state.deks = new Set(["u1", "u2"]);
});

describe("runSecretSourcesTokenMigration", () => {
  it("moves each source's token into its owner's secrets, encrypted, and clears the column", async () => {
    const result = await runSecretSourcesTokenMigration();

    expect(result).toEqual({ moved: 2 });
    const secret = state.pluginRows.find(
      (row) => row.scope === "secret" && row.key === "source:src-1",
    );
    expect(secret).toMatchObject({
      scopeId: "u1",
      encrypted: true,
      value: JSON.stringify("sysenc:tok-one"),
    });
    expect(value("u2", "source:src-2")).toBe("sysenc:tok-plain");
    expect(
      state.sources.get("secret_sources")!.every((row) => row.token === null),
    ).toBe(true);
  });

  it("leaves a token alone while its owner's data key is unavailable", async () => {
    state.deks = new Set(["u1"]);
    const result = await runSecretSourcesTokenMigration();

    expect(result).toEqual({ moved: 1 });
    expect(value("u2", "source:src-2")).toBeUndefined();
    const row = state.sources
      .get("secret_sources")!
      .find((r) => r.id === "src-2");
    expect(row?.token).toBe("tok-plain");
  });

  it("reads the adopted table once the plugin has renamed it", async () => {
    state.sources = new Map([
      [
        "p_secret_sources_sources",
        [{ id: "src-9", user_id: "u1", token: "enc:tok-late" }],
      ],
    ]);
    await runSecretSourcesTokenMigration();

    expect(value("u1", "source:src-9")).toBe("sysenc:tok-late");
  });

  it("changes nothing on a second run", async () => {
    await runSecretSourcesTokenMigration();
    const first = JSON.stringify(state.pluginRows);

    const second = await runSecretSourcesTokenMigration();

    expect(second).toEqual({ moved: 0 });
    expect(JSON.stringify(state.pluginRows)).toBe(first);
  });

  it("does nothing until the plugin row exists", async () => {
    state.pluginInstalled = false;
    const result = await runSecretSourcesTokenMigration();
    expect(result).toEqual({ moved: 0 });
    expect(state.pluginRows).toEqual([]);
  });
});
