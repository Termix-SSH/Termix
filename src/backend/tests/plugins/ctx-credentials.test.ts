/**
 * ctx.credentials.resolveHostProtocol: credentials:read is checked and every
 * call audited, the owner gets their stored or credential-mode login, and a
 * shared recipient only ever sees what core's sharing rules hand them.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const grants = new Map<string, string[]>();
const auditEntries: Array<Record<string, unknown>> = [];

const state = vi.hoisted(() => ({
  hosts: new Map<number, Record<string, unknown>>(),
  credentials: new Map<number, { username: string; password: string }>(),
  canConnect: true,
  resolution: null as Record<string, unknown> | null,
  resolverCalls: [] as Array<Record<string, unknown>>,
  savedCredentials: [] as Array<Record<string, unknown>>,
  userCredentials: new Map<string, Array<Record<string, unknown>>>(),
  corePermissions: new Set<string>(["credentials.view", "credentials.create"]),
  logins: new Map<string, Record<string, unknown>>(),
  ownerDecrypts: 0,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginPermissionGrantRepository: () => ({
    listByPlugin: async (pluginId: string) =>
      (grants.get(pluginId) ?? []).map((capability) => ({
        pluginId,
        capability,
      })),
  }),
  createCurrentCredentialRepository: () => ({
    listDecryptedByUserId: async (userId: string) =>
      state.userCredentials.get(userId) ?? [],
    createEncryptedForUser: async (
      userId: string,
      data: Record<string, unknown>,
    ) => {
      const row = { ...data, id: 100 + state.savedCredentials.length, userId };
      state.savedCredentials.push(row);
      return row;
    },
  }),
  createCurrentHostProtocolAuthRepository: () => ({
    find: async (hostId: number, protocol: string) => {
      state.ownerDecrypts++;
      return state.logins.get(`${hostId}:${protocol}`) ?? null;
    },
    findRow: async (hostId: number, protocol: string) => {
      const login = state.logins.get(`${hostId}:${protocol}`);
      return login
        ? {
            hostId,
            protocol,
            authType: login.authType,
            credentialId: login.credentialId ?? null,
            username: login.username ?? null,
            password: "sealed",
            fields: JSON.stringify(login.fields ?? {}),
            secretFields: "sealed",
          }
        : null;
    },
  }),
  createCurrentSharedHostAuthOverrideRepository: () => ({
    listCredentialIds: async () => ({}),
  }),
  createCurrentHostResolutionRepository: () => ({
    findHostOwnerId: async (hostId: number) =>
      (state.hosts.get(hostId)?.userId as string) ?? null,
    findHostById: async (hostId: number) => state.hosts.get(hostId) ?? null,
    findCredentialByIdForUser: async (id: number) =>
      state.credentials.get(id) ?? null,
  }),
}));

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    validateUserAccess: () => Buffer.alloc(32),
    getUserDataKey: () => Buffer.alloc(32),
  },
}));

vi.mock("../../hosts/usable-credential.js", () => ({
  findUsableCredential: async (id: number) => state.credentials.get(id) ?? null,
}));

vi.mock("../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    auditEntries.push(entry);
  },
}));

vi.mock("../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async () => ({ hasAccess: state.canConnect }),
      hasPermission: async (_userId: string, permission: string) =>
        state.corePermissions.has(permission),
    }),
  },
}));

vi.mock("../../utils/shared-host-auth-resolver.js", () => ({
  resolveRecipientSharedHostAuthentication: async (
    host: Record<string, unknown>,
  ) => {
    state.resolverCalls.push(host);
    return state.resolution;
  },
}));

import { createPluginContext, createPluginHandle } from "../../plugins/ctx.js";
import { invalidatePluginPermissionCache } from "../../plugins/permissions.js";
import { runAsActor } from "../../plugins/actor.js";
import {
  getSecretResolver,
  requireSecretResolver,
  resetSecretResolverRegistryForTests,
} from "../../hosts/connect/secret-resolver-registry.js";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";
import ssh2 from "ssh2";
import { setHostProtocolSource } from "../../hosts/protocol-auth/registry.js";

const SPICE = {
  id: "spice",
  credentialFields: [{ key: "display" }, { key: "ticket", secret: true }],
  hostLoginFallback: ["password" as const],
};

function contextFor(
  capabilities: string[],
  contributes?: PluginManifest["contributes"],
) {
  const manifest = {
    id: "demo",
    name: "demo",
    version: "1.0.0",
    description: "",
    author: { name: "test" },
    license: "MIT",
    category: "Productivity",
    engine: { termix: ">=2.9.0", api: "1" },
    capabilities,
    contributes,
  } as PluginManifest;
  const handle = createPluginHandle("demo", { activate: () => {} });
  return createPluginContext(manifest, handle);
}

const baseHost = {
  id: 7,
  userId: "owner",
  name: "Win box",
  ip: "10.0.0.7",
  port: 22,
  username: "sshuser",
  password: "ssh-secret",
  jumpHosts: JSON.stringify([{ hostId: 3 }]),
};

/** The demo plugin declares SPICE; nothing in core knows it. */
function spiceContext(capabilities: string[]) {
  return contextFor(capabilities, { protocols: [SPICE] });
}

beforeEach(() => {
  grants.clear();
  auditEntries.length = 0;
  invalidatePluginPermissionCache();
  state.hosts.clear();
  state.credentials.clear();
  state.canConnect = true;
  state.resolution = null;
  state.resolverCalls.length = 0;
  state.savedCredentials.length = 0;
  state.userCredentials.clear();
  state.corePermissions = new Set(["credentials.view", "credentials.create"]);
  state.hosts.set(7, { ...baseHost });
  state.logins.clear();
  state.ownerDecrypts = 0;
  state.logins.set("7:spice", {
    protocol: "spice",
    authType: "direct",
    credentialId: null,
    username: "admin",
    password: "spice-secret",
    fields: { display: "2" },
    secretFields: { ticket: "t-123" },
  });
  setHostProtocolSource(() => [
    { ...SPICE, pluginId: "demo", pluginName: "demo" },
    { id: "rival", pluginId: "other", pluginName: "other" },
  ]);
  resetSecretResolverRegistryForTests();
});

describe("ctx.credentials.resolveHostProtocol", () => {
  it("refuses without credentials:read and audits the refusal", async () => {
    grants.set("demo", []);
    const ctx = spiceContext([]);

    await expect(
      runAsActor("owner", "request", () =>
        ctx.credentials.resolveHostProtocol(7, "spice"),
      ),
    ).rejects.toThrow(/credentials:read/);
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_credentials_read",
      success: false,
    });
  });

  it("refuses a protocol the plugin does not declare, or another plugin owns", async () => {
    grants.set("demo", ["credentials:read"]);
    const ctx = contextFor(["credentials:read"], {
      protocols: [SPICE, { id: "rival" }],
    });

    await expect(
      runAsActor("owner", "request", () =>
        ctx.credentials.resolveHostProtocol(7, "vnc"),
      ),
    ).rejects.toThrow(/does not declare/);
    await expect(
      runAsActor("owner", "request", () =>
        ctx.credentials.resolveHostProtocol(7, "rival"),
      ),
    ).rejects.toThrow(/does not declare/);
    expect(state.ownerDecrypts).toBe(0);
  });

  it("returns the owner's stored login and audits it", async () => {
    grants.set("demo", ["credentials:read"]);
    const ctx = spiceContext(["credentials:read"]);

    const target = await runAsActor("owner", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "spice"),
    );
    expect(target).toEqual({
      host: {
        id: 7,
        name: "Win box",
        ip: "10.0.0.7",
        port: 22,
        ownerUserId: "owner",
        jumpHosts: [{ hostId: 3 }],
      },
      shared: false,
      auth: {
        authType: "direct",
        username: "admin",
        password: "spice-secret",
        fields: { display: "2", ticket: "t-123" },
      },
    });
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_credentials_read",
      success: true,
    });
  });

  it("falls back to the host's own password as declared", async () => {
    grants.set("demo", ["credentials:read"]);
    state.logins.set("7:spice", {
      protocol: "spice",
      authType: "direct",
      credentialId: null,
      username: null,
      password: null,
      fields: {},
      secretFields: {},
    });
    const ctx = spiceContext(["credentials:read"]);

    const target = await runAsActor("owner", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "spice"),
    );
    expect(target?.auth).toEqual({
      authType: "direct",
      username: "",
      password: "ssh-secret",
      fields: { display: "", ticket: "" },
    });
  });

  it("uses the stored credential in credential mode", async () => {
    grants.set("demo", ["credentials:read"]);
    state.logins.set("7:spice", {
      protocol: "spice",
      authType: "credential",
      credentialId: 11,
      username: null,
      password: null,
      fields: { display: "1" },
      secretFields: {},
    });
    state.credentials.set(11, { username: "viewer", password: "cred-pass" });
    const ctx = spiceContext(["credentials:read"]);

    const target = await runAsActor("owner", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "spice"),
    );
    expect(target?.auth).toMatchObject({
      authType: "credential",
      username: "viewer",
      password: "cred-pass",
      fields: { display: "1" },
    });
  });

  it("never hands a shared recipient the owner's raw secrets", async () => {
    grants.set("demo", ["credentials:read"]);
    state.resolution = {
      source: "owner-shared",
      authType: "direct",
      secret: {
        username: "shared",
        password: "snap",
        fields: { ticket: "snap-ticket" },
      },
    };
    const ctx = spiceContext(["credentials:read"]);

    const target = await runAsActor("guest", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "spice"),
    );
    expect(target?.shared).toBe(true);
    expect(target?.auth).toEqual({
      authType: "direct",
      username: "shared",
      password: "snap",
      fields: { display: "2", ticket: "snap-ticket" },
    });
    expect(state.resolverCalls[0]).toMatchObject({ password: null });
    // The owner's login is never decrypted for a recipient.
    expect(state.ownerDecrypts).toBe(0);
  });

  it("gives a recipient with nothing shared an empty login", async () => {
    grants.set("demo", ["credentials:read"]);
    state.resolution = { source: "required" };
    const ctx = spiceContext(["credentials:read"]);

    const target = await runAsActor("guest", "request", () =>
      ctx.credentials.resolveHostProtocol(7, "spice"),
    );
    expect(target?.auth.username).toBe("");
    expect(target?.auth.password).toBe("");
    expect(target?.auth.fields.ticket).toBe("");
    expect(state.ownerDecrypts).toBe(0);
  });

  it("returns null without connect access or for a missing host", async () => {
    grants.set("demo", ["credentials:read"]);
    state.canConnect = false;
    const ctx = spiceContext(["credentials:read"]);

    await expect(
      runAsActor("guest", "request", () =>
        ctx.credentials.resolveHostProtocol(7, "spice"),
      ),
    ).resolves.toBeNull();
    await expect(
      runAsActor("owner", "request", () =>
        ctx.credentials.resolveHostProtocol(99, "spice"),
      ),
    ).resolves.toBeNull();
    expect(auditEntries.at(-1)).toMatchObject({ success: false });
  });
});

describe("ctx.credentials.registerSecretResolver", () => {
  it("refuses without auth:provide", () => {
    grants.set("demo", []);
    const ctx = contextFor([], { auth: { secretSchemes: ["op"] } });

    expect(() =>
      ctx.credentials.registerSecretResolver("op", async () => ""),
    ).toThrow(/auth:provide/);
  });

  it("refuses a scheme not listed in contributes.auth.secretSchemes", () => {
    grants.set("demo", ["auth:provide"]);
    const ctx = contextFor(["auth:provide"], { auth: {} });

    expect(() =>
      ctx.credentials.registerSecretResolver("op", async () => ""),
    ).toThrow(/secretSchemes/);
  });

  it("resolves through the registered scheme and audits the call", async () => {
    grants.set("demo", ["auth:provide"]);
    const ctx = contextFor(["auth:provide"], {
      auth: { secretSchemes: ["op"] },
    });

    ctx.credentials.registerSecretResolver("op", async (userId, ref) => {
      state.resolverCalls.push({ userId, ref });
      return `resolved:${ref}`;
    });

    const registration = requireSecretResolver("op");
    expect(registration.pluginId).toBe("demo");

    const value = await registration.resolve("alice", "op://v/i/f");
    expect(value).toBe("resolved:op://v/i/f");
    expect(state.resolverCalls[0]).toMatchObject({
      userId: "alice",
      ref: "op://v/i/f",
    });
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_secret_resolve",
      success: true,
    });
  });

  it("is removed when the plugin is deactivated", async () => {
    grants.set("demo", ["auth:provide"]);
    const manifest = {
      id: "demo",
      name: "demo",
      version: "1.0.0",
      description: "",
      author: { name: "test" },
      license: "MIT",
      category: "Productivity",
      engine: { termix: ">=2.9.0", api: "1" },
      capabilities: ["auth:provide"],
      contributes: { auth: { secretSchemes: ["op"] } },
    } as PluginManifest;
    const handle = createPluginHandle("demo", { activate: () => {} });
    const ctx = createPluginContext(manifest, handle);

    ctx.credentials.registerSecretResolver("op", async () => "x");
    await handle.bag.disposeAll();

    expect(getSecretResolver("op")).toBeUndefined();
  });
});

describe("ctx.credentials.listSshKeys", () => {
  const pair = ssh2.utils.generateKeyPairSync("rsa", { bits: 2048 });
  const derived = (() => {
    const parsed = ssh2.utils.parseKey(pair.private);
    const key = Array.isArray(parsed) ? parsed[0] : parsed;
    if (key instanceof Error) throw key;
    return `${key.type} ${key.getPublicSSH().toString("base64")}`;
  })();

  beforeEach(() => {
    state.userCredentials.set("owner", [
      { id: 1, name: "stored", authType: "key", publicKey: "ssh-ed25519 AAAA" },
      { id: 2, name: "derived", authType: "key", privateKey: pair.private },
      { id: 3, name: "pw", authType: "password", password: "secret" },
    ]);
  });

  it("refuses without credentials:use", async () => {
    grants.set("demo", []);
    const ctx = contextFor([]);
    await expect(
      runAsActor("owner", "request", () => ctx.credentials.listSshKeys()),
    ).rejects.toThrow(/credentials:use/);
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_credentials_list_keys",
      success: false,
    });
  });

  it("refuses with no acting user", async () => {
    grants.set("demo", ["credentials:use"]);
    const ctx = contextFor(["credentials:use"]);
    await expect(ctx.credentials.listSshKeys()).rejects.toThrow(/acting user/);
  });

  it("refuses without the core credentials.view permission", async () => {
    grants.set("demo", ["credentials:use"]);
    state.corePermissions.delete("credentials.view");
    const ctx = contextFor(["credentials:use"]);
    await expect(
      runAsActor("owner", "request", () => ctx.credentials.listSshKeys()),
    ).rejects.toThrow(/credentials.view/);
  });

  it("lists only the actor's key credentials, public half only", async () => {
    grants.set("demo", ["credentials:use"]);
    const ctx = contextFor(["credentials:use"]);
    const keys = await runAsActor("owner", "request", () =>
      ctx.credentials.listSshKeys(),
    );
    expect(keys).toEqual([
      { id: 1, name: "stored", username: null, publicKey: "ssh-ed25519 AAAA" },
      { id: 2, name: "derived", username: null, publicKey: derived },
    ]);
    expect(JSON.stringify(keys)).not.toContain("PRIVATE KEY");

    const other = await runAsActor("someone", "request", () =>
      ctx.credentials.listSshKeys(),
    );
    expect(other).toEqual([]);
  });
});

describe("ctx.credentials.createSshKey", () => {
  const input = {
    name: "Generated",
    privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
    publicKey: "ssh-ed25519 AAAA",
    keyType: "ssh-ed25519",
  };

  it("refuses without credentials:write", async () => {
    grants.set("demo", ["credentials:use"]);
    const ctx = contextFor(["credentials:use"]);
    await expect(
      runAsActor("owner", "request", () => ctx.credentials.createSshKey(input)),
    ).rejects.toThrow(/credentials:write/);
    expect(state.savedCredentials).toHaveLength(0);
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_credentials_create_key",
      success: false,
    });
  });

  it("refuses without the core credentials.create permission", async () => {
    grants.set("demo", ["credentials:write"]);
    state.corePermissions.delete("credentials.create");
    const ctx = contextFor(["credentials:write"]);
    await expect(
      runAsActor("owner", "request", () => ctx.credentials.createSshKey(input)),
    ).rejects.toThrow(/credentials.create/);
    expect(state.savedCredentials).toHaveLength(0);
  });

  it("saves a key credential owned by the actor", async () => {
    grants.set("demo", ["credentials:write"]);
    const ctx = contextFor(["credentials:write"]);
    const result = await runAsActor("owner", "request", () =>
      ctx.credentials.createSshKey({ ...input, username: "root" }),
    );
    expect(result).toEqual({ id: 100 });
    expect(state.savedCredentials[0]).toMatchObject({
      userId: "owner",
      authType: "key",
      name: "Generated",
      username: "root",
      privateKey: input.privateKey,
      publicKey: input.publicKey,
      detectedKeyType: "ssh-ed25519",
    });
    expect(auditEntries.at(-1)).toMatchObject({
      action: "plugin_credentials_create_key",
      success: true,
    });
  });
});
