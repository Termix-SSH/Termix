import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  host: null as Record<string, unknown> | null,
  hasAccess: true,
  isAdminBypass: false,
  overrideCredentialId: null as number | null,
  credentials: new Map<string, Record<string, unknown>>(),
  sharedSecret: null as Record<string, unknown> | null,
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostOwnerId: async () => (state.host?.userId as string) ?? null,
    findHostById: async () => (state.host ? { ...state.host } : null),
    findOverrideCredentialId: async () => state.overrideCredentialId,
    findCredentialByIdForUser: async (credentialId: number, userId: string) =>
      state.credentials.get(`${credentialId}:${userId}`) ?? null,
  }),
  createCurrentVaultProfileRepository: () => ({
    findById: async () => null,
  }),
  createCurrentUserRepository: () => ({
    findById: async (userId: string) => ({ id: userId, username: userId }),
  }),
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (params: Record<string, unknown>) => {
    state.auditCalls.push(params);
  },
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async () => ({
        hasAccess: state.hasAccess,
        isAdminBypass: state.isAdminBypass,
      }),
    }),
  },
}));

vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({
      getSecretForUser: async () => state.sharedSecret,
    }),
  },
}));

vi.mock("../../utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { resolveHostById } from "../../hosts/host-resolver.js";

function baseHost(overrides: Record<string, unknown> = {}) {
  return {
    id: 42,
    userId: "owner",
    name: "prod",
    ip: "10.0.0.42",
    port: 22,
    username: "root",
    authType: "password",
    password: "owner-secret",
    key: null,
    keyPassword: null,
    keyType: null,
    credentialId: null,
    vaultProfileId: null,
    sudoPassword: "owner-sudo",
    autostartPassword: "auto-pass",
    autostartKey: null,
    autostartKeyPassword: null,
    jumpHosts: null,
    tunnelConnections: null,
    statsConfig: null,
    terminalConfig: null,
    socks5ProxyChain: null,
    quickActions: null,
    overrideCredentialUsername: false,
    ...overrides,
  };
}

beforeEach(() => {
  state.host = baseHost();
  state.hasAccess = true;
  state.isAdminBypass = false;
  state.overrideCredentialId = null;
  state.credentials.clear();
  state.sharedSecret = null;
  state.auditCalls = [];
});

describe("resolveHostById", () => {
  it("returns null when access is denied", async () => {
    state.hasAccess = false;
    expect(await resolveHostById(42, "stranger")).toBeNull();
  });

  it("resolves the owner's credential on the owner path", async () => {
    // Empty host username so the credential's username is used as fallback.
    state.host = baseHost({
      authType: "credential",
      credentialId: 9,
      username: "",
    });
    state.credentials.set("9:owner", {
      id: 9,
      username: "cred-user",
      authType: "key",
      password: null,
      privateKey: "PRIVATE-KEY",
      key: null,
      keyPassword: "kp",
      keyType: "ssh-ed25519",
      certPublicKey: null,
    });

    const host = (await resolveHostById(42, "owner")) as Record<
      string,
      unknown
    >;
    expect(host.key).toBe("PRIVATE-KEY");
    expect(host.username).toBe("cred-user");
    expect(host.authType).toBe("key");
    expect(host.sudoPassword).toBe("owner-sudo");
  });

  it("uses the share snapshot for a non-owner and strips owner-only secrets", async () => {
    state.host = baseHost({ username: "" });
    state.sharedSecret = {
      username: "shared-user",
      authType: "password",
      password: "shared-pass",
    };

    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.password).toBe("shared-pass");
    expect(host.username).toBe("shared-user");
    expect(host.sudoPassword).toBeNull();
    expect(host.autostartPassword).toBeNull();
  });

  it("prefers the recipient's override credential over the snapshot", async () => {
    state.host = baseHost({ username: "" });
    state.overrideCredentialId = 5;
    state.credentials.set("5:recipient", {
      id: 5,
      username: "my-user",
      authType: "password",
      password: "my-pass",
      privateKey: null,
      key: null,
      keyPassword: null,
      keyType: null,
    });
    state.sharedSecret = {
      username: "shared-user",
      authType: "password",
      password: "shared-pass",
    };

    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.password).toBe("my-pass");
    expect(host.username).toBe("my-user");
  });

  it("denies a non-owner when a secret-bearing host has no snapshot", async () => {
    expect(await resolveHostById(42, "recipient")).toBeNull();
  });

  it("lets a non-owner through on secret-less auth types without a snapshot", async () => {
    state.host = baseHost({ authType: "none", password: null });
    const host = await resolveHostById(42, "recipient");
    expect(host).not.toBeNull();
  });

  it("resolves an admin bypass like the owner, keeping owner-only secrets", async () => {
    state.isAdminBypass = true;
    state.host = baseHost({
      authType: "credential",
      credentialId: 9,
      username: "",
      password: null,
    });
    state.credentials.set("9:owner", {
      id: 9,
      username: "cred-user",
      authType: "key",
      password: null,
      privateKey: "OWNER-PRIVATE-KEY",
      key: null,
      keyPassword: "kp",
      keyType: "ssh-ed25519",
      certPublicKey: null,
    });

    const host = (await resolveHostById(42, "adminUser")) as Record<
      string,
      unknown
    >;
    // Owner credential resolved (not the share snapshot path).
    expect(host.key).toBe("OWNER-PRIVATE-KEY");
    expect(host.username).toBe("cred-user");
    // Owner-only operational secrets are NOT stripped for the admin.
    expect(host.sudoPassword).toBe("owner-sudo");
    expect(host.autostartPassword).toBe("auto-pass");
  });

  it("audits every admin-bypass host resolution", async () => {
    state.isAdminBypass = true;
    await resolveHostById(42, "adminUser");
    expect(state.auditCalls).toHaveLength(1);
    expect(state.auditCalls[0]).toMatchObject({
      action: "admin_connect_host",
      resourceType: "host",
      resourceId: "42",
      userId: "adminUser",
    });
  });

  it("does not audit an ordinary owner resolution", async () => {
    await resolveHostById(42, "owner");
    expect(state.auditCalls).toHaveLength(0);
  });
});
