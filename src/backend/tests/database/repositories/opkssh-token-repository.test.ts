import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { OpksshTokenRepository } from "../../../database/repositories/opkssh-token-repository.js";

describe("OpksshTokenRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<OpksshTokenRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'password'), (2, 'user-1', 'two', '10.0.0.1', 22, 'root', 'password'), (3, 'user-2', 'other', '10.0.0.1', 22, 'root', 'password');
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
