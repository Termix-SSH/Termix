import { afterEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import {
  folderAndParents,
  SharedFolderAuthOverrideRepository,
} from "../../../database/repositories/shared-folder-auth-override-repository.js";
import { TestSqliteDatabase } from "./test-support.js";

describe("folderAndParents", () => {
  it("lists the folder, then each folder above it", () => {
    expect(folderAndParents("Prod / Web / EU")).toEqual([
      "Prod / Web / EU",
      "Prod / Web",
      "Prod",
    ]);
    expect(folderAndParents(" Prod ")).toEqual(["Prod"]);
    expect(folderAndParents("")).toEqual([]);
    expect(folderAndParents(null)).toEqual([]);
  });
});

describe("SharedFolderAuthOverrideRepository", () => {
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
      VALUES ('recipient', 'recipient', 'hash'), ('other', 'other', 'hash');
      INSERT INTO ssh_credentials (id, user_id, name, auth_type)
      VALUES (7, 'recipient', 'cred-seven', 'password'),
        (8, 'recipient', 'cred-eight', 'password');
    `);
    return new SharedFolderAuthOverrideRepository(context, onWrite);
  }

  it("sets, updates and clears a login per user, folder and protocol", async () => {
    let writes = 0;
    const repository = await createRepository(() => {
      writes += 1;
    });

    await repository.setCredential("recipient", "Prod", "ssh", 7);
    await repository.setCredential("recipient", "Prod", "ssh", 8);
    await repository.setCredential("recipient", "Prod", "rdp", 7);
    await expect(
      repository.findCredentialId("recipient", "Prod", "ssh"),
    ).resolves.toBe(8);
    await expect(
      repository.findCredentialId("other", "Prod", "ssh"),
    ).resolves.toBeNull();

    await expect(
      repository.clearCredential("recipient", "Prod", "ssh"),
    ).resolves.toBe(true);
    await expect(
      repository.clearCredential("recipient", "Prod", "ssh"),
    ).resolves.toBe(false);
    expect(writes).toBe(4);
  });

  it("finds the login of the closest folder above a host", async () => {
    const repository = await createRepository();
    await repository.setCredential("recipient", "Prod", "ssh", 7);
    await repository.setCredential("recipient", "Prod / Web", "ssh", 8);

    await expect(
      repository.findClosest("recipient", "Prod / Web / EU", "ssh"),
    ).resolves.toEqual({ folder: "Prod / Web", credentialId: 8 });
    await expect(
      repository.findClosest("recipient", "Prod / DB", "ssh"),
    ).resolves.toEqual({ folder: "Prod", credentialId: 7 });
    await expect(
      repository.findClosest("recipient", "Staging", "ssh"),
    ).resolves.toBeNull();
    await expect(
      repository.findClosest("recipient", "Prod", "rdp"),
    ).resolves.toBeNull();
    await expect(
      repository.findClosest("recipient", null, "ssh"),
    ).resolves.toBeNull();
  });

  it("drops the login when its credential is deleted", async () => {
    const repository = await createRepository();
    await repository.setCredential("recipient", "Prod", "ssh", 7);
    await adapter!.run(sql`DELETE FROM ssh_credentials WHERE id = 7`);
    await expect(
      repository.findCredentialId("recipient", "Prod", "ssh"),
    ).resolves.toBeNull();
  });
});
