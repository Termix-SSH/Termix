import { describe, it, expect, vi, beforeEach } from "vitest";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";

// The route module imports the db barrel (which has filesystem/crypto side
// effects on import) plus the logger; stub both so importing stays inert.
const updateWhere = vi.fn().mockResolvedValue(undefined);
const updateSet = vi.fn(() => ({ where: updateWhere }));
const dbUpdate = vi.fn(() => ({ set: updateSet }));

vi.mock("../db/index.js", () => ({
  db: {
    update: dbUpdate,
  },
}));

vi.mock("../../utils/logger.js", () => ({
  authLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

const { verifyTotpReauth } = await import("./user-totp-routes.js");

type AnyUser = Parameters<typeof verifyTotpReauth>[0];

const secret = speakeasy.generateSecret({ name: "test" }).base32;

function makeUser(overrides: Partial<AnyUser> = {}): AnyUser {
  return {
    id: "user-1",
    isOidc: false,
    passwordHash: bcrypt.hashSync("correct-horse", 4),
    totpSecret: secret,
    totpBackupCodes: JSON.stringify(["BACKUP01", "BACKUP02"]),
    totpEnabled: true,
    ...overrides,
  } as AnyUser;
}

describe("verifyTotpReauth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("accepts the correct password", async () => {
    expect(await verifyTotpReauth(makeUser(), "correct-horse")).toBe(true);
  });

  it("accepts a valid TOTP code without a password", async () => {
    const token = speakeasy.totp({ secret, encoding: "base32" });
    expect(await verifyTotpReauth(makeUser(), token)).toBe(true);
  });

  it("accepts a valid backup code and consumes it", async () => {
    const result = await verifyTotpReauth(makeUser(), "BACKUP01");
    expect(result).toBe(true);
    expect(updateSet).toHaveBeenCalledWith({
      totpBackupCodes: JSON.stringify(["BACKUP02"]),
    });
  });

  it("rejects a wrong password / invalid code", async () => {
    expect(await verifyTotpReauth(makeUser(), "wrong")).toBe(false);
    expect(updateSet).not.toHaveBeenCalled();
  });

  it("ignores the password path for OIDC users but still accepts TOTP", async () => {
    const token = speakeasy.totp({ secret, encoding: "base32" });
    const oidcUser = makeUser({ isOidc: true, passwordHash: null });
    expect(await verifyTotpReauth(oidcUser, token)).toBe(true);
    expect(await verifyTotpReauth(oidcUser, "anything")).toBe(false);
  });

  it("handles malformed backup-code JSON without throwing", async () => {
    const user = makeUser({ totpBackupCodes: "not json" });
    expect(await verifyTotpReauth(user, "BACKUP01")).toBe(false);
  });
});
