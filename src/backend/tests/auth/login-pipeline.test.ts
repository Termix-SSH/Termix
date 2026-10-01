import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import {
  createAuthState,
  fakeAuthManager,
  fakeRequest,
  fakeResponse,
  type AuthState,
} from "./auth-test-helpers.js";

const h = vi.hoisted(() => ({
  state: null as unknown as AuthState,
  manager: null as unknown as ReturnType<
    typeof import("./auth-test-helpers.js").fakeAuthManager
  >,
  trustedProxy: false,
}));

vi.mock("../../database/repositories/factory.js", async () => {
  const helpers = await import("./auth-test-helpers.js");
  const names = Object.keys(helpers.fakeFactory(helpers.createAuthState()));
  return Object.fromEntries(
    names.map((name) => [
      name,
      (...args: unknown[]) =>
        (
          helpers.fakeFactory(h.state) as Record<
            string,
            (...a: unknown[]) => unknown
          >
        )[name](...args),
    ]),
  );
});
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => h.manager },
}));
vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    h.state.audits.push(entry);
  },
  getRequestMeta: () => ({ ipAddress: "10.0.0.1", userAgent: "test" }),
}));
vi.mock("../../hosts/internal-events.js", () => ({
  emitInternalEvent: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  return {
    authLogger: log,
    databaseLogger: log,
    sshLogger: log,
    logger: log,
    systemLogger: log,
  };
});
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
}));
vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ invalidateUserPermissionCache: vi.fn() }),
  },
}));
vi.mock("../../utils/trusted-proxy-auth.js", () => ({
  isTrustedProxyAuthEnabled: () => h.trustedProxy,
}));
vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ snapshotForUserRoles: async () => {} }),
  },
}));
vi.mock("../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ snapshotForUserRoles: async () => {} }),
  },
}));

const {
  runLogin,
  respondWithLogin,
  respondWithRedirectLogin,
  verifySecondFactorAndRespond,
  resetPendingLoginsForTests,
} = await import("../../auth/login-pipeline.js");
const { verifyPasswordLogin } =
  await import("../../auth/builtin-login-methods.js");
const { getPasswordLoginStatus } = await import("../../auth/core-auth.js");
const { registerLoginMethod, registerSecondFactor } =
  await import("../../auth/registry.js");
const { loginRateLimiter } = await import("../../utils/login-rate-limiter.js");

const PASSWORD = "correct-horse";
// Stands in for the totp plugin's factor: core only sees the registration.
const TOTP_CODE = "123456";
let disposeTotp: (() => void) | null = null;
function registerTotpFixture() {
  disposeTotp = registerSecondFactor({
    id: "totp",
    pluginId: "totp",
    labelKey: "totp:factor",
    isEnrolled: async () => false,
    verify: async (_userId, body) => body.totp_code === TOTP_CODE,
    reset: async () => {},
  });
}

function addUser(
  overrides: Partial<import("./auth-test-helpers.js").FakeUser> = {},
) {
  const user = {
    id: "u1",
    username: "alice",
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    isAdmin: false,
    isOidc: false,
    ...overrides,
  };
  h.state.users.set(user.id, user);
  return user;
}

beforeEach(() => {
  h.state = createAuthState();
  h.manager = fakeAuthManager(h.state);
  h.trustedProxy = false;
  resetPendingLoginsForTests();
  loginRateLimiter.resetAttempts("10.0.0.1", "alice");
  loginRateLimiter.resetTOTPAttempts("u1");
  delete process.env.ALLOW_PASSWORD_LOGIN;
  disposeTotp?.();
  registerTotpFixture();
});

async function passwordLogin(body: Record<string, unknown>, headers = {}) {
  const req = fakeRequest({ body, headers });
  const res = fakeResponse();
  const identity = await verifyPasswordLogin(req as never);
  await respondWithLogin(req as never, res as never, identity, {
    methodId: "password",
    rememberMe: !!body.rememberMe,
  });
  return res;
}

describe("password login through the pipeline", () => {
  it("issues the same JWT, cookie, audit and body the old route did", async () => {
    addUser({ isAdmin: true });
    const res = await passwordLogin({ username: "alice", password: PASSWORD });

    expect(h.manager.authenticateUser).toHaveBeenCalledWith(
      "u1",
      PASSWORD,
      "web",
    );
    expect(h.manager.generateJWTToken).toHaveBeenCalledWith(
      "u1",
      expect.objectContaining({
        rememberMe: false,
        deviceType: "web",
        deviceInfo: expect.any(String),
      }),
    );
    // Session timeout default: 24 hours.
    expect(res.cookies).toEqual([
      {
        name: "jwt",
        value: "jwt-1",
        options: { httpOnly: true, maxAge: 24 * 60 * 60 * 1000 },
      },
    ]);
    expect(res.body).toMatchObject({
      success: true,
      is_admin: true,
      username: "alice",
    });
    expect(res.body).not.toHaveProperty("token");
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        userId: "u1",
        username: "alice",
        action: "login",
        resourceType: "session",
        success: true,
      }),
    ]);
  });

  it("remembers the session for 30 days and follows session_timeout_hours otherwise", async () => {
    addUser();
    const remembered = await passwordLogin({
      username: "alice",
      password: PASSWORD,
      rememberMe: true,
    });
    expect((remembered.cookies[0].options as { maxAge: number }).maxAge).toBe(
      30 * 24 * 60 * 60 * 1000,
    );

    h.state.settings.set("session_timeout_hours", "2");
    const short = await passwordLogin({
      username: "alice",
      password: PASSWORD,
    });
    expect((short.cookies[0].options as { maxAge: number }).maxAge).toBe(
      2 * 60 * 60 * 1000,
    );
  });

  it("returns the token in the body for the desktop and mobile apps", async () => {
    addUser();
    const res = await passwordLogin(
      { username: "alice", password: PASSWORD },
      { "x-electron-app": "true" },
    );
    expect(res.body).toMatchObject({ token: "jwt-1" });
  });

  it("rejects a wrong password with the old status and message", async () => {
    addUser();
    await expect(
      verifyPasswordLogin(
        fakeRequest({ body: { username: "alice", password: "nope" } }) as never,
      ),
    ).rejects.toMatchObject({
      status: 401,
      message: "Invalid username or password",
    });
    expect(h.state.audits).toEqual([]);
  });

  it("refuses a user whose data key does not open with the password", async () => {
    addUser();
    h.manager.authenticateUser.mockResolvedValueOnce(false);
    const req = fakeRequest({
      body: { username: "alice", password: PASSWORD },
    });
    const identity = await verifyPasswordLogin(req as never);
    await expect(
      runLogin(req as never, identity, {
        methodId: "password",
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ status: 401, message: "Incorrect password" });
  });
});

describe("second factors", () => {
  function enrolTotp() {
    addUser();
    h.state.factors.push({ userId: "u1", pluginId: "totp", factorId: "totp" });
  }

  it("stops for TOTP with the pending token the old route returned", async () => {
    enrolTotp();
    const res = await passwordLogin({ username: "alice", password: PASSWORD });
    expect(res.cookies).toEqual([]);
    expect(res.body).toMatchObject({
      success: true,
      requires_totp: true,
      temp_token: "pending-1",
      rememberMe: false,
      second_factors: [
        expect.objectContaining({ id: "totp", pluginId: "totp" }),
      ],
    });
    expect(h.manager.generateJWTToken).toHaveBeenCalledWith("u1", {
      pendingTOTP: true,
      expiresIn: "10m",
    });
    expect(h.state.audits).toEqual([]);
  });

  it("finishes the login with a valid code and trusts the device when remembered", async () => {
    enrolTotp();
    const first = await passwordLogin({
      username: "alice",
      password: PASSWORD,
    });
    const tempToken = (first.body as { temp_token: string }).temp_token;

    const req = fakeRequest({
      body: {
        temp_token: tempToken,
        totp_code: TOTP_CODE,
        rememberMe: true,
      },
    });
    const res = fakeResponse();
    await verifySecondFactorAndRespond(req as never, res as never, "totp");

    expect(res.statusCode).toBe(200);
    expect(res.cookies[0]).toMatchObject({ name: "jwt" });
    expect(res.body).toMatchObject({
      success: true,
      username: "alice",
      totp_enabled: true,
    });
    expect(h.state.trustedAdded).toHaveLength(1);
    expect(h.state.audits.at(-1)).toMatchObject({ action: "login" });
  });

  it("answers the 2.8 route with the user's first factor when none is named", async () => {
    enrolTotp();
    const first = await passwordLogin({
      username: "alice",
      password: PASSWORD,
    });
    const res = fakeResponse();
    await verifySecondFactorAndRespond(
      fakeRequest({
        body: {
          temp_token: (first.body as { temp_token: string }).temp_token,
          totp_code: TOTP_CODE,
        },
      }) as never,
      res as never,
    );
    expect(res.statusCode).toBe(200);
  });

  it("fails closed for a 2.8 TOTP user while the totp plugin is disabled", async () => {
    enrolTotp();
    disposeTotp?.();
    disposeTotp = null;
    const req = fakeRequest({
      body: { username: "alice", password: PASSWORD },
    });
    const identity = await verifyPasswordLogin(req as never);
    await expect(
      runLogin(req as never, identity, {
        methodId: "password",
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ status: 403, code: "second_factor_unavailable" });
    expect(h.manager.generateJWTToken).not.toHaveBeenCalled();
  });

  it("still stops password login for TOTP when the external-login setting is off", async () => {
    enrolTotp();
    h.state.settings.set("second_factor_after_external_login", "false");
    const res = await passwordLogin({ username: "alice", password: PASSWORD });
    expect(res.body).toMatchObject({ requires_totp: true });
  });

  it("rejects a wrong code without a session", async () => {
    enrolTotp();
    const first = await passwordLogin({
      username: "alice",
      password: PASSWORD,
    });
    const res = fakeResponse();
    await verifySecondFactorAndRespond(
      fakeRequest({
        body: {
          temp_token: (first.body as { temp_token: string }).temp_token,
          totp_code: "000000",
        },
      }) as never,
      res as never,
      "totp",
    );
    expect(res.statusCode).toBe(401);
    expect(res.cookies).toEqual([]);
  });

  it("skips the factor on a trusted device", async () => {
    enrolTotp();
    h.manager.isTrustedDevice.mockResolvedValueOnce(true);
    const res = await passwordLogin({ username: "alice", password: PASSWORD });
    expect(res.cookies[0]).toMatchObject({ name: "jwt" });
  });

  it("fails closed when an enrolled factor's plugin is gone", async () => {
    addUser();
    h.state.factors.push({
      userId: "u1",
      pluginId: "gone",
      factorId: "yubikey",
    });
    const req = fakeRequest({
      body: { username: "alice", password: PASSWORD },
    });
    const identity = await verifyPasswordLogin(req as never);
    await expect(
      runLogin(req as never, identity, {
        methodId: "password",
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ status: 403, code: "second_factor_unavailable" });
    expect(h.manager.generateJWTToken).not.toHaveBeenCalled();
    expect(h.state.audits).toEqual([
      expect.objectContaining({
        action: "login_blocked_second_factor",
        success: false,
      }),
    ]);
  });

  it("runs a plugin's second factor", async () => {
    addUser();
    h.state.factors.push({
      userId: "u1",
      pluginId: "fixture",
      factorId: "pin",
    });
    const dispose = registerSecondFactor({
      id: "pin",
      pluginId: "fixture",
      labelKey: "fixture.pin",
      isEnrolled: async () => true,
      verify: async (_userId, body) => body.pin === "1234",
    });
    try {
      const first = await passwordLogin({
        username: "alice",
        password: PASSWORD,
      });
      expect(first.body).toMatchObject({
        second_factors: [expect.objectContaining({ id: "pin" })],
      });
      const res = fakeResponse();
      await verifySecondFactorAndRespond(
        fakeRequest({
          body: {
            temp_token: (first.body as { temp_token: string }).temp_token,
            pin: "1234",
          },
        }) as never,
        res as never,
        "pin",
      );
      expect(res.statusCode).toBe(200);
    } finally {
      dispose();
    }
  });

  it("lets a method that already proved a factor skip the step", async () => {
    enrolTotp();
    const result = await runLogin(
      fakeRequest() as never,
      { kind: "user", userId: "u1", mfaSatisfied: true },
      { methodId: "passkey", rememberMe: false },
    );
    expect(result.kind).toBe("session");
  });
});

describe("external identities", () => {
  const external = {
    kind: "external" as const,
    provider: "3",
    subject: "sub-1",
    email: "a@example.com",
    name: "Alice",
    legacyIdentifier: "sub-1",
    ssoProviderId: 3,
  };

  // The sso plugin's method, which marks itself external.
  let disposeOidc: () => void = () => {};
  beforeEach(() => {
    disposeOidc = registerLoginMethod({
      id: "oidc",
      pluginId: "sso",
      labelKey: "loginWithSso",
      kind: "redirect",
      external: true,
    });
  });
  afterEach(() => disposeOidc());

  it("provisions the first user as admin and links the identity", async () => {
    const result = await runLogin(fakeRequest() as never, external, {
      methodId: "oidc",
      rememberMe: false,
    });
    expect(result.kind).toBe("session");
    const [user] = [...h.state.users.values()];
    expect(user).toMatchObject({
      username: "Alice",
      isAdmin: true,
      isOidc: true,
    });
    expect(h.state.identities).toEqual([
      expect.objectContaining({
        userId: user.id,
        providerId: "3",
        subject: "sub-1",
      }),
    ]);
    expect(h.state.roles).toContainEqual({
      userId: user.id,
      roleName: "admin",
    });
  });

  it("refuses a new user when provisioning is off, and one outside the allowed list", async () => {
    addUser({ id: "someone", username: "someone" });
    await expect(
      runLogin(fakeRequest() as never, external, {
        methodId: "oidc",
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ code: "registration_disabled" });

    h.state.settings.set("oidc_auto_provision", "true");
    await expect(
      runLogin(
        fakeRequest() as never,
        { ...external, allowedUsers: "@other.org" },
        { methodId: "oidc", rememberMe: false },
      ),
    ).rejects.toMatchObject({ code: "user_not_allowed" });
  });

  it("re-checks the allowed list for existing users", async () => {
    addUser({ id: "u9", username: "Alice", isOidc: true, passwordHash: "" });
    h.state.identities.push({
      id: 1,
      userId: "u9",
      providerId: "3",
      subject: "sub-1",
      email: null,
    });
    await expect(
      runLogin(
        fakeRequest() as never,
        { ...external, allowedUsers: "@other.org" },
        { methodId: "oidc", rememberMe: false },
      ),
    ).rejects.toMatchObject({ code: "user_not_allowed" });
  });

  it("finds an account from before the identity table by its old identifier", async () => {
    addUser({
      id: "old",
      username: "ldap-bob",
      isOidc: true,
      passwordHash: "",
      oidcIdentifier: "ldap:4:bob",
    });
    const result = await runLogin(
      fakeRequest() as never,
      {
        kind: "external",
        provider: "4",
        subject: "bob",
        name: "Bob",
        legacyIdentifier: "ldap:4:bob",
        ssoProviderId: 4,
      },
      { methodId: "ldap", rememberMe: false },
    );
    expect(result.kind).toBe("session");
    expect(h.state.users.size).toBe(1);
    expect(h.state.identities).toEqual([
      expect.objectContaining({
        userId: "old",
        providerId: "4",
        subject: "bob",
      }),
    ]);
  });

  it("keeps admin in step with the provider's admin group", async () => {
    addUser({
      id: "u9",
      username: "Alice",
      isOidc: true,
      passwordHash: "",
      isAdmin: true,
    });
    h.state.identities.push({
      id: 1,
      userId: "u9",
      providerId: "3",
      subject: "sub-1",
      email: null,
    });
    await runLogin(
      fakeRequest() as never,
      { ...external, isAdmin: false },
      { methodId: "oidc", rememberMe: false },
    );
    expect(h.state.users.get("u9")!.isAdmin).toBe(false);
  });

  it("skips enrolled second factors for SSO users when the setting is off", async () => {
    addUser({
      id: "u9",
      username: "Alice",
      isOidc: true,
      passwordHash: "",
    });
    h.state.factors.push({ userId: "u9", pluginId: "totp", factorId: "totp" });
    h.state.identities.push({
      id: 1,
      userId: "u9",
      providerId: "3",
      subject: "sub-1",
      email: null,
    });
    const result = await runLogin(fakeRequest() as never, external, {
      methodId: "oidc",
      rememberMe: false,
    });
    expect(result.kind).toBe("session");
  });

  it("runs enrolled second factors for SSO users when the setting is on", async () => {
    h.state.settings.set("second_factor_after_external_login", "true");
    addUser({
      id: "u9",
      username: "Alice",
      isOidc: true,
      passwordHash: "",
    });
    h.state.factors.push({ userId: "u9", pluginId: "totp", factorId: "totp" });
    h.state.identities.push({
      id: 1,
      userId: "u9",
      providerId: "3",
      subject: "sub-1",
      email: null,
    });
    const result = await runLogin(fakeRequest() as never, external, {
      methodId: "oidc",
      rememberMe: false,
    });
    expect(result.kind).toBe("second-factor");
  });
});

describe("redirect logins", () => {
  const identity = {
    kind: "external" as const,
    provider: "3",
    subject: "sub-1",
    name: "Alice",
    returnTo: "https://termix.example",
    ssoProviderId: 3,
    oidcSub: "sub-1",
    oidcSid: "sid-1",
  };

  it("sets the cookie and redirects with success, carrying the SSO claims", async () => {
    const res = fakeResponse();
    await respondWithRedirectLogin(
      fakeRequest() as never,
      res as never,
      identity,
      { methodId: "oidc", rememberMe: false },
      () => false,
    );
    expect(res.redirectedTo).toBe("https://termix.example/?success=true");
    expect(res.cookies[0]).toMatchObject({ name: "jwt" });
    expect(h.manager.generateJWTToken).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        oidcSub: "sub-1",
        oidcSid: "sid-1",
        ssoProviderId: 3,
      }),
    );
  });

  it("puts the token in the URL for app callbacks", async () => {
    const res = fakeResponse();
    await respondWithRedirectLogin(
      fakeRequest() as never,
      res as never,
      { ...identity, returnTo: "http://localhost:4567/oidc-callback" },
      { methodId: "oidc", rememberMe: false },
      () => true,
    );
    expect(res.redirectedTo).toMatch(/success=true/);
    expect(res.redirectedTo).toMatch(/token=jwt-/);
    expect(res.cookies).toEqual([]);
  });

  it("sends a second-factor step back with a pending cookie", async () => {
    h.state.settings.set("second_factor_after_external_login", "true");
    addUser({
      id: "u9",
      username: "Alice",
      isOidc: true,
      passwordHash: "",
    });
    h.state.factors.push({ userId: "u9", pluginId: "totp", factorId: "totp" });
    h.state.identities.push({
      id: 1,
      userId: "u9",
      providerId: "3",
      subject: "sub-1",
      email: null,
    });
    const res = fakeResponse();
    await respondWithRedirectLogin(
      fakeRequest() as never,
      res as never,
      identity,
      { methodId: "oidc", rememberMe: false },
      () => false,
    );
    expect(res.redirectedTo).toContain("second_factor=1");
    expect(res.redirectedTo).toContain("second_factors=totp");
    expect(res.cookies[0]).toMatchObject({ name: "termix_pending_login" });

    // The pending login keeps the SSO claims for the session.
    const verify = fakeResponse();
    await verifySecondFactorAndRespond(
      fakeRequest({
        cookies: { termix_pending_login: res.cookies[0].value },
        body: {
          totp_code: TOTP_CODE,
        },
      }) as never,
      verify as never,
      "totp",
    );
    expect(verify.statusCode).toBe(200);
    expect(h.manager.generateJWTToken).toHaveBeenLastCalledWith(
      "u9",
      expect.objectContaining({ oidcSid: "sid-1", ssoProviderId: 3 }),
    );
  });

  it("redirects provisioning refusals with the old error codes", async () => {
    addUser({ id: "someone", username: "someone" });
    const res = fakeResponse();
    await respondWithRedirectLogin(
      fakeRequest() as never,
      res as never,
      identity,
      { methodId: "oidc", rememberMe: false },
      () => false,
    );
    expect(res.redirectedTo).toBe(
      "https://termix.example/?error=registration_disabled",
    );
  });
});

describe("lockout guard", () => {
  it("keeps password login on, flagged forced, when nothing else can sign anyone in", async () => {
    h.state.settings.set("allow_password_login", "false");
    expect(await getPasswordLoginStatus()).toEqual({
      allowed: true,
      forced: true,
    });
  });

  it("honours the setting when another method is enabled", async () => {
    h.state.settings.set("allow_password_login", "false");
    const dispose = registerLoginMethod({
      id: "fixture-sso",
      pluginId: "fixture",
      labelKey: "fixture",
      kind: "redirect",
      describe: async () => [{ id: "1", label: "Fixture", enabled: true }],
    });
    try {
      expect(await getPasswordLoginStatus()).toEqual({
        allowed: false,
        forced: false,
      });
      await expect(
        verifyPasswordLogin(
          fakeRequest({
            body: { username: "alice", password: PASSWORD },
          }) as never,
        ),
      ).rejects.toMatchObject({ status: 403 });
    } finally {
      dispose();
    }
  });

  it("counts trusted proxy login as another way in", async () => {
    h.state.settings.set("allow_password_login", "false");
    h.trustedProxy = true;
    expect(await getPasswordLoginStatus()).toEqual({
      allowed: false,
      forced: false,
    });
  });
});
