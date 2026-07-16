import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { VaultTokenRepository } from "./vault-token-repository.js";

describe("VaultTokenRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<VaultTokenRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE vault_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE vault_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        profile_id INTEGER NOT NULL,
        ssh_cert TEXT NOT NULL,
        private_key TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        last_used TEXT,
        UNIQUE(user_id, profile_id)
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO vault_profiles (id, user_id, name)
      VALUES (1, 'user-1', 'one'), (2, 'user-2', 'two');
      INSERT INTO vault_tokens (
        user_id, profile_id, ssh_cert, private_key, expires_at
      )
      VALUES
        ('user-1', 1, 'cert-1', 'key-1', '2099-01-01T00:00:00.000Z'),
        ('user-2', 2, 'cert-2', 'key-2', '2099-01-01T00:00:00.000Z');
    `);

    return new VaultTokenRepository(context, onWrite);
  }

  it("finds and upserts a token by user and profile", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const existing = await repo.findByUserAndProfile("user-1", 1);
    expect(existing?.sshCert).toBe("cert-1");

    await repo.upsert({
      userId: "user-1",
      profileId: 1,
      sshCert: "new-cert",
      privateKey: "new-key",
      expiresAt: "2099-02-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const updated = await repo.findByUserAndProfile("user-1", 1);
    expect(updated).toMatchObject({
      sshCert: "new-cert",
      privateKey: "new-key",
      expiresAt: "2099-02-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(writeCount).toBe(1);
  });

  it("updates last-used and deletes one token", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(
      await repo.updateLastUsed("user-1", 1, "2026-01-02T00:00:00.000Z"),
    ).toBe(true);
    expect(await repo.updateLastUsed("missing", 1)).toBe(false);
    expect((await repo.findByUserAndProfile("user-1", 1))?.lastUsed).toBe(
      "2026-01-02T00:00:00.000Z",
    );

    expect(await repo.deleteByUserAndProfile("user-1", 1)).toBe(true);
    expect(await repo.deleteByUserAndProfile("user-1", 1)).toBe(false);
    expect(await repo.findByUserAndProfile("user-1", 1)).toBeNull();
    expect(await repo.findByUserAndProfile("user-2", 2)).not.toBeNull();
    expect(writeCount).toBe(2);
  });

  it("deletes all tokens for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsert({
      userId: "user-1",
      profileId: 2,
      sshCert: "cert-extra",
      privateKey: "key-extra",
      expiresAt: "2099-03-01T00:00:00.000Z",
    });

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(2);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repo.findByUserAndProfile("user-1", 1)).toBeNull();
    expect(await repo.findByUserAndProfile("user-1", 2)).toBeNull();
    expect(await repo.findByUserAndProfile("user-2", 2)).not.toBeNull();
    expect(writeCount).toBe(2);
  });
});
