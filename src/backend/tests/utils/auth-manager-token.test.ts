import crypto from "crypto";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jwtSecret = "a".repeat(64);
const encryptionKey = crypto.randomBytes(32);

const mocks = vi.hoisted(() => ({
  hasUserDEK: vi.fn(() => false),
  adoptRecoveredDEK: vi.fn(async () => {}),
  revoke: vi.fn(async () => true),
  created: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../database/db/index.js", () => ({
  db: {},
  getDb: () => ({}),
  saveMemoryDatabaseToFile: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  createCurrentSessionRepository: () => ({
    findById: async (id: string) => {
      const minutesAgo = (n: number) =>
        new Date(Date.now() - n * 60_000).toISOString();
      if (id === "expired") {
        return { id, expiresAt: new Date(Date.now() - 1000).toISOString() };
      }
      if (id === "idle") {
        return { id, idleTimeout: 600, lastActiveAt: minutesAgo(11) };
      }
      if (id === "active") {
        return { id, idleTimeout: 600, lastActiveAt: minutesAgo(5) };
      }
      if (id === "setup") return { id, restriction: "second-factor-setup" };
      return { id };
    },
    create: async (row: Record<string, unknown>) => {
      mocks.created.push(row);
      return row;
    },
    revoke: mocks.revoke,
    touch: async () => true,
  }),
  createCurrentUserRepository: () => ({}),
  createCurrentApiKeyRepository: () => ({}),
  createCurrentTrustedDeviceRepository: () => ({}),
  getCurrentSettingValue: () => null,
}));

vi.mock("../../utils/user-keys.js", () => ({
  UserKeyManager: {
    getInstance: () => ({
      hasUserDEK: mocks.hasUserDEK,
      tryGetUserDEK: vi.fn(() => null),
      invalidate: vi.fn(),
    }),
  },
}));

vi.mock("../../utils/crypto-migration/dek-migration.js", () => ({
  adoptRecoveredDEK: mocks.adoptRecoveredDEK,
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

const { AuthManager, allowsSetupSession } =
  await import("../../utils/auth-manager.js");
const { registerSecondFactor } = await import("../../auth/registry.js");
const authManager = AuthManager.getInstance();

function makeLegacyDataKeyWrap(
  userId: string,
  dek: Buffer,
): Record<string, string> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from(`${userId}:s1`, "utf8"));
  const data = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    version: "v1",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
}

beforeEach(() => {
  mocks.created.length = 0;
  mocks.revoke.mockClear();
  mocks.hasUserDEK.mockReset().mockReturnValue(false);
  mocks.adoptRecoveredDEK.mockReset().mockResolvedValue(undefined);
});

describe("AuthManager token handling", () => {
  it("issues tokens without a dataKeyWrap", async () => {
    const token = await authManager.generateJWTToken("user-1");
    const payload = jwt.decode(token) as Record<string, unknown>;

    expect(payload.userId).toBe("user-1");
    expect(payload.dataKeyWrap).toBeUndefined();
  });

  it("adopts the DEK from a legacy dataKeyWrap token on verify", async () => {
    const dek = crypto.randomBytes(32);
    const token = jwt.sign(
      {
        userId: "user-1",
        sessionId: "s1",
        dataKeyWrap: makeLegacyDataKeyWrap("user-1", dek),
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    const payload = await authManager.verifyJWTToken(token);

    expect(payload?.userId).toBe("user-1");
    expect(mocks.adoptRecoveredDEK).toHaveBeenCalledOnce();
    const [userId, adopted] = mocks.adoptRecoveredDEK.mock.calls[0] as [
      string,
      Buffer,
    ];
    expect(userId).toBe("user-1");
    expect(adopted.equals(dek)).toBe(true);
  });

  it("skips adoption when the user already has a v3 key", async () => {
    mocks.hasUserDEK.mockReturnValue(true);
    const token = jwt.sign(
      {
        userId: "user-1",
        sessionId: "s1",
        dataKeyWrap: makeLegacyDataKeyWrap("user-1", crypto.randomBytes(32)),
      },
      jwtSecret,
      { expiresIn: "1h" },
    );

    await authManager.verifyJWTToken(token);

    expect(mocks.adoptRecoveredDEK).not.toHaveBeenCalled();
  });

  it("tolerates a tampered dataKeyWrap without failing verification", async () => {
    const wrap = makeLegacyDataKeyWrap("user-1", crypto.randomBytes(32));
    wrap.tag = Buffer.from(
      Buffer.from(wrap.tag, "base64url").map((b) => b ^ 0xff),
    ).toString("base64url");
    const token = jwt.sign(
      { userId: "user-1", sessionId: "s1", dataKeyWrap: wrap },
      jwtSecret,
      {
        expiresIn: "1h",
      },
    );

    const payload = await authManager.verifyJWTToken(token);

    expect(payload?.userId).toBe("user-1");
    expect(mocks.adoptRecoveredDEK).not.toHaveBeenCalled();
  });

  it("rejects a signed token with no session behind it", async () => {
    const token = jwt.sign({ userId: "user-1" }, jwtSecret, {
      expiresIn: "1h",
    });
    expect(await authManager.verifyJWTToken(token)).toBeNull();
  });

  it("rejects a token whose session has expired", async () => {
    const token = jwt.sign(
      { userId: "user-1", sessionId: "expired" },
      jwtSecret,
      { expiresIn: "1h" },
    );
    expect(await authManager.verifyJWTToken(token)).toBeNull();
  });

  it("still accepts the sessionless pending second-factor token", async () => {
    const token = jwt.sign({ userId: "user-1", pendingTOTP: true }, jwtSecret, {
      expiresIn: "10m",
    });
    const payload = await authManager.verifyJWTToken(token);
    expect(payload?.pendingTOTP).toBe(true);
  });

  it("issues a one minute socket ticket bound to the session", async () => {
    const ticket = await authManager.issueSocketTicket("user-1", "s1");
    const payload = jwt.decode(ticket) as Record<string, number | string>;

    expect(payload.userId).toBe("user-1");
    expect(payload.sessionId).toBe("s1");
    expect(payload.purpose).toBe("ws");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(60);
  });

  it("only accepts a socket ticket where a socket asks for it", async () => {
    const ticket = await authManager.issueSocketTicket("user-1", "s1");

    expect(await authManager.verifyJWTToken(ticket)).toBeNull();
    const payload = await authManager.verifyJWTToken(ticket, {
      allowSocketTicket: true,
    });
    expect(payload?.userId).toBe("user-1");
  });

  it("gives an API key a ticket on a short session that only a socket takes", async () => {
    mocks.created.length = 0;
    const ticket = await authManager.issueApiKeySocketTicket(
      "user-1",
      "key-12345678",
    );
    const payload = jwt.decode(ticket) as Record<string, number | string>;

    expect(payload.userId).toBe("user-1");
    expect(payload.purpose).toBe("ws");
    expect(Number(payload.exp) - Number(payload.iat)).toBe(60);

    const [session] = mocks.created;
    expect(session.userId).toBe("user-1");
    expect(session.id).toBe(payload.sessionId);
    expect(session.deviceInfo).toBe("api-key: socket key-1234");
    const lifetime =
      new Date(String(session.expiresAt)).getTime() -
      new Date(String(session.createdAt)).getTime();
    expect(lifetime).toBe(120_000);

    expect(await authManager.verifyJWTToken(ticket)).toBeNull();
  });

  it("rejects a socket ticket whose session has expired", async () => {
    const ticket = await authManager.issueSocketTicket("user-1", "expired");
    expect(
      await authManager.verifyJWTToken(ticket, { allowSocketTicket: true }),
    ).toBeNull();
  });

  it("rejects a token with an unknown purpose", async () => {
    const token = jwt.sign(
      { userId: "user-1", sessionId: "s1", purpose: "other" },
      jwtSecret,
      { expiresIn: "1h" },
    );
    expect(
      await authManager.verifyJWTToken(token, { allowSocketTicket: true }),
    ).toBeNull();
  });
});

describe("login policy on sessions", () => {
  const sign = (sessionId: string) =>
    jwt.sign({ userId: "user-1", sessionId }, jwtSecret, { expiresIn: "1h" });

  it("caps the lifetime and stores the idle timeout and restriction", async () => {
    const token = await authManager.generateJWTToken("user-1", {
      rememberMe: true,
      deviceType: "web",
      deviceInfo: "Firefox",
      maxAgeSeconds: 600,
      idleTimeoutSeconds: 300,
      restriction: "second-factor-setup",
    });
    const payload = jwt.decode(token) as { iat: number; exp: number };
    expect(payload.exp - payload.iat).toBe(600);
    expect(mocks.created[0]).toMatchObject({
      idleTimeout: 300,
      restriction: "second-factor-setup",
    });
    const lifetime =
      new Date(mocks.created[0].expiresAt as string).getTime() -
      new Date(mocks.created[0].createdAt as string).getTime();
    expect(lifetime).toBe(600_000);
  });

  it("ends a session idle past its timeout and keeps an active one", async () => {
    expect(await authManager.verifyJWTToken(sign("idle"))).toBeNull();
    expect(mocks.revoke).toHaveBeenCalledWith("idle");
    expect(await authManager.verifyJWTToken(sign("active"))).not.toBeNull();
  });

  it("only lets a setup session reach setup routes", async () => {
    const middleware = authManager.createAuthMiddleware();
    const call = async (url: string) => {
      const res = {
        statusCode: 200,
        body: undefined as unknown,
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
      const next = vi.fn();
      await middleware(
        {
          cookies: { jwt: sign("setup") },
          headers: {},
          originalUrl: url,
          url,
        } as never,
        res as never,
        next,
      );
      return { res, next };
    };

    const blocked = await call("/host/db/host");
    expect(blocked.res.statusCode).toBe(403);
    expect(blocked.res.body).toMatchObject({
      code: "SECOND_FACTOR_SETUP_REQUIRED",
    });
    expect(blocked.next).not.toHaveBeenCalled();

    const me = await call("/users/me");
    expect(me.next).toHaveBeenCalled();
  });

  it("allows second factor plugins' routes and nothing else", () => {
    const dispose = registerSecondFactor({
      id: "key",
      pluginId: "keys",
      labelKey: "key",
      isEnrolled: async () => false,
      verify: async () => true,
    });
    try {
      expect(allowsSetupSession("/plugin-api/keys/register")).toBe(true);
      expect(allowsSetupSession("/plugin-api/other/thing")).toBe(false);
      expect(allowsSetupSession("/users/logout")).toBe(true);
      expect(allowsSetupSession("/users/me/token")).toBe(false);
      expect(allowsSetupSession("/credentials")).toBe(false);
    } finally {
      dispose();
    }
  });
});
