import { afterEach, describe, expect, it } from "vitest";
import { SharedHostAuthOverrideRepository } from "../../../database/repositories/shared-host-auth-override-repository.js";
import { TestSqliteDatabase } from "./test-support.js";

describe("SharedHostAuthOverrideRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    await adapter?.close();
    adapter = null;
  });

  async function createRepository(onWrite?: () => void) {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite!.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );
      CREATE TABLE ssh_data (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL
      );
      CREATE TABLE ssh_credentials (
        id INTEGER PRIMARY KEY,
        user_id TEXT NOT NULL
      );
      CREATE TABLE shared_host_auth_overrides (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        host_id INTEGER NOT NULL,
        user_id TEXT NOT NULL,
        protocol TEXT NOT NULL DEFAULT 'ssh',
        credential_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(host_id, user_id, protocol),
        FOREIGN KEY (host_id) REFERENCES ssh_data(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (credential_id) REFERENCES ssh_credentials(id) ON DELETE CASCADE
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('owner', 'owner', 'hash'), ('recipient', 'recipient', 'hash');
      INSERT INTO ssh_data (id, user_id) VALUES (42, 'owner');
      INSERT INTO ssh_credentials (id, user_id)
      VALUES (7, 'recipient'), (8, 'recipient');
    `);

    return {
      repository: new SharedHostAuthOverrideRepository(context, onWrite),
      sqlite: context.sqlite!,
    };
  }

  it("creates, reads, updates and clears overrides by host, user, and protocol", async () => {
    let writeCount = 0;
    const { repository } = await createRepository(() => {
      writeCount += 1;
    });

    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBeNull();

    await repository.setCredential(42, "recipient", "ssh", 7);
    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBe(7);

    await repository.setCredential(42, "recipient", "ssh", 8);
    await repository.setCredential(42, "recipient", "rdp", 7);
    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBe(8);
    await expect(
      repository.findCredentialId(42, "recipient", "rdp"),
    ).resolves.toBe(7);

    await expect(
      repository.clearCredential(42, "recipient", "ssh"),
    ).resolves.toBe(true);
    await expect(
      repository.clearCredential(42, "recipient", "ssh"),
    ).resolves.toBe(false);
    await expect(
      repository.findCredentialId(42, "recipient", "rdp"),
    ).resolves.toBe(7);
    expect(writeCount).toBe(4);
  });

  it("removes overrides when the host, user, or credential is deleted", async () => {
    const { repository, sqlite } = await createRepository();

    await repository.setCredential(42, "recipient", "ssh", 7);
    sqlite.prepare("DELETE FROM ssh_credentials WHERE id = ?").run(7);
    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBeNull();

    sqlite
      .prepare("INSERT INTO ssh_credentials (id, user_id) VALUES (?, ?)")
      .run(7, "recipient");
    await repository.setCredential(42, "recipient", "ssh", 7);
    sqlite.prepare("DELETE FROM ssh_data WHERE id = ?").run(42);
    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBeNull();

    sqlite
      .prepare("INSERT INTO ssh_data (id, user_id) VALUES (?, ?)")
      .run(42, "owner");
    await repository.setCredential(42, "recipient", "ssh", 7);
    sqlite.prepare("DELETE FROM users WHERE id = ?").run("recipient");
    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBeNull();
  });
});
