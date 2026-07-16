import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { ApiKeyRepository } from "./api-key-repository.js";

describe("ApiKeyRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(onWrite?: () => void): Promise<{
    apiKeys: ApiKeyRepository;
  }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE api_keys (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        token_prefix TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        last_used_at TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      INSERT INTO users (id, username, password_hash) VALUES
        ('user-1', 'admin', 'hash'),
        ('user-2', 'target', 'hash');
    `);

    return {
      apiKeys: new ApiKeyRepository(context, onWrite),
    };
  }

  it("creates, lists, finds, updates last used time, and deletes keys", async () => {
    const repo = await createRepository();

    await repo.apiKeys.create({
      id: "key-1",
      userId: "user-2",
      name: "deploy",
      tokenHash: "hash",
      tokenPrefix: "tmx_12345678",
      createdAt: "2026-06-26T00:00:00.000Z",
      expiresAt: null,
      lastUsedAt: null,
      isActive: true,
    });

    expect((await repo.apiKeys.findById("key-1"))?.name).toBe("deploy");
    expect(
      (await repo.apiKeys.listActiveByTokenPrefix("tmx_12345678")).map(
        (key) => key.id,
      ),
    ).toEqual(["key-1"]);
    expect(await repo.apiKeys.listAllWithUsers()).toMatchObject([
      {
        id: "key-1",
        userId: "user-2",
        username: "target",
        tokenPrefix: "tmx_12345678",
      },
    ]);

    await repo.apiKeys.updateLastUsedAt("key-1", "2026-06-26T01:00:00.000Z");
    expect((await repo.apiKeys.findById("key-1"))?.lastUsedAt).toBe(
      "2026-06-26T01:00:00.000Z",
    );

    expect((await repo.apiKeys.delete("key-1"))?.name).toBe("deploy");
    expect(await repo.apiKeys.findById("key-1")).toBeNull();
  });

  it("runs the write hook after key writes", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.apiKeys.create({
      id: "key-1",
      userId: "user-1",
      name: "ops",
      tokenHash: "hash",
      tokenPrefix: "tmx_87654321",
      isActive: true,
    });
    await repo.apiKeys.updateLastUsedAt("key-1", "2026-06-26T01:00:00.000Z");
    await repo.apiKeys.delete("key-1");

    expect(writeCount).toBe(3);
  });

  it("deletes all API keys for a user", async () => {
    const repo = await createRepository();

    await repo.apiKeys.create({
      id: "key-1",
      userId: "user-2",
      name: "deploy",
      tokenHash: "hash-1",
      tokenPrefix: "tmx_11111111",
      isActive: true,
    });
    await repo.apiKeys.create({
      id: "key-2",
      userId: "user-2",
      name: "ops",
      tokenHash: "hash-2",
      tokenPrefix: "tmx_22222222",
      isActive: true,
    });
    await repo.apiKeys.create({
      id: "key-3",
      userId: "user-1",
      name: "admin",
      tokenHash: "hash-3",
      tokenPrefix: "tmx_33333333",
      isActive: true,
    });

    await expect(repo.apiKeys.deleteByUserId("user-2")).resolves.toBe(2);

    expect(await repo.apiKeys.findById("key-1")).toBeNull();
    expect(await repo.apiKeys.findById("key-2")).toBeNull();
    expect((await repo.apiKeys.findById("key-3"))?.userId).toBe("user-1");
  });
});
