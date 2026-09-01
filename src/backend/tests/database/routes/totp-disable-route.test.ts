import { beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import speakeasy from "speakeasy";

const userUpdate = vi.fn().mockResolvedValue(null);
const findById = vi.fn();

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({ findById, update: userUpdate }),
  createCurrentTrustedDeviceRepository: () => ({}),
  createCurrentUserSessionRepository: () => ({}),
}));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn().mockResolvedValue(undefined) },
}));

const { registerUserTotpRoutes } =
  await import("../../../database/routes/user-totp-routes.js");

const secret = speakeasy.generateSecret({ name: "test" }).base32;
const PASSWORD = "correct-horse";

/**
 * The disable dialog has one field, labelled "Enter TOTP code or password",
 * and its caller passes that single value as `disableTOTP(input)` — which
 * lands in the `password` argument, leaving `totp_code` undefined.
 *
 * 2.5.1 changed the route to require both, so from then on the first check
 * rejected every attempt regardless of what was typed. Nobody could turn 2FA
 * off, and the client reported it as the generic "Failed to disable 2FA".
 */
describe("POST /totp/disable", () => {
  let handler: (req: unknown, res: unknown) => Promise<void>;

  beforeEach(() => {
    vi.clearAllMocks();

    const routes = new Map<string, (req: unknown, res: unknown) => unknown>();
    const router = {
      post: (path: string, ...rest: unknown[]) => {
        routes.set(path, rest[rest.length - 1] as never);
      },
      get: () => {},
      put: () => {},
      delete: () => {},
    };

    registerUserTotpRoutes(
      router as never,
      {
        authenticateJWT: (() => {}) as never,
        authManager: { getUserDataKey: () => null } as never,
        isNativeAppRequest: () => false,
      } as never,
    );

    handler = routes.get("/totp/disable") as never;
    findById.mockResolvedValue({
      id: "user-1",
      isOidc: false,
      passwordHash: bcrypt.hashSync(PASSWORD, 4),
      totpSecret: secret,
      totpBackupCodes: JSON.stringify(["BACKUP01"]),
      totpEnabled: true,
    });
  });

  function call(body: Record<string, unknown>) {
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      status(code: number) {
        this.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        this.body = payload;
        return this;
      },
    };
    return handler({ userId: "user-1", body }, res).then(() => res);
  }

  it("accepts the TOTP code on its own", async () => {
    // What the dialog sends: one value, in whichever field the client used.
    const res = await call({
      totp_code: speakeasy.totp({ secret, encoding: "base32" }),
    });

    expect(res.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ totpEnabled: false, totpSecret: null }),
    );
  });

  it("accepts the account password on its own", async () => {
    // The single field is labelled "TOTP code or password", and the client
    // passes it as the password argument — this is the exact failing call.
    const res = await call({ password: PASSWORD });

    expect(res.statusCode).toBe(200);
    expect(userUpdate).toHaveBeenCalled();
  });

  it("accepts a backup code", async () => {
    const res = await call({ totp_code: "BACKUP01" });

    expect(res.statusCode).toBe(200);
  });

  it("still refuses a wrong value", async () => {
    const res = await call({ password: "not-my-password" });

    expect(res.statusCode).toBe(401);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("refuses an empty request rather than disabling anything", async () => {
    const res = await call({});

    expect(res.statusCode).toBe(400);
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("does not let an OIDC user disable it with a password", async () => {
    // No password to compare against; only a TOTP or backup code will do.
    findById.mockResolvedValue({
      id: "user-1",
      isOidc: true,
      passwordHash: null,
      totpSecret: secret,
      totpBackupCodes: JSON.stringify([]),
      totpEnabled: true,
    });

    const res = await call({ password: "anything" });

    expect(res.statusCode).toBe(401);
    expect(userUpdate).not.toHaveBeenCalled();
  });
});
