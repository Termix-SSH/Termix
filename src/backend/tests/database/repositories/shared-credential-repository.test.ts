import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { SharedCredentialRepository } from "../../../database/repositories/shared-credential-repository.js";

describe("SharedCredentialRepository", () => {
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
    repository: SharedCredentialRepository;
    sqlite: NonNullable<
      Awaited<ReturnType<TestSqliteDatabase["connect"]>>["sqlite"]
    >;
  }> {
    adapter = new TestSqliteDatabase();
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
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO shared_credentials (
        id,
        host_access_id,
        original_credential_id,
        target_user_id,
        encrypted_username,
        encrypted_auth_type,
        encrypted_password
      )
      VALUES
        (1, 10, 100, 'user-1', 'u1', 'password', 'p1'),
        (2, 10, 100, 'user-2', 'u2', 'password', 'p2'),
        (3, 11, 101, 'user-2', 'u3', 'key', NULL);
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
      repository.updateById(2, {
        encryptedPassword: "updated",
      }),
    ).resolves.toMatchObject({
      encryptedPassword: "updated",
    });
    expect(writes).toBe(1);
  });

  it("deletes shared credentials", async () => {
    let writes = 0;
    const { repository, sqlite } = await createRepository(() => {
      writes += 1;
    });

    await expect(repository.deleteById(1)).resolves.toBe(true);
    await expect(repository.deleteById(999)).resolves.toBe(false);
    await expect(repository.deleteByTargetUserId("user-2")).resolves.toBe(2);
    await expect(repository.deleteByOriginalCredentialId(100)).resolves.toBe(0);

    expect(
      sqlite.prepare("SELECT id FROM shared_credentials ORDER BY id").all(),
    ).toEqual([]);
    expect(writes).toBe(2);
  });
});
