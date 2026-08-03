import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
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
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('owner', 'owner', 'hash'), ('recipient', 'recipient', 'hash');
      INSERT INTO ssh_data (id, user_id, ip, port, username, auth_type)
      VALUES (42, 'owner', '10.0.0.1', 22, 'root', 'password');
      INSERT INTO ssh_credentials (id, user_id, name, auth_type)
      VALUES (7, 'recipient', 'cred-seven', 'password'),
        (8, 'recipient', 'cred-eight', 'password');
    `);

    return {
      repository: new SharedHostAuthOverrideRepository(context, onWrite),
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
    const { repository } = await createRepository();

    await repository.setCredential(42, "recipient", "ssh", 7);
    await adapter!.run(sql`DELETE FROM ssh_credentials WHERE id = 7`);
    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBeNull();

    await adapter!.run(
      sql`INSERT INTO ssh_credentials (id, user_id, name, auth_type)
          VALUES (7, 'recipient', 'cred-seven', 'password')`,
    );
    await repository.setCredential(42, "recipient", "ssh", 7);
    await adapter!.run(sql`DELETE FROM ssh_data WHERE id = 42`);
    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBeNull();

    await adapter!.run(
      sql`INSERT INTO ssh_data (id, user_id, ip, port, username, auth_type)
          VALUES (42, 'owner', '10.0.0.1', 22, 'root', 'password')`,
    );
    await repository.setCredential(42, "recipient", "ssh", 7);
    await adapter!.run(sql`DELETE FROM users WHERE id = 'recipient'`);
    await expect(
      repository.findCredentialId(42, "recipient", "ssh"),
    ).resolves.toBeNull();
  });
});
