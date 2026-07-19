import crypto from "crypto";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jwtSecret = "a".repeat(64);
const encryptionKey = crypto.randomBytes(32);

const state = vi.hoisted(() => ({
  users: new Map<string, { id: string; isAdmin: boolean; username: string }>(),
  unlockedUsers: new Set<string>(),
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("../../database/db/index.js", () => ({
  db: {},
  getDb: () => ({}),
  saveMemoryDatabaseToFile: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  // No sessionId in our tokens, so the session branch is skipped.
  createCurrentSessionRepository: () => ({ findById: async () => null }),
  createCurrentUserRepository: () => ({
    findById: async (userId: string) => state.users.get(userId) ?? null,
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

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    canUserAccessData: (userId: string) => state.unlockedUsers.has(userId),
  },
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (params: Record<string, unknown>) => {
    state.auditCalls.push(params);
  },
  getRequestMeta: () => ({ ipAddress: "", userAgent: "" }),
}));

const { AuthManager } = await import("../../utils/auth-manager.js");
const authManager = AuthManager.getInstance();
const middleware = authManager.createAuthMiddleware();

type MockRes = {
  statusCode: number | null;
  body: unknown;
  status: (code: number) => MockRes;
  json: (payload: unknown) => MockRes;
  clearCookie: () => MockRes;
};

function makeRes(): MockRes {
  const res: MockRes = {
    statusCode: null,
    body: null,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
    clearCookie() {
      return res;
    },
  };
  return res;
}

function runMiddleware(token: string, headers: Record<string, string> = {}) {
  const req = {
    cookies: { jwt: token },
    headers,
    method: "GET",
    originalUrl: headers["__url"] ?? "/host/db/host",
    url: headers["__url"] ?? "/host/db/host",
    secure: false,
  } as unknown as Parameters<typeof middleware>[0];
  const res = makeRes();
  let nexted = false;
  return new Promise<{ req: typeof req; res: MockRes; nexted: boolean }>(
    (resolve) => {
      const next = () => {
        nexted = true;
        resolve({ req, res, nexted });
      };
      const maybe = middleware(
        req,
        res as unknown as Parameters<typeof middleware>[1],
        next,
      );
      Promise.resolve(maybe).then(() => {
        if (!nexted) resolve({ req, res, nexted });
      });
    },
  );
}

function token(userId: string) {
  return jwt.sign({ userId }, jwtSecret, { expiresIn: "1h" });
}

beforeEach(() => {
  state.users = new Map([
    ["admin1", { id: "admin1", isAdmin: true, username: "admin" }],
    ["target1", { id: "target1", isAdmin: false, username: "target" }],
    ["regular1", { id: "regular1", isAdmin: false, username: "regular" }],
  ]);
  state.unlockedUsers = new Set(["admin1", "target1", "regular1"]);
  state.auditCalls = [];
});

describe("AuthManager admin impersonation", () => {
  it("swaps req.userId to the target for an admin on an allowlisted path", async () => {
    const { req, nexted } = await runMiddleware(token("admin1"), {
      "x-admin-target-user": "target1",
      __url: "/host/db/host",
    });
    expect(nexted).toBe(true);
    expect((req as unknown as { userId: string }).userId).toBe("target1");
    expect(
      (req as unknown as { actingAdminUserId?: string }).actingAdminUserId,
    ).toBe("admin1");
    expect(state.auditCalls).toHaveLength(1);
    expect(state.auditCalls[0]).toMatchObject({
      action: "admin_impersonated_request",
      resourceId: "target1",
      userId: "admin1",
    });
  });

  it("rejects impersonation by a non-admin", async () => {
    const { res, nexted } = await runMiddleware(token("regular1"), {
      "x-admin-target-user": "target1",
      __url: "/host/db/host",
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect((res.body as { code?: string }).code).toBe("IMPERSONATION_DENIED");
  });

  it("rejects impersonation on a non-allowlisted path", async () => {
    const { res, nexted } = await runMiddleware(token("admin1"), {
      "x-admin-target-user": "target1",
      __url: "/users/sessions",
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(403);
    expect((res.body as { code?: string }).code).toBe(
      "IMPERSONATION_NOT_ALLOWED",
    );
  });

  it("returns 423 when the target's data is locked", async () => {
    state.unlockedUsers = new Set(["admin1"]);
    const { res, nexted } = await runMiddleware(token("admin1"), {
      "x-admin-target-user": "target1",
      __url: "/host/db/host",
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(423);
    expect((res.body as { code?: string }).code).toBe("TARGET_DATA_LOCKED");
  });

  it("404s when the target user does not exist", async () => {
    const { res, nexted } = await runMiddleware(token("admin1"), {
      "x-admin-target-user": "ghost",
      __url: "/host/db/host",
    });
    expect(nexted).toBe(false);
    expect(res.statusCode).toBe(404);
  });

  it("ignores the header when the target equals the admin", async () => {
    const { req, nexted } = await runMiddleware(token("admin1"), {
      "x-admin-target-user": "admin1",
      __url: "/host/db/host",
    });
    expect(nexted).toBe(true);
    expect((req as unknown as { userId: string }).userId).toBe("admin1");
    expect(state.auditCalls).toHaveLength(0);
  });

  it("passes through normally when no header is present", async () => {
    const { req, nexted } = await runMiddleware(token("regular1"));
    expect(nexted).toBe(true);
    expect((req as unknown as { userId: string }).userId).toBe("regular1");
  });
});
