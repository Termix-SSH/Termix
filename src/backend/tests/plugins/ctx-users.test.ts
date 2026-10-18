/**
 * ctx.auth.issueUserToken mints a short-lived session core's own auth
 * middleware accepts as the named user, under users:impersonate, audited and
 * kept off account security routes. ctx.users.getLocale reads the user's UI
 * language under users:read.
 */

import crypto from "crypto";
import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  grants: [] as string[],
  users: new Map<string, { id: string; username: string; isAdmin: boolean }>(),
  sessions: new Map<string, Record<string, unknown>>(),
  languages: new Map<string, string | null>(),
  audits: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../database/db/index.js", () => ({
  db: {},
  getDb: () => ({}),
  saveMemoryDatabaseToFile: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      state.grants.map((capability) => ({ pluginId, capability })),
  }),
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  createCurrentSessionRepository: () => ({
    create: async (session: Record<string, unknown>) => {
      state.sessions.set(session.id as string, session);
      return session;
    },
    findById: async (id: string) => state.sessions.get(id) ?? null,
    touch: async () => {},
    revoke: async (id: string) => state.sessions.delete(id),
  }),
  createCurrentUserRepository: () => ({
    findById: async (id: string) => state.users.get(id) ?? null,
  }),
  createCurrentUserPreferenceRepository: () => ({
    findByUserId: async (userId: string) =>
      state.languages.has(userId)
        ? { userId, language: state.languages.get(userId) }
        : null,
  }),
  createCurrentApiKeyRepository: () => ({}),
  createCurrentTrustedDeviceRepository: () => ({}),
  getCurrentSettingValue: () => null,
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    state.audits.push(entry);
  },
  getRequestMeta: () => ({ ipAddress: "", userAgent: "" }),
}));

vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getJWTSecret: async () => "a".repeat(64),
      getEncryptionKey: async () => crypto.randomBytes(32),
    }),
  },
}));

vi.mock("../../utils/user-keys.js", () => ({
  UserKeyManager: {
    getInstance: () => ({
      hasUserDEK: () => true,
      tryGetUserDEK: () => null,
      invalidate: vi.fn(),
    }),
  },
}));

vi.mock("../../utils/crypto-migration/dek-migration.js", () => ({
  adoptRecoveredDEK: vi.fn(async () => {}),
  migratePasswordUserAtLogin: vi.fn(async () => true),
}));

const { createPluginContext, createPluginHandle } =
  await import("../../plugins/ctx.js");
const { invalidatePluginPermissionCache } =
  await import("../../plugins/permissions.js");
const { AuthManager } = await import("../../utils/auth-manager.js");
const { registerSecondFactor, resetAuthRegistryForTests } =
  await import("../../auth/registry.js");
const { PluginCapabilityError } =
  await import("@termix-ssh/plugin-sdk/backend");

const authManager = AuthManager.getInstance();
const authenticate = authManager.createAuthMiddleware();
const requireAdmin = authManager.createAdminMiddleware();

function contextFor(capabilities: string[], grants = capabilities) {
  state.grants = grants;
  const manifest = {
    id: "ai",
    name: "AI",
    version: "1.0.0",
    capabilities,
  } as never;
  return createPluginContext(manifest, createPluginHandle("ai", {} as never));
}

type Middleware = typeof authenticate;

async function call(middleware: Middleware, token: string, url: string) {
  const req = {
    cookies: {},
    headers: { authorization: `Bearer ${token}` },
    method: "POST",
    originalUrl: url,
    url,
  } as unknown as Parameters<Middleware>[0] & { userId?: string };
  const res = {
    statusCode: 200,
    body: null as unknown,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
    clearCookie() {
      return res;
    },
  };
  let passed = false;
  await middleware(req, res as never, () => {
    passed = true;
  });
  return { passed, status: res.statusCode, body: res.body, userId: req.userId };
}

beforeEach(() => {
  state.users = new Map([
    ["u1", { id: "u1", username: "alice", isAdmin: false }],
    ["admin", { id: "admin", username: "root", isAdmin: true }],
  ]);
  state.sessions.clear();
  state.languages.clear();
  state.audits = [];
  invalidatePluginPermissionCache();
  resetAuthRegistryForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ctx.auth.issueUserToken", () => {
  it("mints a session core's auth middleware accepts as that user", async () => {
    const ctx = contextFor(["users:impersonate"]);

    const { token, expiresAt } = await ctx.auth.issueUserToken("u1", {
      purpose: "nightly report",
    });
    const result = await call(authenticate, token, "/host/db/host");

    expect(result.passed).toBe(true);
    expect(result.userId).toBe("u1");
    const session = [...state.sessions.values()][0];
    expect(session).toMatchObject({
      userId: "u1",
      deviceType: "plugin",
      deviceInfo: "ai: nightly report",
      expiresAt,
    });
    const payload = jwt.decode(token) as { exp: number; iat: number };
    expect(payload.exp - payload.iat).toBe(300);
  });

  it("keeps the user's own permissions", async () => {
    const ctx = contextFor(["users:impersonate"]);
    const user = await ctx.auth.issueUserToken("u1", { purpose: "check" });
    const admin = await ctx.auth.issueUserToken("admin", { purpose: "check" });

    const refused = await call(requireAdmin, user.token, "/users/list");
    expect(refused.passed).toBe(false);
    expect(refused.status).toBe(403);
    expect((await call(requireAdmin, admin.token, "/users/list")).passed).toBe(
      true,
    );
  });

  it("caps the lifetime at 900 seconds", async () => {
    const ctx = contextFor(["users:impersonate"]);

    const { token, expiresAt } = await ctx.auth.issueUserToken("u1", {
      purpose: "long task",
      ttlSeconds: 86_400,
    });

    const payload = jwt.decode(token) as { exp: number; iat: number };
    expect(payload.exp - payload.iat).toBe(900);
    expect(new Date(expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(
      900_000,
    );
  });

  it("stops working when the session expires", async () => {
    const ctx = contextFor(["users:impersonate"]);
    const { token } = await ctx.auth.issueUserToken("u1", {
      purpose: "short",
      ttlSeconds: 60,
    });

    vi.useFakeTimers({ now: Date.now() + 61_000 });
    const result = await call(authenticate, token, "/host/db/host");

    expect(result.passed).toBe(false);
    expect(result.status).toBe(401);
  });

  it("audits every issue with the plugin, the user and the purpose", async () => {
    const ctx = contextFor(["users:impersonate"]);

    await ctx.auth.issueUserToken("u1", { purpose: "nightly report" });

    const entry = state.audits.find(
      (audit) => audit.action === "plugin_user_token_issued",
    );
    expect(entry).toMatchObject({
      username: "plugin:ai",
      resourceType: "user",
      resourceId: "u1",
      success: true,
    });
    expect(JSON.parse(entry!.details as string)).toEqual({
      pluginId: "ai",
      purpose: "nightly report",
      ttlSeconds: 300,
    });
  });

  it("is refused without a granted users:impersonate", async () => {
    for (const ctx of [
      contextFor([]),
      contextFor(["users:impersonate"], []),
      contextFor(["users:read"]),
    ]) {
      await expect(
        ctx.auth.issueUserToken("u1", { purpose: "x" }),
      ).rejects.toBeInstanceOf(PluginCapabilityError);
    }
    expect(state.sessions.size).toBe(0);
    expect(state.audits.every((audit) => audit.success === false)).toBe(true);
  });

  it("is refused for a user that does not exist, or without a purpose", async () => {
    const ctx = contextFor(["users:impersonate"]);

    await expect(
      ctx.auth.issueUserToken("ghost", { purpose: "x" }),
    ).rejects.toThrow(/does not exist/);
    await expect(
      ctx.auth.issueUserToken("u1", { purpose: "  " }),
    ).rejects.toThrow(/purpose/);
    expect(state.sessions.size).toBe(0);
    expect(
      state.audits.filter(
        (audit) =>
          audit.action === "plugin_user_token_issued" && !audit.success,
      ),
    ).toHaveLength(2);
  });

  it("cannot change how the user signs in or mint lasting credentials", async () => {
    registerSecondFactor({ id: "totp", pluginId: "totp" } as never);
    const ctx = contextFor(["users:impersonate"]);
    const { token } = await ctx.auth.issueUserToken("admin", {
      purpose: "ops",
    });

    for (const url of [
      "/users/change-password",
      "/users/link-external-to-password",
      "/users/admin/reset-password",
      "/users/admin/u1/second-factors",
      "/plugin-api/totp/setup",
    ]) {
      const result = await call(authenticate, token, url);
      expect(result.passed, url).toBe(false);
      expect(result.body).toMatchObject({ code: "PLUGIN_SESSION_NOT_ALLOWED" });
    }
    const apiKeys = await call(requireAdmin, token, "/users/api-keys");
    expect(apiKeys.passed).toBe(false);
    expect(apiKeys.body).toMatchObject({ code: "PLUGIN_SESSION_NOT_ALLOWED" });
    expect(
      (await call(authenticate, token, "/plugin-api/other/run")).passed,
    ).toBe(true);
  });

  it("leaves a normal login session free to use those routes", async () => {
    const token = await authManager.generateJWTToken("u1", {
      deviceType: "web",
      deviceInfo: "Chrome",
    });

    expect(
      (await call(authenticate, token, "/users/change-password")).passed,
    ).toBe(true);
  });
});

describe("ctx.users.getLocale", () => {
  it("returns the stored language, or null", async () => {
    state.languages.set("u1", "zh_CN");
    state.languages.set("admin", null);
    const ctx = contextFor(["users:read"]);

    await expect(ctx.users.getLocale("u1")).resolves.toBe("zh_CN");
    await expect(ctx.users.getLocale("admin")).resolves.toBeNull();
    await expect(ctx.users.getLocale("nobody")).resolves.toBeNull();
  });

  it("is refused without a granted users:read", async () => {
    state.languages.set("u1", "zh_CN");

    await expect(
      contextFor(["users:read"], []).users.getLocale("u1"),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
    await expect(
      contextFor(["users:impersonate"]).users.getLocale("u1"),
    ).rejects.toBeInstanceOf(PluginCapabilityError);
  });
});
