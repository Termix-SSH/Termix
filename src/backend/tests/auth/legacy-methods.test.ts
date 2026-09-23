import { beforeEach, describe, expect, it, vi } from "vitest";
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
  providerConfig: null as unknown,
  providerType: "oidc",
  idTokenClaims: null as unknown,
  ldap: {
    users: {} as Record<
      string,
      { dn: string; password: string; attrs: Record<string, string> }
    >,
    adminDns: [] as string[],
  },
  ssoProvider: { id: 4, type: "ldap", enabled: true },
}));

vi.mock("../../database/repositories/factory.js", async () => {
  const helpers = await import("./auth-test-helpers.js");
  const names = [
    ...Object.keys(helpers.fakeFactory(helpers.createAuthState())),
  ];
  const mocked = Object.fromEntries(
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
  return {
    ...mocked,
    createCurrentSsoProviderRepository: () => ({
      findById: async () => h.ssoProvider,
      listEnabledPublic: async () => [],
    }),
  };
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
vi.mock("../../hosts/automation-events.js", () => ({
  notifyAutomationInternalEvent: vi.fn(),
}));
vi.mock("../../utils/logger.js", () => {
  const log = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  return { authLogger: log, databaseLogger: log, sshLogger: log, logger: log };
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
vi.mock("../../database/routes/user-oidc-utils.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../database/routes/user-oidc-utils.js")
    >();
  return {
    ...actual,
    loadProviderConfig: async () =>
      h.providerConfig
        ? {
            config: h.providerConfig,
            providerType: h.providerType,
            providerDbId: 3,
          }
        : null,
    verifyOIDCToken: async () => h.idTokenClaims,
  };
});
vi.mock("ldapjs", () => {
  function createClient() {
    let bound: string | null = null;
    return {
      bind: (dn: string, password: string, cb: (err?: Error) => void) => {
        if (dn === "cn=service") {
          bound = dn;
          return cb();
        }
        const user = Object.values(h.ldap.users).find((u) => u.dn === dn);
        if (user && user.password === password) {
          bound = dn;
          return cb();
        }
        cb(new Error("invalid credentials"));
      },
      search: (
        base: string,
        options: { filter: string },
        cb: (err: Error | null, res: unknown) => void,
      ) => {
        const listeners: Record<string, (value?: unknown) => void> = {};
        const res = {
          on: (event: string, fn: (value?: unknown) => void) => {
            listeners[event] = fn;
          },
        };
        cb(null, res);
        queueMicrotask(() => {
          if (base === "ou=groups") {
            for (const dn of h.ldap.adminDns) {
              if (options.filter.includes(dn)) {
                listeners.searchEntry?.({
                  dn: { toString: () => "cn=admins,ou=groups" },
                  attributes: [{ type: "cn", values: ["admins"] }],
                });
              }
            }
          } else {
            const match = /uid=([^)]+)/.exec(options.filter);
            const user = match ? h.ldap.users[match[1]] : undefined;
            if (user) {
              listeners.searchEntry?.({
                dn: { toString: () => user.dn },
                attributes: Object.entries(user.attrs).map(([type, value]) => ({
                  type,
                  values: [value],
                })),
              });
            }
          }
          listeners.end?.();
        });
        void bound;
      },
      unbind: () => {},
    };
  }
  return { default: { createClient }, createClient };
});

const { handleOidcCallback } = await import("../../auth/legacy/oidc-login.js");
const { verifyLdapLogin } = await import("../../auth/legacy/ldap-login.js");
const { respondWithLogin, respondWithRedirectLogin, runLogin } =
  await import("../../auth/login-pipeline.js");

beforeEach(() => {
  h.state = createAuthState();
  h.manager = fakeAuthManager(h.state);
  h.providerType = "oidc";
  h.providerConfig = {
    client_id: "client",
    client_secret: "secret",
    issuer_url: "https://idp.example",
    authorization_url: "https://idp.example/auth",
    token_url: "https://idp.example/token",
    identifier_path: "sub",
    name_path: "name",
    scopes: "openid",
    admin_group: "termix-admins",
    group_claim: "groups",
  };
  h.idTokenClaims = {
    sub: "sub-1",
    sid: "sid-1",
    name: "Alice",
    email: "alice@example.com",
    nonce: "nonce-1",
    groups: ["termix-admins"],
  };
  for (const [key, value] of Object.entries({
    oidc_backend_callback_state1: "https://termix.example/users/oidc/callback",
    oidc_frontend_origin_state1: "https://termix.example",
    oidc_remember_me_state1: "false",
    oidc_state_state1: "nonce-1",
    oidc_provider_state1: "3",
  })) {
    h.state.settings.set(key, value);
  }
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url === "https://idp.example/token") {
        return new Response(
          JSON.stringify({ id_token: "jwt", access_token: "at" }),
        );
      }
      return new Response("{}", { status: 404 });
    }),
  );
  h.ldap.users = {
    bob: {
      dn: "uid=bob,ou=people",
      password: "hunter2",
      attrs: { uid: "bob", cn: "Bob Builder", mail: "bob@example.com" },
    },
  };
  h.ldap.adminDns = [];
});

describe("OIDC through the pipeline", () => {
  it("turns the callback into an identity with the old identifier and claims", async () => {
    const identity = await handleOidcCallback(
      fakeRequest({ query: { code: "c", state: "state1" } }) as never,
    );
    expect(identity).toMatchObject({
      kind: "external",
      provider: "3",
      subject: "sub-1",
      legacyIdentifier: "sub-1",
      name: "Alice",
      isAdmin: true,
      oidcSub: "sub-1",
      oidcSid: "sid-1",
      ssoProviderId: 3,
      returnTo: "https://termix.example",
    });
    // The one-time state is consumed.
    expect(h.state.settings.has("oidc_state_state1")).toBe(false);
  });

  it("signs in and redirects with a cookie, like the old callback", async () => {
    const req = fakeRequest({ query: { code: "c", state: "state1" } });
    const identity = await handleOidcCallback(req as never);
    const res = fakeResponse();
    await respondWithRedirectLogin(
      req as never,
      res as never,
      identity,
      { methodId: "oidc", rememberMe: false },
      () => false,
    );
    expect(res.redirectedTo).toBe("https://termix.example/?success=true");
    expect(res.cleared).toContain("jwt");
    expect(res.cookies[0]).toMatchObject({ name: "jwt" });
    const [user] = [...h.state.users.values()];
    expect(user).toMatchObject({ oidcIdentifier: "sub-1", isAdmin: true });
    expect(h.state.audits).toContainEqual(
      expect.objectContaining({ action: "login", userId: user.id }),
    );
  });

  it("rejects a nonce mismatch without a session", async () => {
    h.idTokenClaims = { ...(h.idTokenClaims as object), nonce: "other" };
    await expect(
      handleOidcCallback(
        fakeRequest({ query: { code: "c", state: "state1" } }) as never,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("namespaces GitHub users the way they were stored", async () => {
    h.providerType = "github";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://idp.example/token") {
          return new Response(JSON.stringify({ access_token: "at" }));
        }
        if (url === "https://api.github.com/user") {
          return new Response(JSON.stringify({ id: 42, login: "octo" }));
        }
        return new Response("[]");
      }),
    );
    const identity = await handleOidcCallback(
      fakeRequest({ query: { code: "c", state: "state1" } }) as never,
    );
    expect(identity).toMatchObject({
      provider: "3",
      subject: "42",
      legacyIdentifier: "github:3:42",
      name: "octo",
    });
  });
});

describe("LDAP through the pipeline", () => {
  const providerConfig = {
    host: "ldap.example",
    bindDN: "cn=service",
    bindPassword: "svc",
    userSearchBase: "ou=people",
    userSearchFilter: "(uid={{username}})",
    groupSearchBase: "ou=groups",
    adminGroup: "admins",
  };

  it("binds, finds the user and signs in with the old identifier", async () => {
    h.providerConfig = providerConfig;
    h.ldap.adminDns = ["uid=bob,ou=people"];
    const req = fakeRequest({
      body: { providerId: 4, username: "bob", password: "hunter2" },
      headers: { "x-electron-app": "true" },
    });
    const identity = await verifyLdapLogin({
      body: req.body as never,
      ip: "10.0.0.1",
    });
    expect(identity).toMatchObject({
      provider: "4",
      subject: "bob",
      legacyIdentifier: "ldap:4:bob",
      isAdmin: true,
      name: "Bob Builder",
    });

    const res = fakeResponse();
    await respondWithLogin(req as never, res as never, identity, {
      methodId: "ldap",
      rememberMe: false,
    });
    expect(res.cookies[0]).toMatchObject({ name: "jwt" });
    // Native clients now get the token for LDAP too.
    expect(res.body).toMatchObject({
      success: true,
      token: expect.any(String),
    });
  });

  it("rejects a wrong password", async () => {
    h.providerConfig = providerConfig;
    await expect(
      verifyLdapLogin({
        body: { providerId: 4, username: "bob", password: "wrong" },
        ip: "10.0.0.2",
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  it("skips TOTP for an LDAP user who enrolled when the external-login setting is off", async () => {
    h.providerConfig = providerConfig;
    h.state.users.set("u-bob", {
      id: "u-bob",
      username: "Bob Builder",
      passwordHash: "",
      isAdmin: false,
      isOidc: true,
      oidcIdentifier: "ldap:4:bob",
      totpEnabled: true,
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
    const identity = await verifyLdapLogin({
      body: { providerId: 4, username: "bob", password: "hunter2" },
      ip: "10.0.0.3",
    });
    const result = await runLogin(fakeRequest() as never, identity, {
      methodId: "ldap",
      rememberMe: false,
    });
    expect(result.kind).toBe("session");
  });

  it("runs TOTP for an LDAP user who enrolled when the external-login setting is on", async () => {
    h.providerConfig = providerConfig;
    h.state.settings.set("second_factor_after_external_login", "true");
    h.state.users.set("u-bob", {
      id: "u-bob",
      username: "Bob Builder",
      passwordHash: "",
      isAdmin: false,
      isOidc: true,
      oidcIdentifier: "ldap:4:bob",
      totpEnabled: true,
      totpSecret: "JBSWY3DPEHPK3PXP",
    });
    const identity = await verifyLdapLogin({
      body: { providerId: 4, username: "bob", password: "hunter2" },
      ip: "10.0.0.3",
    });
    const result = await runLogin(fakeRequest() as never, identity, {
      methodId: "ldap",
      rememberMe: false,
    });
    expect(result.kind).toBe("second-factor");
  });
});
