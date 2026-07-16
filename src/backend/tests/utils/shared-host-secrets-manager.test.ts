import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerDEK = crypto.randomBytes(32);
const targetDEK = crypto.randomBytes(32);

type SecretRow = Record<string, unknown> & {
  id: number;
  hostAccessId: number;
  targetUserId: string;
  protocol: string;
};

const state = vi.hoisted(() => ({
  hosts: new Map<number, Record<string, unknown>>(),
  credentials: new Map<number, Record<string, unknown>>(),
  secretRows: [] as Array<Record<string, unknown>>,
  // hostAccessId -> hostId, used by findForHostUserProtocol
  accessToHost: new Map<number, number>(),
  grants: [] as Array<Record<string, unknown>>,
  roleMembers: new Map<number, string[]>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
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
    enableSsh: true,
    enableRdp: false,
    enableVnc: false,
    enableTelnet: false,
    rdpAuthType: null,
    vncAuthType: null,
    telnetAuthType: null,
    rdpCredentialId: null,
    vncCredentialId: null,
    telnetCredentialId: null,
    rdpUser: null,
    rdpPassword: null,
    rdpDomain: null,
    vncUser: null,
    vncPassword: null,
    telnetUser: null,
    telnetPassword: null,
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
});

describe("SharedHostSecretsManager", () => {
  it("snapshots an inline-password SSH host and the target can decrypt it", async () => {
    state.hosts.set(42, baseHost());

    await manager.snapshotForUser(7, 42, "target", "owner");

    expect(state.secretRows).toHaveLength(1);
    const row = state.secretRows[0];
    expect(row.protocol).toBe("ssh");
    expect(row.sourceType).toBe("inline");
    expect(row.encryptedPassword).not.toBe("hunter2");

    const secret = await manager.getSecretForUser(42, "target", "ssh");
    expect(secret).toMatchObject({
      username: "root",
      authType: "password",
      password: "hunter2",
    });
  });

  it("snapshots every enabled protocol from credential and inline sources", async () => {
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
        password: null,
        enableRdp: true,
        rdpUser: "rdp-admin",
        rdpPassword: "rdp-pass",
        rdpDomain: "CORP",
        enableTelnet: true,
        telnetUser: "tel-user",
        telnetPassword: "tel-pass",
      }),
    );

    await manager.snapshotForUser(7, 42, "target", "owner");

    expect(state.secretRows.map((row) => row.protocol).sort()).toEqual([
      "rdp",
      "ssh",
      "telnet",
    ]);

    const ssh = await manager.getSecretForUser(42, "target", "ssh");
    expect(ssh).toMatchObject({
      username: "cred-user",
      authType: "key",
      key: "PRIVATE-KEY",
      keyPassword: "kp",
      keyType: "ssh-ed25519",
    });

    const rdp = await manager.getSecretForUser(42, "target", "rdp");
    expect(rdp).toMatchObject({
      username: "rdp-admin",
      password: "rdp-pass",
      domain: "CORP",
      authType: "direct",
    });

    const telnet = await manager.getSecretForUser(42, "target", "telnet");
    expect(telnet).toMatchObject({
      username: "tel-user",
      password: "tel-pass",
    });
  });

  it("produces no snapshot rows for secret-less auth types", async () => {
    state.hosts.set(42, baseHost({ authType: "opkssh", password: null }));

    await manager.snapshotForUser(7, 42, "target", "owner");
    expect(state.secretRows).toHaveLength(0);
  });

  it("removes stale protocol rows on re-snapshot", async () => {
    state.hosts.set(
      42,
      baseHost({
        enableRdp: true,
        rdpUser: "rdp-admin",
        rdpPassword: "rdp-pass",
      }),
    );
    await manager.snapshotForUser(7, 42, "target", "owner");
    expect(state.secretRows).toHaveLength(2);

    // Owner turns RDP off; the RDP snapshot must disappear.
    state.hosts.set(42, baseHost());
    await manager.snapshotForUser(7, 42, "target", "owner");
    expect(state.secretRows.map((row) => row.protocol)).toEqual(["ssh"]);
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
    await manager.snapshotForUser(7, 42, "target", "owner");

    const row = state.secretRows[0];
    expect(() =>
      FieldCrypto.decryptField(
        row.encryptedPassword as string,
        ownerDEK,
        "shared-7-target-ssh",
        "password",
      ),
    ).toThrow();
  });

  it("resyncHost re-snapshots direct grants and role members", async () => {
    state.hosts.set(42, baseHost());
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

    // Owner rotates the inline password; resync updates the copies.
    state.hosts.set(42, baseHost({ password: "rotated" }));
    await manager.resyncHost(42);

    const secret = await manager.getSecretForUser(42, "target", "ssh");
    expect(secret?.password).toBe("rotated");
  });

  it("snapshotForRoleMember fans out from role grants", async () => {
    state.hosts.set(42, baseHost());
    state.accessToHost = new Map([[2, 42]]);
    state.grants = [{ id: 2, hostId: 42, userId: null, roleId: 9 }];

    await manager.snapshotForRoleMember(9, "member-1");

    expect(state.secretRows).toHaveLength(1);
    expect(state.secretRows[0]).toMatchObject({
      hostAccessId: 2,
      targetUserId: "member-1",
      protocol: "ssh",
    });
  });
});
