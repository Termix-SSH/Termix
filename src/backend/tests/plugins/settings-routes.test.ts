/**
 * The /plugins/:id/settings routes.
 *
 * These decide who may change what, so the tests are mostly about refusal: a
 * non-admin must not write install-wide configuration, a user must not write
 * another user's settings or a host they cannot edit, and a secret must never
 * come back over the wire.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

const state = vi.hoisted(() => ({
  userId: "user-1",
  permissions: new Set<string>(),
  hostEditAccess: true,
  hostOwner: true,
}));

vi.mock("../../utils/crypto-migration/raw-rows.js", () => ({
  runStatement: vi.fn(async () => {}),
}));

vi.mock("../../utils/logger.js", () => {
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  };
  return { pluginLogger: logger, databaseLogger: logger, apiLogger: logger };
});

vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (
          req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          (req as express.Request & { userId?: string }).userId = state.userId;
          next();
        },
    }),
  },
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      hasPermission: async (_userId: string, permission: string) =>
        state.permissions.has(permission),
      requirePermission:
        (permission: string) =>
        (
          _req: express.Request,
          res: express.Response,
          next: express.NextFunction,
        ) => {
          if (!state.permissions.has(permission)) {
            res.status(403).json({ error: "Insufficient permissions" });
            return;
          }
          next();
        },
      canAccessHost: async () => ({
        hasAccess: state.hostEditAccess,
        isOwner: state.hostEditAccess && state.hostOwner,
        isShared: false,
      }),
    }),
  },
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async () => {}),
  getAuditUsername: vi.fn(async (id: string) => id),
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));

const MANIFEST: PluginManifest = {
  id: "sample",
  name: "Sample",
  version: "1.0.0",
  description: "",
  author: { name: "t" },
  license: "MIT",
  category: "Productivity",
  engine: { termix: ">=2.9.0", api: "1" },
  capabilities: [],
  contributes: {
    permissions: [{ name: "tweak", titleKey: "k", descriptionKey: "k" }],
    settings: {
      admin: [
        { key: "apiKey", type: "secret", labelKey: "k" },
        { key: "retries", type: "number", labelKey: "k", min: 0, max: 5 },
        {
          key: "narrowed",
          type: "string",
          labelKey: "k",
          permission: "tweak",
        },
      ],
      user: [
        { key: "theme", type: "string", labelKey: "k", default: "dark" },
        {
          key: "advanced",
          type: "string",
          labelKey: "k",
          permission: "tweak",
        },
      ],
      host: {
        enableKey: "enableThing",
        enableLabelKey: "k",
        fields: [
          { key: "port", type: "number", labelKey: "k" },
          { key: "profile", type: "string", labelKey: "k", ownerOnly: true },
        ],
      },
    },
  },
} as PluginManifest;

vi.mock("../../plugins/index.js", () => ({
  getPluginRuntime: () => ({
    loader: {
      get: (id: string) =>
        id === "sample"
          ? { id, manifest: MANIFEST, state: "active" }
          : undefined,
      list: () => [{ id: "sample", manifest: MANIFEST, state: "active" }],
    },
  }),
}));

interface Row {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
  encrypted: boolean;
}

const rows: Row[] = [];

function find(scope: string, scopeId: string | null, key: string) {
  return rows.find(
    (row) => row.scope === scope && row.scopeId === scopeId && row.key === key,
  );
}

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      id === "sample"
        ? { id, manifestJson: JSON.stringify(MANIFEST), state: "enabled" }
        : null,
    listAll: async () => [],
  }),
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async () => [],
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      _pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) => find(scope, scopeId, key) ?? null,
    getAll: async (_pluginId: string, scope: string, scopeId: string | null) =>
      rows.filter((row) => row.scope === scope && row.scopeId === scopeId),
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
      encrypted = false,
    ) => {
      const existing = find(scope, scopeId, key);
      if (existing) {
        existing.value = value;
        existing.encrypted = encrypted;
        return;
      }
      rows.push({ pluginId, scope, scopeId, key, value, encrypted });
    },
  }),
  createCurrentSettingsRepository: () => ({ get: async () => null }),
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

const pluginRoutes = (await import("../../database/routes/plugins.js")).default;

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  rows.length = 0;
  state.userId = "user-1";
  state.permissions = new Set<string>();
  state.hostEditAccess = true;
  state.hostOwner = true;

  const app = express();
  app.use(express.json());
  app.use("/plugins", pluginRoutes);

  server = await new Promise<Server>((resolve) => {
    const created = app.listen(0, "127.0.0.1", () => resolve(created));
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function call(path: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
}

describe("admin scope", () => {
  it("refuses a reader without admin.plugins.manage", async () => {
    const response = await call("/plugins/sample/settings/admin");

    expect(response.status).toBe(403);
  });

  it("refuses a writer without admin.plugins.manage", async () => {
    const response = await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ retries: 2 }),
    });

    expect(response.status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it("lets an admin read and write", async () => {
    state.permissions.add("admin.plugins.manage");

    const write = await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ retries: 3 }),
    });
    expect(write.status).toBe(200);

    const read = await call("/plugins/sample/settings/admin");
    expect((await read.json()).values.retries).toBe(3);
  });

  it("reports a rejected value per field", async () => {
    state.permissions.add("admin.plugins.manage");

    const response = await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ retries: 99 }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).errors.retries).toContain("at most 5");
    expect(rows).toHaveLength(0);
  });

  it("refuses a key the manifest never declared", async () => {
    state.permissions.add("admin.plugins.manage");

    const response = await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ somethingElse: "x" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).errors.somethingElse).toBeDefined();
    expect(rows).toHaveLength(0);
  });

  it("never returns a secret's value", async () => {
    state.permissions.add("admin.plugins.manage");

    await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "tskey-very-secret" }),
    });

    const response = await call("/plugins/sample/settings/admin");
    const body = await response.text();

    expect(body).not.toContain("tskey-very-secret");
    expect(JSON.parse(body).values.apiKey).toEqual({ set: true });
  });

  it("treats a redacted echo as no change", async () => {
    state.permissions.add("admin.plugins.manage");

    await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "tskey-original" }),
    });
    await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ apiKey: { set: true }, retries: 1 }),
    });

    const row = rows.find((entry) => entry.key === "apiKey")!;
    expect(
      Buffer.from(
        JSON.parse(row.value!).slice("sysenc:v1:".length),
        "base64",
      ).toString("utf8"),
    ).toBe("tskey-original");
  });

  it("keeps the admin gate even for a field naming its own permission", async () => {
    // Holding the field's permission is not enough: admin scope is admin
    // scope, so a plugin cannot hand install-wide config to an ordinary user.
    state.permissions.add("sample.tweak");

    const response = await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ narrowed: "x" }),
    });

    expect(response.status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it("narrows an admin field to holders of its permission", async () => {
    state.permissions.add("admin.plugins.manage");

    const denied = await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ narrowed: "x" }),
    });
    expect(denied.status).toBe(400);
    expect((await denied.json()).errors.narrowed).toContain("permission");

    state.permissions.add("sample.tweak");
    const allowed = await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify({ narrowed: "x" }),
    });
    expect(allowed.status).toBe(200);
  });

  it("404s for a plugin that does not exist", async () => {
    state.permissions.add("admin.plugins.manage");

    const response = await call("/plugins/nope/settings/admin");

    expect(response.status).toBe(404);
  });

  it("rejects a body that is not an object", async () => {
    state.permissions.add("admin.plugins.manage");

    const response = await call("/plugins/sample/settings/admin", {
      method: "PUT",
      body: JSON.stringify([1, 2, 3]),
    });

    expect(response.status).toBe(400);
  });
});

describe("user scope", () => {
  it("lets any authenticated user read and write their own", async () => {
    const write = await call("/plugins/sample/settings/user", {
      method: "PUT",
      body: JSON.stringify({ theme: "light" }),
    });
    expect(write.status).toBe(200);

    const read = await call("/plugins/sample/settings/user");
    expect((await read.json()).values.theme).toBe("light");
  });

  it("scopes writes to the caller, never to a user id in the body", async () => {
    await call("/plugins/sample/settings/user", {
      method: "PUT",
      body: JSON.stringify({ theme: "light", userId: "someone-else" }),
    });

    // The bogus key is rejected and the row belongs to the caller.
    expect(rows.every((row) => row.scopeId === "user-1")).toBe(true);

    state.userId = "user-2";
    const other = await call("/plugins/sample/settings/user");
    expect((await other.json()).values.theme).toBe("dark");
  });

  it("refuses a user field gated on a permission the caller lacks", async () => {
    const response = await call("/plugins/sample/settings/user", {
      method: "PUT",
      body: JSON.stringify({ advanced: "x" }),
    });

    expect(response.status).toBe(400);
    expect((await response.json()).errors.advanced).toContain("permission");
    expect(rows).toHaveLength(0);
  });

  it("allows it once the caller holds that permission", async () => {
    state.permissions.add("sample.tweak");

    const response = await call("/plugins/sample/settings/user", {
      method: "PUT",
      body: JSON.stringify({ advanced: "x" }),
    });

    expect(response.status).toBe(200);
  });

  it("refuses an admin field through the user route", async () => {
    const response = await call("/plugins/sample/settings/user", {
      method: "PUT",
      body: JSON.stringify({ apiKey: "nope" }),
    });

    expect(response.status).toBe(400);
    expect(rows).toHaveLength(0);
  });
});

describe("host scope", () => {
  it("keeps an owner-only field from a shared editor", async () => {
    state.hostOwner = false;
    const write = await call("/plugins/sample/settings/host/7", {
      method: "PUT",
      body: JSON.stringify({ profile: "other", port: 22 }),
    });
    expect(write.status).toBe(400);
    expect((await write.json()).errors.profile).toMatch(/owner/);
    expect(rows).toHaveLength(0);

    state.hostOwner = true;
    const owner = await call("/plugins/sample/settings/host/7", {
      method: "PUT",
      body: JSON.stringify({ profile: "mine" }),
    });
    expect(owner.status).toBe(200);
  });

  it("runs the plugin's validators before writing anything", async () => {
    const { onSettingsValidate, clearSettingsListeners } =
      await import("../../plugins/settings.js");
    onSettingsValidate("sample", "host", (values) =>
      Number(values.port) > 1000 ? { port: "Too high" } : undefined,
    );
    const write = await call("/plugins/sample/settings/host/7", {
      method: "PUT",
      body: JSON.stringify({ enableThing: true, port: 5000 }),
    });
    expect(write.status).toBe(400);
    expect((await write.json()).errors).toEqual({ port: "Too high" });
    expect(rows).toHaveLength(0);
    clearSettingsListeners("sample");
  });

  it("lets a user with edit access read and write", async () => {
    const write = await call("/plugins/sample/settings/host/7", {
      method: "PUT",
      body: JSON.stringify({ enableThing: true, port: 22 }),
    });
    expect(write.status).toBe(200);

    const read = await call("/plugins/sample/settings/host/7");
    const values = (await read.json()).values;
    expect(values.enableThing).toBe(true);
    expect(values.port).toBe(22);
  });

  it("refuses a host the caller cannot edit", async () => {
    state.hostEditAccess = false;

    const read = await call("/plugins/sample/settings/host/7");
    expect(read.status).toBe(403);

    const write = await call("/plugins/sample/settings/host/7", {
      method: "PUT",
      body: JSON.stringify({ port: 22 }),
    });
    expect(write.status).toBe(403);
    expect(rows).toHaveLength(0);
  });

  it("rejects an invalid host id", async () => {
    const response = await call("/plugins/sample/settings/host/not-a-number");

    expect(response.status).toBe(400);
  });

  it("keeps each host's values apart", async () => {
    await call("/plugins/sample/settings/host/7", {
      method: "PUT",
      body: JSON.stringify({ port: 22 }),
    });
    await call("/plugins/sample/settings/host/8", {
      method: "PUT",
      body: JSON.stringify({ port: 2222 }),
    });

    const seven = await (await call("/plugins/sample/settings/host/7")).json();
    const eight = await (await call("/plugins/sample/settings/host/8")).json();

    expect(seven.values.port).toBe(22);
    expect(eight.values.port).toBe(2222);
  });

  it("returns the declared default for an untouched host", async () => {
    const response = await call("/plugins/sample/settings/host/9");

    expect((await response.json()).values.enableThing).toBe(false);
  });
});
