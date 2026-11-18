/**
 * API key logins, the admin gate, trusted devices and session upkeep in
 * AuthManager. Keys are checked against their bcrypt hash, refused when
 * expired, limited by their scopes and never allowed to impersonate.
 */
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import express from "express";
import type { AddressInfo } from "net";
import type { Server } from "http";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const jwtSecret = "b".repeat(64);
const GOOD = "tmx_goodkey000000000000000000";
const EXPIRED = "tmx_expiredk0000000000000000";
const READ = "tmx_readonly0000000000000000";

const state = vi.hoisted(() => ({
  keys: [] as Array<Record<string, unknown>>,
  admins: new Set<string>(),
  devices: new Map<string, { expiresAt: string }>(),
  touched: [] as string[],
  sessions: [
    { id: "s1", userId: "u1" },
    { id: "s2", userId: "u1" },
  ] as Array<{ id: string; userId: string }>,
  revoked: [] as unknown[],
  failSessions: false,
}));

vi.mock("../../database/db/index.js", () => ({
  db: {},
  getDb: () => ({}),
  saveMemoryDatabaseToFile: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  createCurrentSessionRepository: () => {
    const guard = () => {
      if (state.failSessions) throw new Error("db down");
    };
    return {
      findById: async (id: string) => ({
        id,
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
        idleTimeout: null,
        lastActiveAt: new Date().toISOString(),
      }),
      revoke: async (id: string) => {
        guard();
        state.revoked.push(id);
        return true;
      },
      revokeAllForUser: async (userId: string, except?: string) => {
        guard();
        state.revoked.push([userId, except]);
      },
      listByUserId: async (userId: string) => {
        guard();
        return state.sessions.filter((s) => s.userId === userId);
      },
      listAll: async () => {
        guard();
        return state.sessions;
      },
      hashStoredTokens: async () => undefined,
      listExpired: async () => {
        guard();
        return [{ id: "old" }];
      },
      deleteExpired: async () => undefined,
      touch: async () => true,
      create: async (row: unknown) => row,
    };
  },
  createCurrentUserRepository: () => ({
    findById: async (id: string) => ({ id, isAdmin: state.admins.has(id) }),
  }),
  createCurrentApiKeyRepository: () => ({
    listActiveByTokenPrefix: async (prefix: string) =>
      state.keys.filter((k) => k.prefix === prefix),
    updateLastUsedAt: async () => undefined,
  }),
  createCurrentTrustedDeviceRepository: () => ({
    findByUserAndFingerprint: async (u: string, f: string) =>
      state.devices.get(`${u}:${f}`) ?? null,
    touch: async (u: string, f: string) => state.touched.push(`${u}:${f}`),
    upsert: async (row: {
      userId: string;
      deviceFingerprint: string;
      expiresAt: string;
    }) => state.devices.set(`${row.userId}:${row.deviceFingerprint}`, row),
    deleteByUserAndFingerprint: async (u: string, f: string) =>
      state.devices.delete(`${u}:${f}`),
  }),
  getCurrentSettingValue: () => null,
}));

vi.mock("../../utils/user-keys.js", () => ({
  UserKeyManager: {
    getInstance: () => ({
      hasUserDEK: () => false,
      tryGetUserDEK: (id: string) => (id === "u1" ? Buffer.alloc(32) : null),
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
      getEncryptionKey: async () => crypto.randomBytes(32),
    }),
  },
}));

const { AuthManager } = await import("../../utils/auth-manager.js");
const auth = AuthManager.getInstance();

let server: Server;
let base: string;

beforeAll(async () => {
  const key = async (token: string, extra: Record<string, unknown> = {}) => ({
    id: `k-${token.slice(4, 8)}`,
    userId: "u1",
    prefix: token.substring(0, 12),
    tokenHash: await bcrypt.hash(token, 4),
    expiresAt: null,
    scopes: null,
    ...extra,
  });
  state.keys = [
    await key(GOOD),
    await key(EXPIRED, { expiresAt: "2000-01-01T00:00:00Z" }),
    await key(READ, { scopes: JSON.stringify(["read"]), userId: "u2" }),
  ];

  const app = express();
  app.use(express.json());
  const echo = (req: express.Request, res: express.Response) =>
    res.json({
      userId: (req as unknown as { userId?: string }).userId,
      scopes: (req as unknown as { apiKeyScopes?: unknown }).apiKeyScopes,
      hasKey: !!(req as unknown as { dataKey?: Buffer }).dataKey,
    });
  app.all(
    "/user",
    auth.createAuthMiddleware(),
    auth.createDataAccessMiddleware(),
    echo,
  );
  app.all("/admin", auth.createAdminMiddleware(), echo);
  app.get("/data", auth.createDataAccessMiddleware(), echo);
  server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((r) => server.close(r)));

beforeEach(() => {
  state.admins.clear();
  state.revoked = [];
  state.failSessions = false;
});

function call(path: string, token?: string, init: RequestInit = {}) {
  return fetch(`${base}${path}`, {
    ...init,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers as Record<string, string>),
    },
  });
}

describe("API key logins", () => {
  it("lets a valid key in as its user, with its data key", async () => {
    const res = await call("/user", GOOD);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ userId: "u1", hasKey: true });
  });

  it("refuses unknown, wrong and expired keys", async () => {
    expect((await call("/user", "tmx_nosuchprefix_x")).status).toBe(401);
    expect((await call("/user", `${GOOD.slice(0, 12)}wrongtail`)).status).toBe(
      401,
    );
    const expired = await call("/user", EXPIRED);
    expect(expired.status).toBe(401);
    expect(await expired.json()).toEqual({ error: "API key has expired" });
  });

  it("never lets a key impersonate another user", async () => {
    const res = await call("/user", GOOD, {
      headers: { "x-admin-target-user": "u9" },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: "IMPERSONATION_NOT_ALLOWED",
    });
  });

  it("keeps a read key to reads", async () => {
    const read = await call("/user", READ);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({ userId: "u2", scopes: ["read"] });
    const write = await call("/user", READ, { method: "POST" });
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ code: "API_KEY_SCOPE" });
  });

  it("asks for a token when there is none", async () => {
    expect((await call("/user")).status).toBe(401);
    expect((await call("/admin")).status).toBe(401);
    expect((await call("/data")).status).toBe(401);
  });
});

describe("admin gate", () => {
  it("refuses a key whose user is not an admin and lets an admin's key in", async () => {
    expect((await call("/admin", GOOD)).status).toBe(403);
    state.admins.add("u1");
    expect((await call("/admin", GOOD)).status).toBe(200);
  });

  it("refuses a bad JWT and a JWT of a user who is not an admin", async () => {
    expect((await call("/admin", "not-a-jwt")).status).toBe(401);
    const token = jwt.sign({ userId: "u7", sessionId: "s7" }, jwtSecret, {
      expiresIn: "1h",
    });
    expect((await call("/admin", token)).status).toBe(403);
    state.admins.add("u7");
    const ok = await call("/admin", token);
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ userId: "u7" });
  });
});

describe("trusted devices", () => {
  it("trusts a device for 30 days and forgets it after", async () => {
    await auth.addTrustedDevice("u1", "fp", "desktop", "Chrome");
    expect(await auth.isTrustedDevice("u1", "fp")).toBe(true);
    expect(state.touched).toContain("u1:fp");
    expect(await auth.isTrustedDevice("u1", "other")).toBe(false);
    state.devices.set("u1:stale", { expiresAt: "2000-01-01T00:00:00Z" });
    expect(await auth.isTrustedDevice("u1", "stale")).toBe(false);
    expect(state.devices.has("u1:stale")).toBe(false);
    await auth.removeTrustedDevice("u1", "fp");
    expect(await auth.isTrustedDevice("u1", "fp")).toBe(false);
  });
});

describe("sessions", () => {
  it("revokes one, all but one, or all of a user's sessions", async () => {
    expect(await auth.revokeSession("s1")).toBe(true);
    expect(await auth.revokeAllUserSessions("u1", "s2")).toBe(1);
    expect(await auth.revokeAllUserSessions("u1")).toBe(2);
    await auth.logoutUser("u1", "s2");
    await auth.logoutUser("u1");
    expect(state.revoked).toEqual([
      "s1",
      ["u1", "s2"],
      ["u1", undefined],
      "s2",
      ["u1", undefined],
    ]);
  });

  it("lists sessions and cleans up expired ones", async () => {
    expect(await auth.getAllSessions()).toHaveLength(2);
    expect(await auth.getUserSessions("u1")).toHaveLength(2);
    expect(await auth.cleanupExpiredSessions()).toBe(1);
  });

  it("fails soft when the session store is down", async () => {
    state.failSessions = true;
    expect(await auth.revokeSession("s1")).toBe(false);
    expect(await auth.revokeAllUserSessions("u1")).toBe(0);
    expect(await auth.cleanupExpiredSessions()).toBe(0);
    await auth.logoutUser("u1");
    expect(await auth.revokeSessionsByExternalSession({})).toBe(0);
  });

  it("knows which users are unlocked", () => {
    expect(auth.isUserUnlocked("u1")).toBe(true);
    expect(auth.isUserUnlocked("u2")).toBe(false);
    expect(auth.getUserDataKey("u2")).toBeNull();
  });
});
