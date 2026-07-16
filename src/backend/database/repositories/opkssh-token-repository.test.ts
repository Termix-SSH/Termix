import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { OpksshTokenRepository } from "./opkssh-token-repository.js";

describe("OpksshTokenRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<OpksshTokenRepository> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE hosts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL
      );

      CREATE TABLE opkssh_tokens (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        host_id INTEGER NOT NULL,
        ssh_cert TEXT NOT NULL,
        private_key TEXT NOT NULL,
        email TEXT,
        sub TEXT,
        issuer TEXT,
        audience TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT NOT NULL,
        last_used TEXT,
        UNIQUE(user_id, host_id)
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO hosts (id, user_id, name)
      VALUES (1, 'user-1', 'one'), (2, 'user-1', 'two'), (3, 'user-2', 'other');
      INSERT INTO opkssh_tokens (
        user_id, host_id, ssh_cert, private_key, email, expires_at
      )
      VALUES
        ('user-1', 1, 'cert-1', 'key-1', 'alice@example.com', '2099-01-01T00:00:00.000Z'),
        ('user-1', 2, 'cert-2', 'key-2', 'alice2@example.com', '2099-01-01T00:00:00.000Z'),
        ('user-2', 3, 'cert-3', 'key-3', 'bob@example.com', '2099-01-01T00:00:00.000Z');
    `);

    return new OpksshTokenRepository(context, onWrite);
  }

  it("finds and upserts a token by user and host", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const existing = await repo.findByUserAndHost("user-1", 1);
    expect(existing?.sshCert).toBe("cert-1");

    await repo.upsert({
      userId: "user-1",
      hostId: 1,
      sshCert: "new-cert",
      privateKey: "new-key",
      email: "new@example.com",
      sub: "sub",
      issuer: "issuer",
      audience: "aud",
      expiresAt: "2099-02-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    const updated = await repo.findByUserAndHost("user-1", 1);
    expect(updated).toMatchObject({
      sshCert: "new-cert",
      privateKey: "new-key",
      email: "new@example.com",
      sub: "sub",
      issuer: "issuer",
      audience: "aud",
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
    expect((await repo.findByUserAndHost("user-1", 1))?.lastUsed).toBe(
      "2026-01-02T00:00:00.000Z",
    );

    expect(await repo.deleteByUserAndHost("user-1", 1)).toBe(true);
    expect(await repo.deleteByUserAndHost("user-1", 1)).toBe(false);
    expect(await repo.findByUserAndHost("user-1", 1)).toBeNull();
    expect(writeCount).toBe(2);
  });

  it("deletes tokens by user id", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(await repo.deleteByUserId("user-1")).toBe(2);
    expect(await repo.deleteByUserId("user-1")).toBe(0);
    expect(await repo.findByUserAndHost("user-1", 1)).toBeNull();
    expect(await repo.findByUserAndHost("user-2", 3)).not.toBeNull();
    expect(writeCount).toBe(1);
  });
});
