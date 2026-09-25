/**
 * The plugin settings service.
 *
 * Storage is faked at the repository boundary; everything above it - schema
 * lookup, validation, encryption, redaction and change notification - is the
 * real implementation, because that is where the behaviour worth protecting
 * lives.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

interface Row {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
  encrypted: boolean;
}

const rows: Row[] = [];

function find(
  pluginId: string,
  scope: string,
  scopeId: string | null,
  key: string,
) {
  return rows.find(
    (row) =>
      row.pluginId === pluginId &&
      row.scope === scope &&
      row.scopeId === scopeId &&
      row.key === key,
  );
}

const settingsRepository = {
  get: vi.fn(
    async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) => find(pluginId, scope, scopeId, key) ?? null,
  ),
  getAll: vi.fn(
    async (pluginId: string, scope: string, scopeId: string | null) =>
      rows.filter(
        (row) =>
          row.pluginId === pluginId &&
          row.scope === scope &&
          row.scopeId === scopeId,
      ),
  ),
  set: vi.fn(
    async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
      encrypted = false,
    ) => {
      const existing = find(pluginId, scope, scopeId, key);
      if (existing) {
        existing.value = value;
        existing.encrypted = encrypted;
        return;
      }
      rows.push({ pluginId, scope, scopeId, key, value, encrypted });
    },
  ),
  listByKey: vi.fn(async (pluginId: string, scope: string, key: string) =>
    rows.filter(
      (row) =>
        row.pluginId === pluginId && row.scope === scope && row.key === key,
    ),
  ),
};

const hostOwners = new Map<number, string>();

const coreSettings = new Map<string, string>();

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginSettingsRepository: () => settingsRepository,
  createCurrentHostRepository: () => ({
    findById: async (id: number) =>
      hostOwners.has(id) ? { id, userId: hostOwners.get(id) } : null,
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => coreSettings.get(key) ?? null,
  }),
}));

// Real AES would need the system key on disk. The prefix and the idempotence
// are what the service depends on, so the double keeps both.
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

const {
  CORE_SETTINGS_ALLOWLIST,
  clearSettingsListeners,
  declaredFields,
  findField,
  getAllSettings,
  getSetting,
  listHostValues,
  onSettingsChange,
  onSettingsValidate,
  readCoreSetting,
  setSetting,
  validateSettingsSave,
} = await import("../../plugins/settings.js");

function manifest(settings: unknown): PluginManifest {
  return {
    id: "sample",
    name: "Sample",
    version: "1.0.0",
    description: "",
    author: { name: "t" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities: [],
    contributes: { settings },
  } as PluginManifest;
}

const ADMIN = manifest({
  admin: [
    { key: "apiKey", type: "secret", labelKey: "k" },
    { key: "baseUrl", type: "string", labelKey: "k", default: "https://x" },
    { key: "retries", type: "number", labelKey: "k", min: 0, max: 5 },
    { key: "enabled", type: "boolean", labelKey: "k", default: false },
    {
      key: "mode",
      type: "select",
      labelKey: "k",
      options: [
        { value: "fast", labelKey: "k" },
        { value: "slow", labelKey: "k" },
      ],
    },
  ],
});

beforeEach(() => {
  rows.length = 0;
  coreSettings.clear();
  clearSettingsListeners("sample");
  vi.clearAllMocks();
});

describe("declaredFields", () => {
  it("returns the fields for each scope", () => {
    expect(declaredFields(ADMIN, "admin").map((f) => f.key)).toEqual([
      "apiKey",
      "baseUrl",
      "retries",
      "enabled",
      "mode",
    ]);
    expect(declaredFields(ADMIN, "user")).toEqual([]);
  });

  it("treats the host enable key as a real boolean field", () => {
    const withHost = manifest({
      host: {
        enableKey: "enableThing",
        enableLabelKey: "k",
        fields: [{ key: "port", type: "number", labelKey: "k" }],
      },
    });

    const fields = declaredFields(withHost, "host");
    expect(fields.map((f) => f.key)).toEqual(["enableThing", "port"]);
    expect(fields[0]).toMatchObject({ type: "boolean", default: false });
  });

  it("finds a field by key", () => {
    expect(findField(ADMIN, "admin", "baseUrl")?.type).toBe("string");
    expect(findField(ADMIN, "admin", "nope")).toBeUndefined();
  });
});

describe("setSetting", () => {
  it("writes a valid value and reads it back", async () => {
    expect(
      await setSetting(ADMIN, "admin", null, "baseUrl", "https://y"),
    ).toBeNull();
    expect(await getSetting(ADMIN, "admin", null, "baseUrl")).toBe("https://y");
  });

  it("refuses a key the manifest never declared", async () => {
    const error = await setSetting(ADMIN, "admin", null, "wat", "x");

    expect(error).toContain("not a settings field this plugin declares");
    expect(rows).toHaveLength(0);
  });

  it("refuses a value that fails the declared constraint", async () => {
    expect(await setSetting(ADMIN, "admin", null, "retries", 99)).toContain(
      "at most 5",
    );
    expect(
      await setSetting(ADMIN, "admin", null, "mode", "sideways"),
    ).toContain("must be one of");
    expect(rows).toHaveLength(0);
  });

  it("coerces the strings a form actually sends", async () => {
    expect(await setSetting(ADMIN, "admin", null, "retries", "3")).toBeNull();
    expect(await getSetting(ADMIN, "admin", null, "retries")).toBe(3);

    expect(
      await setSetting(ADMIN, "admin", null, "enabled", "true"),
    ).toBeNull();
    expect(await getSetting(ADMIN, "admin", null, "enabled")).toBe(true);
  });

  it("keeps each scope separate", async () => {
    const scoped = manifest({
      admin: [{ key: "v", type: "string", labelKey: "k" }],
      user: [{ key: "v", type: "string", labelKey: "k" }],
      host: { fields: [{ key: "v", type: "string", labelKey: "k" }] },
    });

    await setSetting(scoped, "admin", null, "v", "a");
    await setSetting(scoped, "user", "user-1", "v", "u");
    await setSetting(scoped, "host", 7, "v", "h");

    expect(await getSetting(scoped, "admin", null, "v")).toBe("a");
    expect(await getSetting(scoped, "user", "user-1", "v")).toBe("u");
    expect(await getSetting(scoped, "host", 7, "v")).toBe("h");
    // A different user sees nothing of the first user's value.
    expect(await getSetting(scoped, "user", "user-2", "v")).toBeUndefined();
  });

  it("stores a host id as text, matching the polymorphic scope column", async () => {
    const scoped = manifest({
      host: { fields: [{ key: "v", type: "string", labelKey: "k" }] },
    });

    await setSetting(scoped, "host", 12, "v", "x");

    expect(rows[0].scopeId).toBe("12");
    // Either spelling resolves to the same row.
    expect(await getSetting(scoped, "host", "12", "v")).toBe("x");
  });
});

describe("defaults", () => {
  it("falls back to the declared default when nothing is stored", async () => {
    expect(await getSetting(ADMIN, "admin", null, "baseUrl")).toBe("https://x");
    expect(await getSetting(ADMIN, "admin", null, "enabled")).toBe(false);
  });

  it("returns undefined for a field with no default and no value", async () => {
    expect(await getSetting(ADMIN, "admin", null, "retries")).toBeUndefined();
  });

  it("returns undefined for a key the manifest does not declare", async () => {
    expect(await getSetting(ADMIN, "admin", null, "wat")).toBeUndefined();
  });
});

describe("secrets", () => {
  it("encrypts on the way in and decrypts on the way out", async () => {
    await setSetting(ADMIN, "admin", null, "apiKey", "tskey-secret");

    const row = rows.find((entry) => entry.key === "apiKey")!;
    expect(row.encrypted).toBe(true);
    expect(row.value).not.toContain("tskey-secret");
    expect(JSON.parse(row.value!)).toMatch(/^sysenc:v1:/);

    expect(await getSetting(ADMIN, "admin", null, "apiKey")).toBe(
      "tskey-secret",
    );
  });

  it("redacts a secret rather than returning it", async () => {
    await setSetting(ADMIN, "admin", null, "apiKey", "tskey-secret");

    const values = await getAllSettings(ADMIN, "admin", null, {
      redactSecrets: true,
    });

    expect(values.apiKey).toEqual({ set: true });
    expect(JSON.stringify(values)).not.toContain("tskey-secret");
  });

  it("reports an unset secret as set:false", async () => {
    const values = await getAllSettings(ADMIN, "admin", null, {
      redactSecrets: true,
    });

    expect(values.apiKey).toEqual({ set: false });
  });

  it("treats a redacted echo as leave-it-alone", async () => {
    await setSetting(ADMIN, "admin", null, "apiKey", "original");

    expect(
      await setSetting(ADMIN, "admin", null, "apiKey", { set: true }),
    ).toBeNull();

    expect(await getSetting(ADMIN, "admin", null, "apiKey")).toBe("original");
  });

  it("lets a secret be replaced and cleared", async () => {
    await setSetting(ADMIN, "admin", null, "apiKey", "first");
    await setSetting(ADMIN, "admin", null, "apiKey", "second");
    expect(await getSetting(ADMIN, "admin", null, "apiKey")).toBe("second");

    await setSetting(ADMIN, "admin", null, "apiKey", "");
    const values = await getAllSettings(ADMIN, "admin", null, {
      redactSecrets: true,
    });
    expect(values.apiKey).toEqual({ set: false });
  });

  it("hands a plugin its own secret in the clear", async () => {
    await setSetting(ADMIN, "admin", null, "apiKey", "tskey-secret");

    const values = await getAllSettings(ADMIN, "admin", null);

    expect(values.apiKey).toBe("tskey-secret");
  });
});

describe("getAllSettings", () => {
  it("is driven by the manifest, not by the stored rows", async () => {
    await setSetting(ADMIN, "admin", null, "baseUrl", "https://y");
    // A row for a field the plugin has since dropped.
    rows.push({
      pluginId: "sample",
      scope: "admin",
      scopeId: null,
      key: "removedField",
      value: JSON.stringify("stale"),
      encrypted: false,
    });

    const values = await getAllSettings(ADMIN, "admin", null);

    expect(values.baseUrl).toBe("https://y");
    expect(values.enabled).toBe(false);
    expect(values).not.toHaveProperty("removedField");
  });

  it("returns nothing for a scope the plugin declares no fields in", async () => {
    expect(await getAllSettings(ADMIN, "user", "user-1")).toEqual({});
  });
});

describe("onSettingsChange", () => {
  it("fires on a successful write", async () => {
    const listener = vi.fn();
    onSettingsChange("sample", "baseUrl", listener);

    await setSetting(ADMIN, "admin", null, "baseUrl", "https://z");

    expect(listener).toHaveBeenCalledWith("https://z");
  });

  it("does not fire for a rejected write", async () => {
    const listener = vi.fn();
    onSettingsChange("sample", "retries", listener);

    await setSetting(ADMIN, "admin", null, "retries", 99);

    expect(listener).not.toHaveBeenCalled();
  });

  it("stops firing once unsubscribed", async () => {
    const listener = vi.fn();
    const unsubscribe = onSettingsChange("sample", "baseUrl", listener);

    unsubscribe();
    await setSetting(ADMIN, "admin", null, "baseUrl", "https://z");

    expect(listener).not.toHaveBeenCalled();
  });

  it("only notifies listeners for that key and plugin", async () => {
    const other = vi.fn();
    const another = vi.fn();
    onSettingsChange("sample", "enabled", other);
    onSettingsChange("different-plugin", "baseUrl", another);

    await setSetting(ADMIN, "admin", null, "baseUrl", "https://z");

    expect(other).not.toHaveBeenCalled();
    expect(another).not.toHaveBeenCalled();
    clearSettingsListeners("different-plugin");
  });

  it("survives a listener that throws", async () => {
    const good = vi.fn();
    onSettingsChange("sample", "baseUrl", () => {
      throw new Error("listener blew up");
    });
    onSettingsChange("sample", "baseUrl", good);

    await expect(
      setSetting(ADMIN, "admin", null, "baseUrl", "https://z"),
    ).resolves.toBeNull();
    expect(good).toHaveBeenCalled();
  });

  it("drops every listener when the plugin deactivates", async () => {
    const listener = vi.fn();
    onSettingsChange("sample", "baseUrl", listener);

    clearSettingsListeners("sample");
    await setSetting(ADMIN, "admin", null, "baseUrl", "https://z");

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("readCoreSetting", () => {
  it("returns an allowlisted key", async () => {
    coreSettings.set("app_name", "Termix");

    expect(await readCoreSetting("app_name")).toBe("Termix");
  });

  it("refuses a key that is not on the allowlist", async () => {
    coreSettings.set("jwt_secret", "nope");

    await expect(readCoreSetting("jwt_secret")).rejects.toThrow(
      /not readable by plugins/,
    );
  });

  it("does not expose anything sensitive through the allowlist", () => {
    for (const key of CORE_SETTINGS_ALLOWLIST) {
      expect(key).not.toMatch(/secret|password|token|key$/i);
    }
  });
});

describe("settings validators", () => {
  it("collects every validator's errors for its scope only", async () => {
    const stop = onSettingsValidate("validated", "admin", (values) =>
      values.url === "bad" ? { url: "Nope" } : undefined,
    );
    onSettingsValidate("validated", "user", () => ({ other: "Wrong scope" }));

    expect(
      await validateSettingsSave("validated", "admin", null, { url: "bad" }),
    ).toEqual({ url: "Nope" });
    expect(
      await validateSettingsSave("validated", "admin", null, { url: "ok" }),
    ).toEqual({});

    stop();
    clearSettingsListeners("validated");
    expect(await validateSettingsSave("validated", "user", null, {})).toEqual(
      {},
    );
  });

  it("passes the host id to a host validator", async () => {
    let seen: number | undefined;
    onSettingsValidate("validated-host", "host", (_values, context) => {
      seen = context.hostId;
    });
    await validateSettingsSave("validated-host", "host", "12", {});
    expect(seen).toBe(12);
    clearSettingsListeners("validated-host");
  });
});

describe("listHostValues", () => {
  const withHostField = manifest({
    host: {
      enableKey: "on",
      enableLabelKey: "x",
      fields: [{ key: "token", type: "secret", labelKey: "x" }],
    },
  });

  it("lists stored values with each host's owner", async () => {
    hostOwners.set(7, "alice");
    hostOwners.set(8, "bob");
    await setSetting(withHostField, "host", 7, "on", true);
    await setSetting(withHostField, "host", 8, "on", false);
    await setSetting(withHostField, "host", 99, "on", true);

    const listed = await listHostValues(withHostField, "on");
    expect(listed).toEqual(
      expect.arrayContaining([
        { hostId: 7, userId: "alice", value: true },
        { hostId: 8, userId: "bob", value: false },
      ]),
    );
    // A row for a host that no longer exists is skipped.
    expect(listed.find((entry) => entry.hostId === 99)).toBeUndefined();
  });

  it("refuses a secret field", async () => {
    await expect(listHostValues(withHostField, "token")).rejects.toThrow(
      /secret/,
    );
  });
});

describe("enableDefault", () => {
  it("is what the host switch reads before a host saves it", () => {
    const fields = declaredFields(
      manifest({
        host: {
          enableKey: "on",
          enableLabelKey: "x",
          enableDefault: true,
          fields: [],
        },
      }),
      "host",
    );
    expect(fields[0]).toMatchObject({ key: "on", default: true });
  });
});
