import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response, Router } from "express";
import type { AuthManager } from "../../../utils/auth-manager.js";

const mocks = vi.hoisted(() => ({
  verify: vi.fn(),
  user: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@simplewebauthn/server", () => ({
  generateAuthenticationOptions: vi
    .fn()
    .mockResolvedValue({ challenge: "challenge" }),
  verifyAuthenticationResponse: mocks.verify,
  generateRegistrationOptions: vi.fn(),
  verifyRegistrationResponse: vi.fn(),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({ findById: mocks.user }),
  createCurrentWebauthnCredentialRepository: () => ({
    findByCredentialId: vi.fn().mockResolvedValue({
      id: 1,
      credentialId: "key",
      userId: "user",
      publicKey: "YQ",
      counter: 0,
      transports: "[]",
    }),
    updateAuthState: mocks.update,
  }),
  getCurrentSettingValue: vi.fn(),
}));
vi.mock("../../../utils/logger.js", () => ({ authLogger: { warn: vi.fn() } }));
vi.mock("../../../utils/user-agent-parser.js", () => ({
  parseUserAgent: () => ({ type: "browser", deviceInfo: "test" }),
  generateDeviceFingerprint: () => "device",
  getDeviceId: () => "id",
}));
const { registerUserWebAuthnRoutes } =
  await import("../../../database/routes/user-webauthn-routes.js");
type Handler = (req: Request, res: Response) => Promise<unknown>;
const handlers = new Map<string, Handler>();
const manager = {
  authenticateWebAuthnUser: vi.fn().mockResolvedValue(true),
  isTrustedDevice: vi.fn().mockResolvedValue(false),
  generateJWTToken: vi.fn().mockResolvedValue("token"),
  getSecureCookieOptions: vi.fn().mockReturnValue({ httpOnly: true }),
};
registerUserWebAuthnRoutes(
  {
    post: (path: string, ...callbacks: Handler[]) =>
      handlers.set(path, callbacks.at(-1)!),
    get: vi.fn(),
    delete: vi.fn(),
  } as unknown as Router,
  {
    authenticateJWT: vi.fn(),
    authManager: manager as unknown as AuthManager,
    isNativeAppRequest: () => false,
  },
);
function response() {
  const res = { json: vi.fn(), status: vi.fn(), cookie: vi.fn() };
  res.status.mockReturnValue(res);
  return res;
}
async function login(userVerification: string) {
  const options = response();
  await handlers.get("/webauthn/authenticate/options")!(
    {
      body: { userVerification },
      get: () => "https://termix.test",
    } as unknown as Request,
    options as unknown as Response,
  );
  const challengeId = options.json.mock.calls[0][0].challengeId;
  const res = response();
  await handlers.get("/webauthn/authenticate/verify")!(
    {
      body: { challengeId, response: { id: "key" }, rememberMe: true },
    } as Request,
    res as unknown as Response,
  );
  return res;
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({
    id: "user",
    username: "alice",
    totpEnabled: true,
  });
  manager.isTrustedDevice.mockResolvedValue(false);
  mocks.verify.mockResolvedValue({
    verified: true,
    authenticationInfo: { userVerified: false, newCounter: 1 },
  });
});
describe("WebAuthn second factor policy", () => {
  it.each(["discouraged", "preferred", "required"])(
    "does not let request preference %s bypass TOTP without verified UV",
    async (preference) => {
      const res = await login(preference);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ requires_totp: true, temp_token: "token" }),
      );
      expect(manager.generateJWTToken).toHaveBeenCalledWith("user", {
        pendingTOTP: true,
        expiresIn: "10m",
      });
      expect(res.cookie).not.toHaveBeenCalled();
    },
  );
  it("allows verified user verification to satisfy TOTP", async () => {
    mocks.verify.mockResolvedValue({
      verified: true,
      authenticationInfo: { userVerified: true, newCounter: 1 },
    });
    const res = await login("preferred");
    expect(res.cookie).toHaveBeenCalledWith("jwt", "token", { httpOnly: true });
    expect(manager.isTrustedDevice).not.toHaveBeenCalled();
  });
  it("preserves trusted-device exemption", async () => {
    manager.isTrustedDevice.mockResolvedValue(true);
    const res = await login("discouraged");
    expect(manager.isTrustedDevice).toHaveBeenCalledWith("user", "device");
    expect(res.cookie).toHaveBeenCalled();
  });
  it("never creates a session for an invalid assertion", async () => {
    mocks.verify.mockResolvedValue({ verified: false });
    const res = await login("preferred");
    expect(res.status).toHaveBeenCalledWith(401);
    expect(manager.generateJWTToken).not.toHaveBeenCalled();
    expect(res.cookie).not.toHaveBeenCalled();
  });
  it("allows users without TOTP to log in with a possession-only key", async () => {
    mocks.user.mockResolvedValue({ id: "user", totpEnabled: false });
    expect((await login("discouraged")).cookie).toHaveBeenCalled();
  });
});
