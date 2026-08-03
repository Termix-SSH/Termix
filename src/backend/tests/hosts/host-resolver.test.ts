import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  host: null as Record<string, unknown> | null,
  hasAccess: true,
  isAdminBypass: false,
  overrideCredentialId: null as number | null,
  credentials: new Map<string, Record<string, unknown>>(),
  vaultProfile: null as Record<string, unknown> | null,
  auditCalls: [] as Record<string, unknown>[],
  folderCredentialId: null as number | null,
  sharedSecret: null as Record<string, unknown> | null,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostOwnerId: async () => (state.host?.userId as string) ?? null,
    findHostById: async () => (state.host ? { ...state.host } : null),
    findCredentialByIdForUser: async (credentialId: number, userId: string) =>
      state.credentials.get(`${credentialId}:${userId}`) ?? null,
    findFolderCredentialId: async () => state.folderCredentialId,
  }),
  createCurrentSharedHostAuthOverrideRepository: () => ({
    findCredentialId: async () => state.overrideCredentialId,
  }),
  createCurrentVaultProfileRepository: () => ({
    findById: async () => state.vaultProfile,
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
    shareSshAuth: false,
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
  state.vaultProfile = null;
  state.auditCalls = [];
  state.folderCredentialId = null;
  state.sharedSecret = null;
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

  it("falls back to the host's folder-assigned credential when none is set on the host", async () => {
    state.host = baseHost({
      authType: "credential",
      credentialId: null,
      folder: "switches",
      username: "",
      password: null,
    });
    state.folderCredentialId = 11;
    state.credentials.set("11:owner", {
      id: 11,
      username: "folder-user",
      authType: "password",
      password: "folder-pass",
      privateKey: null,
      key: null,
      keyPassword: null,
      keyType: null,
    });

    const host = (await resolveHostById(42, "owner")) as Record<
      string,
      unknown
    >;
    expect(host.password).toBe("folder-pass");
    expect(host.username).toBe("folder-user");
    expect(host.authType).toBe("password");
  });

  it("prefers the host's own credential over its folder's credential", async () => {
    state.host = baseHost({
      authType: "credential",
      credentialId: 9,
      folder: "switches",
      username: "",
      password: null,
    });
    state.folderCredentialId = 11;
    state.credentials.set("9:owner", {
      id: 9,
      username: "host-user",
      authType: "password",
      password: "host-pass",
      privateKey: null,
      key: null,
      keyPassword: null,
      keyType: null,
    });

    const host = (await resolveHostById(42, "owner")) as Record<
      string,
      unknown
    >;
    expect(host.username).toBe("host-user");
    expect(host.password).toBe("host-pass");
  });

  it("does not expose the owner's secret-backed SSH authentication", async () => {
    expect(await resolveHostById(42, "recipient")).toBeNull();
  });

  it("uses the owner-provided SSH snapshot when sharing is enabled", async () => {
    state.host = baseHost({ shareSshAuth: true, username: "host-user" });
    state.sharedSecret = {
      username: "shared-user",
      authType: "password",
      password: "shared-pass",
    };

    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.username).toBe("host-user");
    expect(host.password).toBe("shared-pass");
    expect(host.authType).toBe("password");
  });

  it("denies shared secret-backed auth when the opted-in snapshot is missing", async () => {
    state.host = baseHost({ shareSshAuth: true });
    expect(await resolveHostById(42, "recipient")).toBeNull();
  });

  it("keeps SSH agent authentication private unless the owner opts in", async () => {
    state.host = baseHost({
      authType: "agent",
      password: null,
      terminalConfig: JSON.stringify({
        agentSocketPath: "/run/user/1000/ssh-agent.sock",
      }),
    });

    expect(await resolveHostById(42, "recipient")).toBeNull();
  });

  it("allows SSH agent authentication after the owner explicitly opts in", async () => {
    state.host = baseHost({
      authType: "agent",
      password: null,
      shareSshAuth: true,
      terminalConfig: JSON.stringify({
        agentSocketPath: "/run/user/1000/ssh-agent.sock",
      }),
    });

    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.authType).toBe("agent");
    expect(host.terminalConfig).toEqual({
      agentSocketPath: "/run/user/1000/ssh-agent.sock",
      sudoPassword: null,
    });
  });

  it("uses the recipient's credential instead of the owner's authentication", async () => {
    state.host = baseHost({ username: "", shareSshAuth: true });
    state.sharedSecret = {
      username: "shared-user",
      authType: "password",
      password: "shared-pass",
    };
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

    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.password).toBe("my-pass");
    expect(host.username).toBe("my-user");
  });

  it("uses the recipient credential username even when the owner forces their own credential username", async () => {
    state.host = baseHost({
      username: "owner-login",
      overrideCredentialUsername: true,
    });
    state.overrideCredentialId = 5;
    state.credentials.set("5:recipient", {
      id: 5,
      username: "recipient-login",
      authType: "key",
      password: null,
      privateKey: "RECIPIENT-KEY",
      key: null,
      keyPassword: null,
      keyType: "ssh-ed25519",
    });

    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.username).toBe("recipient-login");
    expect(host.authType).toBe("key");
    expect(host.key).toBe("RECIPIENT-KEY");
  });

  it("fully replaces Vault authentication with the recipient override", async () => {
    state.host = baseHost({
      authType: "vault",
      password: null,
      vaultProfileId: 7,
    });
    state.vaultProfile = { id: 7 };
    state.overrideCredentialId = 5;
    state.credentials.set("5:recipient", {
      id: 5,
      username: "recipient-login",
      authType: "key",
      password: null,
      privateKey: "RECIPIENT-KEY",
      key: null,
      keyPassword: null,
      keyType: "ssh-ed25519",
      certPublicKey: "ssh-ed25519-cert-v01@example certificate",
    });

    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.authType).toBe("key");
    expect(host.key).toBe("RECIPIENT-KEY");
    expect(host.certPublicKey).toBe("ssh-ed25519-cert-v01@example certificate");
    expect(host.vaultProfile).toBeUndefined();
  });

  it("falls back to the host username when the override credential has none", async () => {
    state.host = baseHost({ username: "shared-login" });
    state.overrideCredentialId = 5;
    state.credentials.set("5:recipient", {
      id: 5,
      username: null,
      authType: "password",
      password: "my-pass",
      privateKey: null,
      key: null,
      keyPassword: null,
      keyType: null,
    });

    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.username).toBe("shared-login");
  });

  it("denies a non-owner when a secret-bearing host has no personal credential", async () => {
    expect(await resolveHostById(42, "recipient")).toBeNull();
  });

  it("ignores a stored override when shared access is inactive", async () => {
    state.hasAccess = false;
    state.overrideCredentialId = 5;
    state.credentials.set("5:recipient", {
      id: 5,
      username: "recipient",
      authType: "password",
      password: "my-pass",
    });

    expect(await resolveHostById(42, "recipient")).toBeNull();
  });

  it("lets a non-owner through on secret-less auth types without a snapshot", async () => {
    state.host = baseHost({
      authType: "none",
      password: "stale-owner-password",
      key: "stale-owner-key",
      credentialId: null,
      terminalConfig: JSON.stringify({
        theme: "termix",
        sudoPassword: "owner-sudo",
      }),
    });
    const host = (await resolveHostById(42, "recipient")) as Record<
      string,
      unknown
    >;
    expect(host.password).toBeNull();
    expect(host.key).toBeNull();
    expect(host.credentialId).toBeNull();
    expect(host.terminalConfig).toEqual({
      theme: "termix",
      sudoPassword: null,
    });
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

  it("parses an empty port_knock_sequence '[]' string into an empty array (no bogus knock)", async () => {
    state.host = baseHost({ portKnockSequence: "[]" });
    const host = (await resolveHostById(42, "owner")) as Record<
      string,
      unknown
    >;
    expect(host.portKnockSequence).toEqual([]);
  });

  it("parses a real port_knock_sequence JSON string into an array", async () => {
    state.host = baseHost({
      portKnockSequence: '[{"port":1234,"protocol":"tcp","delay":100}]',
    });
    const host = (await resolveHostById(42, "owner")) as Record<
      string,
      unknown
    >;
    expect(host.portKnockSequence).toEqual([
      { port: 1234, protocol: "tcp", delay: 100 },
    ]);
  });
});
