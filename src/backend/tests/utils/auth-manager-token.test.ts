import crypto from "crypto";
import jwt from "jsonwebtoken";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jwtSecret = "a".repeat(64);
const encryptionKey = crypto.randomBytes(32);

const mocks = vi.hoisted(() => ({
  hasUserDEK: vi.fn(() => false),
  adoptRecoveredDEK: vi.fn(async () => {}),
}));

vi.mock("../../database/db/index.js", () => ({
  db: {},
  getDb: () => ({}),
  saveMemoryDatabaseToFile: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  createCurrentSessionRepository: () => ({}),
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

const { AuthManager } = await import("../../utils/auth-manager.js");
const authManager = AuthManager.getInstance();

function makeLegacyDataKeyWrap(
  userId: string,
  dek: Buffer,
): Record<string, string> {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey, iv);
  cipher.setAAD(Buffer.from(`${userId}:`, "utf8"));
  const data = Buffer.concat([cipher.update(dek), cipher.final()]);
  return {
    version: "v1",
    iv: iv.toString("base64url"),
    tag: cipher.getAuthTag().toString("base64url"),
    data: data.toString("base64url"),
  };
}

beforeEach(() => {
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
      { userId: "user-1", dataKeyWrap: makeLegacyDataKeyWrap("user-1", dek) },
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
    const token = jwt.sign({ userId: "user-1", dataKeyWrap: wrap }, jwtSecret, {
      expiresIn: "1h",
    });

    const payload = await authManager.verifyJWTToken(token);

    expect(payload?.userId).toBe("user-1");
    expect(mocks.adoptRecoveredDEK).not.toHaveBeenCalled();
  });
});
