/**
 * Auth: second factors fail closed, the public login list leaks nothing,
 * external sign-in cannot claim someone else's account or username, and the
 * lockout guard keeps password login on when nothing else can sign anyone in.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import bcrypt from "bcryptjs";
import {
  createAuthState,
  fakeAuthManager,
  fakeRequest,
  type AuthState,
} from "../../auth/auth-test-helpers.js";

const h = vi.hoisted(() => ({
  state: null as unknown as AuthState,
  manager: null as unknown as ReturnType<
    typeof import("../../auth/auth-test-helpers.js").fakeAuthManager
  >,
  trustedProxy: false,
}));

vi.mock("../../../database/repositories/factory.js", async () => {
  const helpers = await import("../../auth/auth-test-helpers.js");
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
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => h.manager },
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    h.state.audits.push(entry);
  },
  getRequestMeta: () => ({ ipAddress: "10.0.0.1", userAgent: "test" }),
}));
vi.mock("../../../hosts/internal-events.js", () => ({
  emitInternalEvent: vi.fn(),
}));
vi.mock("../../../utils/logger.js", () => {
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
vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({ invalidateUserPermissionCache: vi.fn() }),
  },
}));
vi.mock("../../../utils/trusted-proxy-auth.js", () => ({
  isTrustedProxyAuthEnabled: () => h.trustedProxy,
}));
vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ snapshotForUserRoles: async () => {} }),
  },
}));
vi.mock("../../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ snapshotForUserRoles: async () => {} }),
  },
}));

const { runLogin, resetPendingLoginsForTests } =
  await import("../../../auth/login-pipeline.js");
const { verifyPasswordLogin } =
  await import("../../../auth/builtin-login-methods.js");
const { getPasswordLoginStatus } = await import("../../../auth/core-auth.js");
const { registerLoginMethod, registerSecondFactor } =
  await import("../../../auth/registry.js");
const { listPublicLoginMethods } =
  await import("../../../database/routes/auth-routes.js");
const { loginRateLimiter } =
  await import("../../../utils/login-rate-limiter.js");

const PASSWORD = "correct-horse";

function addUser(overrides: Record<string, unknown> = {}) {
  const user = {
    id: "u1",
    username: "alice",
    passwordHash: bcrypt.hashSync(PASSWORD, 4),
    isAdmin: false,
    isOidc: false,
    ...overrides,
  };
  h.state.users.set(user.id as string, user as never);
  return user;
}

async function passwordIdentity() {
  const req = fakeRequest({ body: { username: "alice", password: PASSWORD } });
  return { req, identity: await verifyPasswordLogin(req as never) };
}

const disposers: Array<() => void> = [];

beforeEach(() => {
  h.state = createAuthState();
  h.manager = fakeAuthManager(h.state);
  h.trustedProxy = false;
  resetPendingLoginsForTests();
  loginRateLimiter.resetAttempts("10.0.0.1", "alice");
  delete process.env.ALLOW_PASSWORD_LOGIN;
});

afterEach(() => {
  while (disposers.length) disposers.pop()?.();
});

describe("second factors fail closed", () => {
  it("refuses the login when a factor cannot say whether the user is enrolled", async () => {
    addUser();
    disposers.push(
      registerSecondFactor({
        id: "flaky",
        pluginId: "fixture",
        labelKey: "k",
        isEnrolled: async () => {
          throw new Error("database is locked");
        },
        verify: async () => true,
      }),
    );
    const { req, identity } = await passwordIdentity();
    await expect(
      runLogin(req as never, identity, {
        methodId: "password",
        rememberMe: false,
      }),
    ).rejects.toMatchObject({ status: 403 });
    expect(h.manager.generateJWTToken).not.toHaveBeenCalled();
  });
});

describe("the public login list", () => {
  it("names methods and enabled instances, and nothing else", async () => {
    disposers.push(
      registerLoginMethod({
        id: "corp-sso",
        pluginId: "fixture",
        labelKey: "k",
        kind: "redirect",
        external: true,
        describe: async () =>
          [
            {
              id: "1",
              label: "Corp",
              enabled: true,
              clientSecret: "shh",
              issuerUrl: "https://idp.internal",
            },
            { id: "2", label: "Old", enabled: false },
          ] as never,
      }),
    );
    const methods = await listPublicLoginMethods();
    const sso = methods.find((method) => method.id === "corp-sso");
    expect(sso?.instances).toEqual([{ id: "1", label: "Corp" }]);
    expect(JSON.stringify(methods)).not.toMatch(/shh|idp\.internal/);
  });
});

describe("external sign-in cannot claim another account", () => {
  const external = {
    kind: "external" as const,
    provider: "3",
    subject: "sub-1",
    email: null,
    name: "Alice",
    legacyIdentifier: "shared-id",
    ssoProviderId: 3,
  };

  beforeEach(() => {
    disposers.push(
      registerLoginMethod({
        id: "oidc",
        pluginId: "sso",
        labelKey: "k",
        kind: "redirect",
        external: true,
      }),
    );
    h.state.settings.set("oidc_auto_provision", "true");
  });

  async function signIn(identity: Record<string, unknown> = external) {
    return runLogin(fakeRequest() as never, identity as never, {
      methodId: "oidc",
      rememberMe: false,
    });
  }

  function linkedTo(): string | undefined {
    return h.state.identities.find((row) => row.subject === "sub-1")?.userId;
  }

  it("never links a local password account by its old identifier", async () => {
    addUser({ id: "local", oidcIdentifier: "shared-id", isOidc: false });
    await signIn();
    expect(linkedTo()).not.toBe("local");
  });

  it("never links an account that already has an identity", async () => {
    addUser({
      id: "taken",
      username: "bob",
      passwordHash: "",
      isOidc: true,
      oidcIdentifier: "shared-id",
    });
    h.state.identities.push({
      id: 1,
      userId: "taken",
      providerId: "9",
      subject: "bob",
      email: null,
    });
    await signIn();
    expect(linkedTo()).not.toBe("taken");
  });

  it("never links an account from a different provider", async () => {
    addUser({
      id: "other",
      username: "bob",
      passwordHash: "",
      isOidc: true,
      oidcIdentifier: "shared-id",
      ssoProviderId: 7,
    });
    await signIn();
    expect(linkedTo()).not.toBe("other");
  });

  it("still links a genuine 2.8 account on its first sign-in", async () => {
    addUser({
      id: "legacy",
      username: "Alice",
      passwordHash: "",
      isOidc: true,
      oidcIdentifier: "shared-id",
      ssoProviderId: 3,
    });
    await signIn();
    expect(linkedTo()).toBe("legacy");
  });

  it("never gives a new account a local user's username", async () => {
    addUser({ id: "admin-local", username: "admin" });
    await signIn({ ...external, name: "admin", legacyIdentifier: undefined });
    const created = [...h.state.users.values()].find(
      (user) => user.id !== "admin-local",
    );
    expect(created?.username).not.toBe("admin");
    expect(created?.username).toMatch(/^admin-/);
  });

  it("never renames an existing account onto a local user's username", async () => {
    addUser({ id: "admin-local", username: "admin" });
    addUser({
      id: "sso-user",
      username: "carol",
      passwordHash: "",
      isOidc: true,
    });
    h.state.identities.push({
      id: 1,
      userId: "sso-user",
      providerId: "3",
      subject: "sub-1",
      email: null,
    });
    await signIn({ ...external, name: "admin" });
    expect(h.state.users.get("sso-user")?.username).toBe("carol");
  });
});

describe("the lockout guard", () => {
  it("keeps password login on when it is off and nothing else can sign in", async () => {
    process.env.ALLOW_PASSWORD_LOGIN = "false";
    await expect(getPasswordLoginStatus()).resolves.toEqual({
      allowed: true,
      forced: true,
    });
  });

  it("lets it go off once another method has an enabled instance", async () => {
    process.env.ALLOW_PASSWORD_LOGIN = "false";
    disposers.push(
      registerLoginMethod({
        id: "corp-sso",
        pluginId: "fixture",
        labelKey: "k",
        kind: "redirect",
        describe: async () => [{ id: "1", label: "Corp", enabled: true }],
      }),
    );
    await expect(getPasswordLoginStatus()).resolves.toEqual({
      allowed: false,
      forced: false,
    });
  });

  it("does not count a method whose instances are all off", async () => {
    process.env.ALLOW_PASSWORD_LOGIN = "false";
    disposers.push(
      registerLoginMethod({
        id: "corp-sso",
        pluginId: "fixture",
        labelKey: "k",
        kind: "redirect",
        describe: async () => [{ id: "1", label: "Corp", enabled: false }],
      }),
    );
    await expect(getPasswordLoginStatus()).resolves.toMatchObject({
      allowed: true,
      forced: true,
    });
  });
});
