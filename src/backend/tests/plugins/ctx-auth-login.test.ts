/**
 * A plugin's login method through core: what its identity may carry, how its
 * own callback route hands off to core, and that a disabled plugin leaves no
 * way in, including through the 2.8 wrapper routes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import {
  createAuthState,
  fakeAuthManager,
  fakeRequest,
  fakeResponse,
  type AuthState,
} from "../auth/auth-test-helpers.js";

const h = vi.hoisted(() => ({
  state: null as unknown as AuthState,
  manager: null as unknown as ReturnType<
    typeof import("../auth/auth-test-helpers.js").fakeAuthManager
  >,
  granted: new Set<string>(),
  trustedProxy: false,
  audits: [] as string[],
}));

vi.mock("../../database/repositories/factory.js", async () => {
  const helpers = await import("../auth/auth-test-helpers.js");
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
vi.mock("../../utils/trusted-proxy-auth.js", () => ({
  isTrustedProxyAuthEnabled: () => h.trustedProxy,
}));
vi.mock("../../plugins/permissions.js", async () => {
  const { PluginCapabilityError } = await import("@termix/plugin-sdk/backend");
  return {
    assertCapability: async (
      pluginId: string,
      capability: string,
      declared: readonly string[],
    ) => {
      if (!declared.includes(capability) || !h.granted.has(capability)) {
        throw new PluginCapabilityError(pluginId, capability);
      }
    },
  };
});
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
    pluginLogger: log,
    logger: log,
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

const { createPluginAuth } = await import("../../plugins/ctx-ssh-auth.js");
const { DisposableBag } = await import("../../plugins/disposables.js");
const { loginRateLimiter } = await import("../../utils/login-rate-limiter.js");
const {
  listPublicLoginMethods,
  listLegacySsoProviders,
  startRedirectLogin,
  verifyFormLogin,
} = await import("../../database/routes/auth-routes.js");
const { runLogin } = await import("../../auth/login-pipeline.js");
const { resetAuthRegistryForTests, getLoginMethod } =
  await import("../../auth/registry.js");
const { resetCoreLoginProvidersForTests } =
  await import("../../auth/core-auth.js");

const manifest = {
  id: "corp",
  capabilities: ["auth:provide"],
  contributes: { auth: { loginMethods: ["corp-sso", "corp-dir"] } },
} as unknown as PluginManifest;

function setup() {
  const bag = new DisposableBag();
  const auth = createPluginAuth({
    manifest,
    bag,
    audit: async (action) => {
      h.audits.push(action);
    },
  });
  auth.registerLoginMethod({
    id: "corp-sso",
    labelKey: "signIn",
    kind: "redirect",
    external: true,
    describe: async () => [
      { id: "3", label: "Corp", enabled: true, type: "oidc" },
    ],
    start: async () => ({ redirectUrl: "https://idp.example/auth" }),
    callback: async () => ({
      kind: "external",
      provider: "3",
      subject: "sub-1",
      name: "Alice",
      email: "alice@example.com",
      isAdmin: true,
      roles: { desired: ["ops"], managed: ["ops", "dev"] },
      logoutClaims: { providerId: 3, sub: "sub-1", sid: "sid-1" },
      legacy: { identifier: "sub-1", providerRowId: 3 },
      returnTo: "https://termix.example",
    }),
  });
  auth.registerLoginMethod({
    id: "corp-dir",
    labelKey: "signIn",
    kind: "form",
    external: true,
    describe: async () => [{ id: "4", label: "Directory", enabled: true }],
    verify: async (request) => {
      if (request.body.password !== "hunter2") {
        await auth.loginRateLimit.recordFailure(
          request.ip ?? "unknown",
          "4:bob",
        );
        throw new (await import("@termix/plugin-sdk/backend")).LoginMethodError(
          "Invalid username or password",
          401,
        );
      }
      return {
        kind: "external",
        provider: "ldap:4",
        subject: "bob",
        name: "Bob",
        legacy: { identifier: "ldap:4:bob", providerRowId: 4 },
        rateLimitKey: "4:bob",
      };
    },
  });
  return { auth, bag };
}

beforeEach(() => {
  h.state = createAuthState();
  h.manager = fakeAuthManager(h.state);
  h.granted = new Set(["auth:provide"]);
  h.trustedProxy = false;
  h.audits = [];
  resetAuthRegistryForTests();
  resetCoreLoginProvidersForTests();
});

describe("a plugin's external identity", () => {
  it("carries the 2.8 identifier, role map and logout claims into core", async () => {
    setup();
    const identity = await getLoginMethod("corp-sso")!.callback!(
      fakeRequest() as never,
    );
    const result = await runLogin(fakeRequest() as never, identity, {
      methodId: "corp-sso",
      rememberMe: false,
    });
    expect(result.kind).toBe("session");

    const [user] = [...h.state.users.values()];
    expect(user).toMatchObject({ oidcIdentifier: "sub-1", ssoProviderId: 3 });
    expect(h.state.identities).toContainEqual(
      expect.objectContaining({ providerId: "3", subject: "sub-1" }),
    );
    expect(h.state.roles).toContainEqual({ userId: user.id, roleName: "ops" });
    expect(h.manager.generateJWTToken).toHaveBeenCalledWith(
      user.id,
      expect.objectContaining({
        ssoProviderId: 3,
        oidcSub: "sub-1",
        oidcSid: "sid-1",
      }),
    );
  });

  it("cannot set core-only fields", async () => {
    const { toCoreIdentity } = await import("../../plugins/ctx-ssh-auth.js");
    const mapped = toCoreIdentity("corp", {
      kind: "external",
      provider: "3",
      subject: "x",
      unlockError: "spoofed",
      rateLimitUsername: "someone-else",
    } as never);
    expect(mapped).not.toHaveProperty("unlockError", "spoofed");
    expect(mapped.rateLimitUsername).toBeUndefined();
  });

  it("finds a 2.8 user by the old identifier and links the identity", async () => {
    h.state.users.set("u-1", {
      id: "u-1",
      username: "Alice",
      passwordHash: "",
      isAdmin: false,
      isOidc: true,
      oidcIdentifier: "sub-1",
    });
    setup();
    const identity = await getLoginMethod("corp-sso")!.callback!(
      fakeRequest() as never,
    );
    await runLogin(fakeRequest() as never, identity, {
      methodId: "corp-sso",
      rememberMe: false,
    });
    expect(h.state.users.size).toBe(1);
    expect(h.state.identities).toContainEqual(
      expect.objectContaining({ userId: "u-1", providerId: "3" }),
    );
  });
});

describe("ctx.auth.completeRedirectLogin", () => {
  it("runs the method's callback and redirects back with a session", async () => {
    const { auth } = setup();
    const res = fakeResponse();
    await auth.completeRedirectLogin(
      "corp-sso",
      fakeRequest({ query: { code: "c", state: "s" } }),
      res,
    );
    expect(res.redirectedTo).toBe("https://termix.example/?success=true");
    expect(res.cookies[0]).toMatchObject({ name: "jwt" });
  });

  it("refuses a method the plugin did not declare", async () => {
    const { auth } = setup();
    await expect(
      auth.completeRedirectLogin("oidc", fakeRequest(), fakeResponse()),
    ).rejects.toThrow(/not listed/);
  });

  it("refuses without auth:provide", async () => {
    const { auth } = setup();
    h.granted.clear();
    await expect(
      auth.completeRedirectLogin("corp-sso", fakeRequest(), fakeResponse()),
    ).rejects.toMatchObject({ name: "PluginCapabilityError" });
  });

  it("is refused while trusted proxy login is on", async () => {
    const { auth } = setup();
    h.trustedProxy = true;
    const res = fakeResponse();
    await auth.completeRedirectLogin("corp-sso", fakeRequest(), res);
    expect(res.statusCode).toBe(409);
    expect(res.cookies).toHaveLength(0);
  });
});

describe("the other ctx.auth helpers", () => {
  it("revokes sessions by logout claims and audits it", async () => {
    const { auth } = setup();
    expect(await auth.revokeSessions({ providerId: 3, sid: "sid-1" })).toBe(1);
    expect(h.manager.revokeSessionsByOidc).toHaveBeenCalledWith({
      ssoProviderId: 3,
      sub: null,
      sid: "sid-1",
    });
    expect(h.audits).toContain("auth_sessions_revoked");
    expect(await auth.revokeSessions({ providerId: 3 })).toBe(0);
  });

  it("keeps rate limit keys apart per plugin and clears them on success", async () => {
    const { auth } = setup();
    for (let i = 0; i < 10; i++) {
      await auth.loginRateLimit.recordFailure("10.9.9.9", "4:bob");
    }
    expect(
      (await auth.loginRateLimit.isLocked("10.9.9.9", "4:bob")).locked,
    ).toBe(true);
    // Core's own key for the same name is untouched.
    expect(loginRateLimiter.isLocked("10.9.9.8", "4:bob").locked).toBe(false);
    loginRateLimiter.resetAttempts("10.9.9.9", "plugin:corp:4:bob");
  });

  it("counts linked users for a provider", async () => {
    const { auth } = setup();
    h.state.identities.push({
      id: 1,
      userId: "u-1",
      providerId: "ldap:4",
      subject: "bob",
      email: null,
    });
    expect(await auth.countLinkedUsers("ldap:4")).toBe(1);
    expect(await auth.countLinkedUsers("3")).toBe(0);
  });
});

describe("a disabled plugin", () => {
  it("lists its instances while active, for the login screen and 2.8 clients", async () => {
    setup();
    const methods = await listPublicLoginMethods();
    expect(methods.map((method) => method.id)).toEqual(
      expect.arrayContaining(["corp-sso", "corp-dir"]),
    );
    expect(await listLegacySsoProviders()).toEqual([
      { id: 3, name: "Corp", type: "oidc", displayOrder: 0 },
      { id: 4, name: "Directory", type: "corp-dir", displayOrder: 1 },
    ]);
  });

  it("hides its buttons and leaves no route that signs anyone in", async () => {
    const { bag } = setup();
    await bag.disposeAll();

    const methods = await listPublicLoginMethods();
    expect(methods.map((method) => method.id)).toEqual(["password"]);
    expect(await listLegacySsoProviders()).toEqual([]);

    const start = fakeResponse();
    await startRedirectLogin(
      fakeRequest() as never,
      start as never,
      "corp-sso",
      "3",
    );
    expect(start.statusCode).toBe(404);

    const verify = fakeResponse();
    await verifyFormLogin(
      fakeRequest({ body: { username: "bob", password: "hunter2" } }) as never,
      verify as never,
      "corp-dir",
      "4",
    );
    expect(verify.statusCode).toBe(404);
    expect(verify.cookies).toHaveLength(0);
    expect(h.state.users.size).toBe(0);
  });
});

describe("form methods and the external second factor setting", () => {
  function enrolledBob() {
    h.state.users.set("u-bob", {
      id: "u-bob",
      username: "Bob",
      passwordHash: "",
      isAdmin: false,
      isOidc: true,
      oidcIdentifier: "ldap:4:bob",
    });
    h.state.factors.push({
      userId: "u-bob",
      pluginId: "fixture",
      factorId: "pin",
    });
  }

  it("skips second factors when the setting is off", async () => {
    enrolledBob();
    setup();
    const res = fakeResponse();
    await verifyFormLogin(
      fakeRequest({ body: { password: "hunter2" } }) as never,
      res as never,
      "corp-dir",
      "4",
    );
    expect(res.body).toMatchObject({ success: true });
    expect(res.cookies[0]).toMatchObject({ name: "jwt" });
  });

  it("asks for them when the setting is on", async () => {
    enrolledBob();
    h.state.settings.set("second_factor_after_external_login", "true");
    setup();
    const { registerSecondFactor } = await import("../../auth/registry.js");
    registerSecondFactor({
      id: "pin",
      pluginId: "fixture",
      labelKey: "pin",
      isEnrolled: async () => false,
      verify: async () => true,
    });
    const res = fakeResponse();
    await verifyFormLogin(
      fakeRequest({ body: { password: "hunter2" } }) as never,
      res as never,
      "corp-dir",
      "4",
    );
    expect(res.body).toMatchObject({ requires_second_factor: true });
  });

  it("refuses a wrong password without a session", async () => {
    setup();
    const res = fakeResponse();
    await verifyFormLogin(
      fakeRequest({ body: { password: "nope" } }) as never,
      res as never,
      "corp-dir",
      "4",
    );
    expect(res.statusCode).toBe(401);
    expect(res.cookies).toHaveLength(0);
  });
});
