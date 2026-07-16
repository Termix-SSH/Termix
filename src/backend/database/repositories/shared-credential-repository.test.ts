import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { SharedCredentialRepository } from "./shared-credential-repository.js";

describe("SharedCredentialRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<{
    repository: SharedCredentialRepository;
    sqlite: NonNullable<
      Awaited<ReturnType<SqliteDatabaseAdapter["connect"]>>["sqlite"]
    >;
  }> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE shared_credentials (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_access_id INTEGER NOT NULL,
        original_credential_id INTEGER NOT NULL,
        target_user_id TEXT NOT NULL,
        encrypted_username TEXT NOT NULL,
        encrypted_auth_type TEXT NOT NULL,
        encrypted_password TEXT,
        encrypted_key TEXT,
        encrypted_key_password TEXT,
        encrypted_key_type TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        needs_re_encryption INTEGER NOT NULL DEFAULT 0
      );

      INSERT INTO shared_credentials (
        id,
        host_access_id,
        original_credential_id,
        target_user_id,
        encrypted_username,
        encrypted_auth_type,
        encrypted_password,
        needs_re_encryption
      )
      VALUES
        (1, 10, 100, 'user-1', 'u1', 'password', 'p1', 0),
        (2, 10, 100, 'user-2', 'u2', 'password', 'p2', 1),
        (3, 11, 101, 'user-2', 'u3', 'key', NULL, 1);
    `);

    return {
      repository: new SharedCredentialRepository(context, onWrite),
      sqlite: context.sqlite!,
    };
  }

  it("checks existence and creates shared credentials", async () => {
    let writes = 0;
    const { repository } = await createRepository(() => {
      writes += 1;
    });

    await expect(
      repository.existsForHostAccessAndTargetUser(10, "user-1"),
    ).resolves.toBe(true);
    await expect(
      repository.existsForHostAccessAndTargetUser(10, "missing"),
    ).resolves.toBe(false);

    const created = await repository.create({
      hostAccessId: 12,
      originalCredentialId: 102,
      targetUserId: "user-3",
      encryptedUsername: "u4",
      encryptedAuthType: "password",
      encryptedPassword: "p4",
      needsReEncryption: false,
    });

    expect(created).toMatchObject({
      hostAccessId: 12,
      originalCredentialId: 102,
      targetUserId: "user-3",
      encryptedUsername: "u4",
    });
    expect(writes).toBe(1);
  });

  it("finds, lists, and updates shared credentials", async () => {
    let writes = 0;
    const { repository } = await createRepository(() => {
      writes += 1;
    });

    await expect(repository.findById(1)).resolves.toMatchObject({
      targetUserId: "user-1",
    });
    await expect(repository.findById(999)).resolves.toBeNull();
    await expect(
      repository.listByOriginalCredentialId(100),
    ).resolves.toHaveLength(2);
    await expect(
      repository.listPendingByTargetUserId("user-2"),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 2 }),
        expect.objectContaining({ id: 3 }),
      ]),
    );

    await expect(
      repository.updateById(2, {
        encryptedPassword: "updated",
        needsReEncryption: false,
      }),
    ).resolves.toMatchObject({
      encryptedPassword: "updated",
      needsReEncryption: false,
    });
    expect(writes).toBe(1);
  });

  it("marks and deletes shared credentials", async () => {
    let writes = 0;
    const { repository, sqlite } = await createRepository(() => {
      writes += 1;
    });

    await expect(
      repository.markNeedsReEncryptionByOriginalCredentialId(100),
    ).resolves.toBe(2);
    await expect(repository.deleteByTargetUserId("user-1")).resolves.toBe(1);
    await expect(repository.deleteByOriginalCredentialId(101)).resolves.toBe(1);

    expect(
      sqlite.prepare("SELECT id FROM shared_credentials ORDER BY id").all(),
    ).toEqual([{ id: 2 }]);
    expect(writes).toBe(3);
  });
});
