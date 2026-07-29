import { afterEach, describe, expect, it, vi } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { TermixIdentityRepository } from "../../../database/repositories/termix-identity-repository.js";

describe("TermixIdentityRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(onWrite = vi.fn()): Promise<{
    repo: TermixIdentityRepository;
    onWrite: ReturnType<typeof vi.fn>;
  }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_credentials (id, user_id, name, username, auth_type) VALUES
        (10, 'user-1', 'cred-10', 'root', 'password'),
        (20, 'user-1', 'cred-20', 'root', 'password');
    `);

    return {
      repo: new TermixIdentityRepository(context, onWrite),
      onWrite,
    };
  }

  it("creates, updates, finds, and deletes identities", async () => {
    const { repo, onWrite } = await createRepository();

    const created = await repo.createIdentity({
      userId: "user-1",
      handle: "alice",
      description: "workstation keys",
    });

    expect(created.id).toBeGreaterThan(0);
    expect(await repo.isHandleTaken("alice")).toBe(true);
    expect(await repo.findIdentityForUser("user-1")).toMatchObject({
      handle: "alice",
    });
    expect(await repo.findIdentityByHandle("alice")).toMatchObject({
      userId: "user-1",
    });

    const updated = await repo.updateIdentityForUser("user-1", {
      handle: "alice-renamed",
      description: null,
    });
    expect(updated).toMatchObject({
      handle: "alice-renamed",
      description: null,
    });

    await expect(repo.deleteIdentityForUser("user-1")).resolves.toBe(true);
    await expect(repo.deleteIdentityForUser("user-1")).resolves.toBe(false);
    await expect(repo.findIdentityForUser("user-1")).resolves.toBeNull();
    expect(onWrite).toHaveBeenCalledTimes(3);
  });

  it("creates, lists, updates, deletes, and links public keys", async () => {
    const { repo, onWrite } = await createRepository();
    const identity = await repo.createIdentity({
      userId: "user-1",
      handle: "alice",
      description: null,
    });
    onWrite.mockClear();

    const first = await repo.createKey({
      identityId: identity.id,
      userId: "user-1",
      publicKey: "ssh-ed25519 AAAA1",
      keyType: "ssh-ed25519",
      algorithm: "ED25519",
      label: "laptop",
      comment: null,
      source: "credential",
      credentialId: 10,
    });
    await repo.createKey({
      identityId: identity.id,
      userId: "user-1",
      publicKey: "ssh-rsa AAAA2",
      keyType: "ssh-rsa",
      algorithm: "RSA",
      label: "disabled",
      comment: null,
      source: "manual",
      credentialId: 20,
      enabled: false,
    });

    expect(await repo.listKeysByIdentityId(identity.id)).toHaveLength(2);
    expect(await repo.listEnabledKeysByIdentityId(identity.id)).toMatchObject([
      { id: first.id, publicKey: "ssh-ed25519 AAAA1" },
    ]);
    expect(await repo.listLinkedCredentialIds(identity.id)).toEqual([10]);

    const updated = await repo.updateKeyForUser("user-1", first.id, {
      enabled: false,
      label: "revoked",
    });
    expect(updated).toMatchObject({ enabled: false, label: "revoked" });
    await expect(
      repo.findKeyForUser("user-1", first.id),
    ).resolves.toMatchObject({ label: "revoked" });

    await expect(repo.deleteKeyForUser("user-1", first.id)).resolves.toBe(true);
    await expect(repo.deleteKeyForUser("user-1", first.id)).resolves.toBe(
      false,
    );
    expect(onWrite).toHaveBeenCalledTimes(4);
  });

  it("deletes identities and keys for a user", async () => {
    const { repo, onWrite } = await createRepository();
    const userIdentity = await repo.createIdentity({
      userId: "user-1",
      handle: "alice",
      description: null,
    });
    const otherIdentity = await repo.createIdentity({
      userId: "user-2",
      handle: "bob",
      description: null,
    });
    await repo.createKey({
      identityId: userIdentity.id,
      userId: "user-1",
      publicKey: "ssh-ed25519 AAAA1",
      keyType: "ssh-ed25519",
      algorithm: "ED25519",
      source: "manual",
    });
    await repo.createKey({
      identityId: otherIdentity.id,
      userId: "user-2",
      publicKey: "ssh-ed25519 AAAA2",
      keyType: "ssh-ed25519",
      algorithm: "ED25519",
      source: "manual",
    });
    onWrite.mockClear();

    await expect(repo.deleteByUserId("user-1")).resolves.toEqual({
      identitiesDeleted: 1,
      keysDeleted: 1,
    });
    await expect(repo.deleteByUserId("missing")).resolves.toEqual({
      identitiesDeleted: 0,
      keysDeleted: 0,
    });

    expect(await repo.findIdentityForUser("user-1")).toBeNull();
    expect(await repo.listKeysByIdentityId(userIdentity.id)).toEqual([]);
    expect(await repo.findIdentityForUser("user-2")).toMatchObject({
      handle: "bob",
    });
    expect(await repo.listKeysByIdentityId(otherIdentity.id)).toHaveLength(1);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });
});
