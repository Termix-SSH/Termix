import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerDEK = crypto.randomBytes(32);
const targetDEK = crypto.randomBytes(32);

const state = vi.hoisted(() => ({
  hosts: new Map<number, Record<string, unknown>>(),
  credentials: new Map<number, Record<string, unknown>>(),
  secretRows: [] as Array<Record<string, unknown>>,
  // hostAccessId -> hostId, used by findForHostUserProtocol
  accessToHost: new Map<number, number>(),
  grants: [] as Array<Record<string, unknown>>,
  roleMembers: new Map<number, string[]>(),
  // hostId -> that host's plugin protocol logins, decrypted
  logins: new Map<number, Array<Record<string, unknown>>>(),
}));

vi.mock("../../hosts/usable-credential.js", () => ({
  findUsableCredential: async (credentialId: number) =>
    state.credentials.get(credentialId) ?? null,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostProtocolAuthRepository: () => ({
    listForHost: async (hostId: number) => state.logins.get(hostId) ?? [],
  }),
  createCurrentHostResolutionRepository: () => ({
    findHostById: async (hostId: number) => state.hosts.get(hostId) ?? null,
    findHostOwnerId: async (hostId: number) =>
      (state.hosts.get(hostId)?.userId as string) ?? null,
    findCredentialByIdForUser: async (credentialId: number) =>
      state.credentials.get(credentialId) ?? null,
  }),
  createCurrentSharedHostSecretsRepository: () => ({
    upsert: async (row: Record<string, unknown>) => {
      const existing = state.secretRows.find(
        (r) =>
          r.hostAccessId === row.hostAccessId &&
          r.targetUserId === row.targetUserId &&
          r.protocol === row.protocol,
      );
      if (existing) Object.assign(existing, row);
      else state.secretRows.push({ id: state.secretRows.length + 1, ...row });
    },
    deleteForHostAccessAndTarget: async (
      hostAccessId: number,
      targetUserId: string,
      keepProtocols: string[],
    ) => {
      state.secretRows = state.secretRows.filter(
        (r) =>
          !(
            r.hostAccessId === hostAccessId &&
            r.targetUserId === targetUserId &&
            !keepProtocols.includes(r.protocol as string)
          ),
      );
    },
    findForHostUserProtocol: async (
      hostId: number,
      targetUserId: string,
      protocol: string,
    ) =>
      state.secretRows.find(
        (r) =>
          state.accessToHost.get(r.hostAccessId as number) === hostId &&
          r.targetUserId === targetUserId &&
          r.protocol === protocol,
      ) ?? null,
    deleteByHostAccessId: async () => 0,
    deleteByTargetUserId: async () => 0,
    deleteByOriginalCredentialId: async () => 0,
    findHostIdsReferencingCredential: async (
      _ownerId: string,
      credentialId: number,
    ) =>
      [...state.hosts.values()]
        .filter((h) => h.credentialId === credentialId)
        .map((h) => h.id as number),
  }),
  createCurrentRbacAccessRepository: () => ({
    listActiveHostAccessGrants: async (hostId: number) =>
      state.grants.filter((g) => g.hostId === hostId),
    listRoleHostAccessCredentialSources: async (roleId: number) =>
      state.grants
        .filter((g) => g.roleId === roleId)
        .map((g) => ({
          hostAccessId: g.id,
          hostId: g.hostId,
          hostOwnerId: state.hosts.get(g.hostId as number)?.userId,
        })),
  }),
  createCurrentRoleRepository: () => ({
    listRoleUserIds: async (roleId: number) =>
      state.roleMembers.get(roleId) ?? [],
    listUserRoleIds: async () => [],
  }),
}));

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    validateUserAccess: (userId: string) => {
      if (userId === "owner") return ownerDEK;
      if (userId === "target" || userId === "member-1") return targetDEK;
      throw new Error(`User ${userId} has no data encryption key`);
    },
    getUserDataKey: (userId: string) =>
      userId === "owner"
        ? ownerDEK
        : userId === "target" || userId === "member-1"
          ? targetDEK
          : null,
    canUserAccessData: () => true,
  },
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { FieldCrypto } from "../../utils/field-crypto.js";
import { SharedHostSecretsManager } from "../../utils/shared-host-secrets-manager.js";

const manager = SharedHostSecretsManager.getInstance();

function baseHost(overrides: Record<string, unknown> = {}) {
  // Records come back from the resolution repository already decrypted.
  return {
    id: 42,
    userId: "owner",
    connectionType: "ssh",
    name: "prod",
    ip: "10.0.0.42",
    username: "root",
    authType: "password",
    password: "hunter2",
    key: null,
    keyPassword: null,
    keyType: null,
    credentialId: null,
    shareSshAuth: false,
    enableSsh: true,
    ...overrides,
  };
}

/** A plugin protocol login as the repository hands it back, decrypted. */
function login(protocol: string, overrides: Record<string, unknown> = {}) {
  return {
    protocol,
    authType: "direct",
    credentialId: null,
    username: null,
    password: null,
    fields: {},
    secretFields: {},
    ...overrides,
  };
}

beforeEach(() => {
  state.hosts.clear();
  state.credentials.clear();
  state.secretRows = [];
  state.accessToHost = new Map([[7, 42]]);
  state.grants = [];
  state.roleMembers.clear();
  state.logins.clear();
});

describe("SharedHostSecretsManager", () => {
  it("keeps an inline-password SSH host private by default", async () => {
    state.hosts.set(42, baseHost());

    await manager.snapshotForUser(7, 42, "target", "owner");

    expect(state.secretRows).toHaveLength(0);
    expect(await manager.getSecretForUser(42, "target", "ssh")).toBeNull();
  });

  it("snapshots inline SSH authentication when the owner opts in", async () => {
    state.hosts.set(42, baseHost({ shareSshAuth: true }));

    await manager.snapshotForUser(7, 42, "target", "owner");

    expect(state.secretRows.map((row) => row.protocol)).toEqual(["ssh"]);
    expect(await manager.getSecretForUser(42, "target", "ssh")).toMatchObject({
      username: "root",
      authType: "password",
      password: "hunter2",
    });
  });

  it("snapshots opted-in SSH credential auth alongside plugin protocol logins", async () => {
    state.credentials.set(123, {
      id: 123,
      userId: "owner",
      username: "cred-user",
      authType: "key",
      password: null,
      privateKey: "PRIVATE-KEY",
      key: null,
      keyPassword: "kp",
      keyType: "ssh-ed25519",
    });
    state.hosts.set(
      42,
      baseHost({
        authType: "credential",
        credentialId: 123,
        shareSshAuth: true,
        password: null,
      }),
    );
    state.logins.set(42, [
      login("spice", {
        username: "spice-admin",
        password: "spice-pass",
        fields: { display: "2" },
        secretFields: { ticket: "t-1" },
      }),
      login("x2go", { username: "x-user", password: "x-pass" }),
    ]);

    await manager.snapshotForUser(7, 42, "target", "owner");

    expect(state.secretRows.map((row) => row.protocol).sort()).toEqual([
      "spice",
      "ssh",
      "x2go",
    ]);

    expect(await manager.getSecretForUser(42, "target", "ssh")).toMatchObject({
      username: "cred-user",
      authType: "key",
      key: "PRIVATE-KEY",
      keyPassword: "kp",
      keyType: "ssh-ed25519",
    });

    const spice = await manager.getSecretForUser(42, "target", "spice");
    expect(spice).toMatchObject({
      username: "spice-admin",
      password: "spice-pass",
      fields: { display: "2", ticket: "t-1" },
      authType: "direct",
    });

    const x2go = await manager.getSecretForUser(42, "target", "x2go");
    expect(x2go).toMatchObject({
      username: "x-user",
      password: "x-pass",
    });
  });

  it("snapshots a credential-backed protocol login from the credential", async () => {
    state.credentials.set(55, {
      id: 55,
      userId: "owner",
      username: "cred-viewer",
      password: "cred-pass",
    });
    state.hosts.set(42, baseHost());
    state.logins.set(42, [
      login("spice", {
        authType: "credential",
        credentialId: 55,
        fields: { display: "1" },
      }),
    ]);

    await manager.snapshotForUser(7, 42, "target", "owner");

    expect(state.secretRows[0]).toMatchObject({
      protocol: "spice",
      sourceType: "credential",
      originalCredentialId: 55,
    });
    expect(await manager.getSecretForUser(42, "target", "spice")).toMatchObject(
      {
        authType: "credential",
        username: "cred-viewer",
        password: "cred-pass",
        fields: { display: "1" },
      },
    );
  });

  it("takes no snapshot of a login that asks at connect time", async () => {
    state.hosts.set(42, baseHost());
    state.logins.set(42, [login("spice", { authType: "none" })]);

    await manager.snapshotForUser(7, 42, "target", "owner");

    expect(state.secretRows).toHaveLength(0);
  });

  it("reads a snapshot taken before 2.9.0 with its domain column", async () => {
    const recordId = "shared-7-target-legacy";
    state.secretRows.push({
      id: 1,
      hostAccessId: 7,
      targetUserId: "target",
      protocol: "legacy",
      encryptedUsername: FieldCrypto.encryptField(
        "admin",
        targetDEK,
        recordId,
        "username",
      ),
      encryptedAuthType: "direct",
      encryptedDomain: FieldCrypto.encryptField(
        "CORP",
        targetDEK,
        recordId,
        "domain",
      ),
    });

    expect(
      await manager.getSecretForUser(42, "target", "legacy"),
    ).toMatchObject({ username: "admin", fields: { domain: "CORP" } });
  });

  it("drops a protocol's snapshot once its login is gone", async () => {
    state.hosts.set(42, baseHost());
    state.logins.set(42, [login("spice", { username: "u", password: "p" })]);
    await manager.snapshotForUser(7, 42, "target", "owner");
    expect(state.secretRows).toHaveLength(1);

    state.logins.set(42, []);
    await manager.snapshotForUser(7, 42, "target", "owner");
    expect(state.secretRows).toHaveLength(0);
  });

  it("produces no snapshot rows for secret-less auth types", async () => {
    state.hosts.set(
      42,
      baseHost({
        authType: "opkssh",
        password: null,
        shareSshAuth: true,
      }),
    );

    await manager.snapshotForUser(7, 42, "target", "owner");
    expect(state.secretRows).toHaveLength(0);
  });

  it("removes the SSH snapshot when the owner disables sharing", async () => {
    state.hosts.set(42, baseHost({ shareSshAuth: true }));
    await manager.snapshotForUser(7, 42, "target", "owner");
    expect(state.secretRows).toHaveLength(1);

    // Owner makes SSH authentication private again.
    state.hosts.set(42, baseHost());
    await manager.snapshotForUser(7, 42, "target", "owner");
    expect(state.secretRows).toHaveLength(0);
  });

  it("fails fast when a participant has no DEK", async () => {
    state.hosts.set(42, baseHost());
    await expect(
      manager.snapshotForUser(7, 42, "locked-user", "owner"),
    ).rejects.toThrow(/no data encryption key/);
    expect(state.secretRows).toHaveLength(0);
  });

  it("cannot be decrypted with the wrong DEK", async () => {
    state.hosts.set(42, baseHost());
    state.logins.set(42, [
      login("spice", {
        username: "spice-admin",
        password: "spice-pass",
        secretFields: { ticket: "t-1" },
      }),
    ]);
    await manager.snapshotForUser(7, 42, "target", "owner");

    const row = state.secretRows[0];
    for (const [column, field] of [
      ["encryptedPassword", "password"],
      ["encryptedFields", "fields"],
    ]) {
      expect(() =>
        FieldCrypto.decryptField(
          row[column] as string,
          ownerDEK,
          "shared-7-target-spice",
          field,
        ),
      ).toThrow();
    }
  });

  it("refuses a tampered snapshot rather than handing it out", async () => {
    state.hosts.set(42, baseHost());
    state.logins.set(42, [login("spice", { password: "spice-pass" })]);
    await manager.snapshotForUser(7, 42, "target", "owner");

    const row = state.secretRows[0];
    const envelope = JSON.parse(row.encryptedPassword as string);
    envelope.data = envelope.data.replace(/^./, (c: string) =>
      c === "0" ? "1" : "0",
    );
    row.encryptedPassword = JSON.stringify(envelope);

    await expect(
      manager.getSecretForUser(42, "target", "spice"),
    ).rejects.toThrow();
  });

  it("resyncHost re-snapshots direct grants and role members", async () => {
    state.hosts.set(42, baseHost());
    state.logins.set(42, [
      login("spice", { username: "spice-admin", password: "spice-pass" }),
    ]);
    state.accessToHost = new Map([
      [1, 42],
      [2, 42],
    ]);
    state.grants = [
      { id: 1, hostId: 42, userId: "target", roleId: null },
      { id: 2, hostId: 42, userId: null, roleId: 9 },
    ];
    state.roleMembers.set(9, ["member-1", "owner"]);

    await manager.resyncHost(42);

    // target via grant 1, member-1 via grant 2; owner skipped.
    expect(
      state.secretRows.map((row) => [row.hostAccessId, row.targetUserId]),
    ).toEqual([
      [1, "target"],
      [2, "member-1"],
    ]);

    // Owner rotates the non-SSH password; resync updates those copies.
    state.logins.set(42, [
      login("spice", { username: "spice-admin", password: "rotated" }),
    ]);
    await manager.resyncHost(42);

    const secret = await manager.getSecretForUser(42, "target", "spice");
    expect(secret?.password).toBe("rotated");
  });

  it("snapshotForRoleMember fans out from role grants", async () => {
    state.hosts.set(42, baseHost());
    state.logins.set(42, [
      login("spice", { username: "spice-admin", password: "spice-pass" }),
    ]);
    state.accessToHost = new Map([[2, 42]]);
    state.grants = [{ id: 2, hostId: 42, userId: null, roleId: 9 }];

    await manager.snapshotForRoleMember(9, "member-1");

    expect(state.secretRows).toHaveLength(1);
    expect(state.secretRows[0]).toMatchObject({
      hostAccessId: 2,
      targetUserId: "member-1",
      protocol: "spice",
    });
  });
});
