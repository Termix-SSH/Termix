import crypto from "crypto";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jwtSecret = "b".repeat(64);
const encryptionKey = crypto.randomBytes(32);

const state = vi.hoisted(() => ({
  users: new Map<
    string,
    {
      id: string;
      username: string;
      isAdmin: boolean;
      disabledAt?: string | null;
    }
  >(),
}));

vi.mock("../../database/db/index.js", () => ({
  db: {},
  getDb: () => ({}),
  saveMemoryDatabaseToFile: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  createCurrentSessionRepository: () => ({
    findById: async (id: string) => ({
      id,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    }),
    touch: async () => {},
    revoke: async () => {},
  }),
  createCurrentUserRepository: () => ({
    findById: async (id: string) => state.users.get(id) ?? null,
  }),
  createCurrentRoleRepository: () => ({
    listUserRolePermissions: async () => [JSON.stringify(["*"])],
    listUserRoleIds: async () => [1],
  }),
  createCurrentApiKeyRepository: () => ({}),
  createCurrentTrustedDeviceRepository: () => ({}),
  getCurrentSettingValue: () => null,
}));

vi.mock("../../utils/user-keys.js", () => ({
  UserKeyManager: {
    getInstance: () => ({
      hasUserDEK: vi.fn(() => true),
      tryGetUserDEK: vi.fn(() => null),
      invalidate: vi.fn(),
    }),
  },
}));

vi.mock("../../utils/crypto-migration/dek-migration.js", () => ({
  adoptRecoveredDEK: vi.fn(async () => {}),
  migratePasswordUserAtLogin: vi.fn(async () => true),
}));

vi.mock("../../utils/system-crypto.js", () => ({
  SystemCrypto: {
    getInstance: () => ({
      getJWTSecret: async () => jwtSecret,
      getEncryptionKey: async () => encryptionKey,
    }),
  },
}));

const { AuthManager, requestToken } =
  await import("../../utils/auth-manager.js");
const { PermissionManager, isActiveAdmin } =
  await import("../../utils/permission-manager.js");

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();

function makeRes() {
  const res = {
    statusCode: 200,
    body: null as unknown,
    cleared: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    clearCookie() {
      res.cleared = true;
      return res;
    },
  };
  return res;
}

describe("P0 auth hardening: disabled accounts, admin checks, and CSRF", () => {
  beforeEach(() => {
    state.users.clear();
    permissionManager.invalidateUserPermissionCache("u-1");
  });

  it("blocks disabled accounts in createAuthMiddleware and clears the cookie", async () => {
    state.users.set("u-disabled", {
      id: "u-disabled",
      username: "bob",
      isAdmin: false,
      disabledAt: "2026-11-24T00:00:00.000Z",
    });

    const token = jwt.sign(
      { userId: "u-disabled", sessionId: "s-1" },
      jwtSecret,
      { expiresIn: "1h" },
    );
    const req = {
      cookies: { jwt: token },
      headers: {},
      method: "GET",
      originalUrl: "/host/db/host",
      url: "/host/db/host",
    };
    const res = makeRes();
    const next = vi.fn();

    await authManager.createAuthMiddleware()(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
    expect(res.cleared).toBe(true);
    expect(res.body).toMatchObject({ code: "ACCOUNT_DISABLED" });
  });

  it("blocks disabled admins in createAdminMiddleware and isActiveAdmin", async () => {
    const disabledAdmin = {
      id: "a-disabled",
      username: "admin",
      isAdmin: true,
      disabledAt: "2026-11-24T00:00:00.000Z",
    };
    state.users.set(disabledAdmin.id, disabledAdmin);
    expect(isActiveAdmin(disabledAdmin)).toBe(false);
    expect(isActiveAdmin({ isAdmin: true, disabledAt: null })).toBe(true);

    const token = jwt.sign(
      { userId: disabledAdmin.id, sessionId: "s-admin" },
      jwtSecret,
      { expiresIn: "1h" },
    );
    const req = {
      cookies: { jwt: token },
      headers: {},
      method: "GET",
      path: "/admin",
      originalUrl: "/admin",
      url: "/admin",
    };
    const res = makeRes();
    const next = vi.fn();

    await authManager.createAdminMiddleware()(req as never, res as never, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it("fails closed in PermissionManager.hasPermission even when cached", async () => {
    state.users.set("u-1", {
      id: "u-1",
      username: "alice",
      isAdmin: true,
      disabledAt: null,
    });
    expect(await permissionManager.hasPermission("u-1", "hosts.write")).toBe(
      true,
    );

    // Disable user without clearing cache explicitly
    state.users.set("u-1", {
      id: "u-1",
      username: "alice",
      isAdmin: true,
      disabledAt: "2026-11-24T00:00:00.000Z",
    });
    expect(await permissionManager.hasPermission("u-1", "hosts.write")).toBe(
      false,
    );
  });

  it("does not bypass cookie origin CSRF check when X-Electron-App header is spoofed", () => {
    const req = {
      method: "POST",
      cookies: { jwt: "victim-cookie" },
      headers: {
        host: "termix.example.com",
        origin: "https://evil.example.com",
        "x-electron-app": "true",
      },
    };
    const result = requestToken(req as never);
    expect(result).toEqual({ refused: true });
  });
});
