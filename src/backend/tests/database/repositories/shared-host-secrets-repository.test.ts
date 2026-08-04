import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { SharedHostSecretsRepository } from "../../../database/repositories/shared-host-secrets-repository.js";

describe("SharedHostSecretsRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<{
    repository: SharedHostSecretsRepository;
  }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash) VALUES
        ('owner-1', 'owner-1', 'hash'),
        ('owner-2', 'owner-2', 'hash');
      INSERT INTO users (id, username, password_hash) VALUES
        ('user-1', 'user-1', 'hash'),
        ('user-2', 'user-2', 'hash');
      INSERT INTO roles (id, name, display_name, is_system) VALUES
        (7, 'role-7', 'Role 7', 0);
      INSERT INTO ssh_credentials (id, user_id, name, username, auth_type) VALUES
        (123, 'user-1', 'cred-123', 'root', 'password'),
        (124, 'user-1', 'cred-124', 'root', 'password');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, credential_id, rdp_credential_id, auth_type)
      VALUES (42, 'owner-1', 'prod', '10.0.0.42', 22, 'root', 123, 124, 'password'),
        (43, 'owner-1', 'staging', '10.0.0.43', 22, 'root', NULL, NULL, 'password'),
        (44, 'owner-2', 'other', '10.0.0.44', 22, 'root', 123, NULL, 'password');
      INSERT INTO host_access (id, host_id, user_id, role_id, granted_by)
      VALUES
        (1, 42, 'user-1', NULL, 'owner-1'),
        (2, 42, NULL, 7, 'owner-1'),
        (3, 43, 'user-2', NULL, 'owner-1');
    `);

    return {
      repository: new SharedHostSecretsRepository(context, onWrite),
    };
  }

  it("upserts snapshots per protocol and finds them by host/user/protocol", async () => {
    let writeCount = 0;
    const { repository } = await createRepository(() => {
      writeCount += 1;
    });

    await repository.upsert({
      hostAccessId: 1,
      targetUserId: "user-1",
      protocol: "ssh",
      sourceType: "credential",
      originalCredentialId: 123,
      encryptedUsername: "enc-user",
      encryptedAuthType: "password",
      encryptedPassword: "enc-pass",
    });

    await expect(
      repository.findForHostUserProtocol(42, "user-1", "ssh"),
    ).resolves.toMatchObject({
      hostAccessId: 1,
      protocol: "ssh",
      encryptedPassword: "enc-pass",
    });

    // Upsert on the same (grant, user, protocol) updates in place.
    await repository.upsert({
      hostAccessId: 1,
      targetUserId: "user-1",
      protocol: "ssh",
      sourceType: "inline",
      originalCredentialId: null,
      encryptedUsername: "enc-user-2",
      encryptedAuthType: "key",
      encryptedKey: "enc-key",
    });

    const updated = await repository.findForHostUserProtocol(
      42,
      "user-1",
      "ssh",
    );
    expect(updated).toMatchObject({
      sourceType: "inline",
      encryptedUsername: "enc-user-2",
      encryptedKey: "enc-key",
    });

    await expect(
      repository.findForHostUserProtocol(42, "user-1", "rdp"),
    ).resolves.toBeNull();
    await expect(
      repository.findForHostUserProtocol(43, "user-1", "ssh"),
    ).resolves.toBeNull();
    expect(writeCount).toBe(2);
  });

  it("deletes stale protocols while keeping the listed ones", async () => {
    const { repository } = await createRepository();

    for (const protocol of ["ssh", "rdp", "vnc"] as const) {
      await repository.upsert({
        hostAccessId: 1,
        targetUserId: "user-1",
        protocol,
        sourceType: "inline",
        encryptedAuthType: "direct",
      });
    }

    await repository.deleteForHostAccessAndTarget(1, "user-1", ["ssh"]);

    await expect(
      repository.findForHostUserProtocol(42, "user-1", "ssh"),
    ).resolves.not.toBeNull();
    await expect(
      repository.findForHostUserProtocol(42, "user-1", "rdp"),
    ).resolves.toBeNull();
    await expect(
      repository.findForHostUserProtocol(42, "user-1", "vnc"),
    ).resolves.toBeNull();
  });

  it("deletes by host access, target user, credential and role membership", async () => {
    const { repository } = await createRepository();

    await repository.upsert({
      hostAccessId: 1,
      targetUserId: "user-1",
      protocol: "ssh",
      sourceType: "credential",
      originalCredentialId: 123,
      encryptedAuthType: "password",
    });
    await repository.upsert({
      hostAccessId: 2,
      targetUserId: "user-1",
      protocol: "ssh",
      sourceType: "credential",
      originalCredentialId: 123,
      encryptedAuthType: "password",
    });
    await repository.upsert({
      hostAccessId: 3,
      targetUserId: "user-2",
      protocol: "ssh",
      sourceType: "inline",
      encryptedAuthType: "password",
    });

    // Role-membership cleanup: only grant 2 targets role 7.
    expect(await repository.deleteForRoleMember(7, "user-1")).toBe(1);
    await expect(
      repository.existsForHostAccessAndTargetUser(2, "user-1"),
    ).resolves.toBe(false);
    await expect(
      repository.existsForHostAccessAndTargetUser(1, "user-1"),
    ).resolves.toBe(true);

    expect(await repository.deleteByHostAccessId(1)).toBe(1);
    expect(await repository.deleteByTargetUserId("user-2")).toBe(1);
    expect(await repository.deleteByOriginalCredentialId(123)).toBe(0);
  });

  it("finds host ids referencing a credential for the owner", async () => {
    const { repository } = await createRepository();

    await expect(
      repository.findHostIdsReferencingCredential("owner-1", 123),
    ).resolves.toEqual([42]);
    await expect(
      repository.findHostIdsReferencingCredential("owner-1", 124),
    ).resolves.toEqual([42]);
    await expect(
      repository.findHostIdsReferencingCredential("owner-1", 999),
    ).resolves.toEqual([]);
    await expect(
      repository.findHostIdsReferencingCredential("owner-2", 123),
    ).resolves.toEqual([44]);
  });
});
