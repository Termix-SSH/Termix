import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { CredentialRepository } from "../../../database/repositories/credential-repository.js";
import { HostRepository } from "../../../database/repositories/host-repository.js";
import { DataCrypto } from "../../../utils/data-crypto.js";

describe("HostRepository and CredentialRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    vi.restoreAllMocks();
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepositories(
    onCredentialWrite?: () => void,
    onHostWrite?: () => void,
  ): Promise<{
    credentials: CredentialRepository;
    hosts: HostRepository;
  }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash) VALUES
        ('user-1', 'user', 'hash'),
        ('user-2', 'other', 'hash');
    `);

    return {
      credentials: new CredentialRepository(context, onCredentialWrite),
      hosts: new HostRepository(context, onHostWrite),
    };
  }

  it("creates, finds, updates, lists, and deletes credentials", async () => {
    const repo = await createRepositories();

    const created = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
      password: "secret",
      folder: "prod",
    });

    expect(created.id).toBeGreaterThan(0);
    expect(await repo.credentials.listFolders("user-1")).toEqual(["prod"]);
    expect(
      (await repo.credentials.findByIdForUser("user-1", created.id))?.name,
    ).toBe("primary");
    expect((await repo.credentials.findById(created.id))?.name).toBe("primary");

    // Backdate updated_at so the update's CURRENT_TIMESTAMP bump is
    // deterministically observable regardless of clock resolution --
    // the sync engine's last-write-wins conflict resolution depends on
    // every mutating update actually advancing this column.
    await adapter!.run(
      sql`UPDATE ssh_credentials SET updated_at = ${"2000-01-01 00:00:00"} WHERE id = ${created.id}`,
    );

    const updated = await repo.credentials.updateForUser("user-1", created.id, {
      folder: "ops",
      tags: "linux,admin",
    });
    expect(updated?.folder).toBe("ops");
    expect(updated?.updatedAt).not.toBe("2000-01-01 00:00:00");

    expect(
      await repo.credentials.findByIdForUser("user-2", created.id),
    ).toBeNull();
    expect(await repo.credentials.deleteForUser("user-1", created.id)).toEqual({
      syncId: expect.any(String),
    });
    expect(
      await repo.credentials.findByIdForUser("user-1", created.id),
    ).toBeNull();
  });

  it("deletes user credentials through the cleanup boundary", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(onWrite);

    await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
    });
    await repo.credentials.create({
      userId: "user-1",
      name: "secondary",
      authType: "key",
    });
    await repo.credentials.create({
      userId: "user-2",
      name: "other",
      authType: "password",
    });
    onWrite.mockClear();

    await expect(repo.credentials.deleteByUserId("user-1")).resolves.toBe(2);

    expect(await repo.credentials.listByUserId("user-1")).toEqual([]);
    expect((await repo.credentials.listByUserId("user-2")).length).toBe(1);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("loads credentials through the decryption boundary", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "decryptRecords").mockImplementation(
      (_tableName, records) => records,
    );
    vi.spyOn(DataCrypto, "decryptRecord").mockImplementation(
      (_tableName, record) => record,
    );

    const created = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
      password: "secret",
      folder: "prod",
    });

    await expect(
      repo.credentials.listDecryptedByUserId("user-1"),
    ).resolves.toMatchObject([{ id: created.id, password: "secret" }]);
    await expect(
      repo.credentials.findDecryptedByIdForUser("user-1", created.id),
    ).resolves.toMatchObject({ id: created.id, password: "secret" });
    expect(DataCrypto.decryptRecords).toHaveBeenCalledWith(
      "ssh_credentials",
      expect.arrayContaining([expect.objectContaining({ id: created.id })]),
      "user-1",
      Buffer.from("user-key"),
    );
    expect(DataCrypto.decryptRecord).toHaveBeenCalledWith(
      "ssh_credentials",
      expect.objectContaining({ id: created.id }),
      "user-1",
      Buffer.from("user-key"),
    );
  });

  it("encrypts credential writes with the user key", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "validateUserAccess").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "encryptRecord").mockImplementation(
      (_tableName, record) =>
        ({
          ...record,
          password: "user-encrypted-password",
        }) as typeof record,
    );
    vi.spyOn(DataCrypto, "decryptRecord").mockImplementation(
      (_tableName, record) => record,
    );

    const created = await repo.credentials.createEncryptedForUser("user-1", {
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
      password: "secret",
    });

    const raw = (
      await adapter!.query(
        sql`SELECT password FROM ssh_credentials WHERE id = ${created.id}`,
      )
    )[0] as { password: string };

    expect(raw.password).toBe("user-encrypted-password");

    await adapter!.run(
      sql`UPDATE ssh_credentials SET updated_at = ${"2000-01-01 00:00:00"} WHERE id = ${created.id}`,
    );

    await repo.credentials.updateEncryptedForUser("user-1", created.id, {
      password: "updated-secret",
    });

    const updatedRaw = (
      await adapter!.query(
        sql`SELECT password, updated_at FROM ssh_credentials WHERE id = ${created.id}`,
      )
    )[0] as { password: string; updated_at: string };

    expect(updatedRaw.password).toBe("user-encrypted-password");
    expect(updatedRaw.updated_at).not.toBe("2000-01-01 00:00:00");
    expect(DataCrypto.encryptRecord).toHaveBeenCalledWith(
      "ssh_credentials",
      expect.objectContaining({ password: "updated-secret" }),
      "user-1",
      Buffer.from("user-key"),
    );
  });

  it("checks credential import identity", async () => {
    const repo = await createRepositories();

    await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
    });

    await expect(
      repo.credentials.existsForImportIdentity("user-1", "primary", "root"),
    ).resolves.toBe(true);
    await expect(
      repo.credentials.existsForImportIdentity("user-1", "primary", "admin"),
    ).resolves.toBe(false);
  });

  it("renames credential folders through the write boundary", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(onWrite);

    const primary = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      folder: "prod",
    });
    await repo.credentials.create({
      userId: "user-1",
      name: "secondary",
      authType: "key",
      folder: "prod",
    });
    await repo.credentials.create({
      userId: "user-2",
      name: "other",
      authType: "password",
      folder: "prod",
    });
    await adapter!.run(
      sql`UPDATE ssh_credentials SET updated_at = ${"2000-01-01 00:00:00"} WHERE id = ${primary.id}`,
    );
    onWrite.mockClear();

    await expect(
      repo.credentials.renameFolder("user-1", "prod", "ops"),
    ).resolves.toBe(2);

    expect(await repo.credentials.listFolders("user-1")).toEqual(["ops"]);
    expect(await repo.credentials.listFolders("user-2")).toEqual(["prod"]);
    expect(onWrite).toHaveBeenCalledTimes(1);

    const renamedRow = (
      await adapter!.query(
        sql`SELECT updated_at FROM ssh_credentials WHERE id = ${primary.id}`,
      )
    )[0] as { updated_at: string };
    expect(renamedRow.updated_at).not.toBe("2000-01-01 00:00:00");
  });

  it("returns empty credential reads when user data is locked", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(null);

    const created = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
      username: "root",
      password: "secret",
    });

    await expect(
      repo.credentials.listDecryptedByUserId("user-1"),
    ).resolves.toEqual([]);
    await expect(
      repo.credentials.findDecryptedByIdForUser("user-1", created.id),
    ).resolves.toBeNull();
  });

  it("creates, finds, updates, lists, and deletes hosts", async () => {
    const repo = await createRepositories();

    const host = await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
    });

    expect(host.id).toBeGreaterThan(0);
    expect((await repo.hosts.findById(host.id))?.name).toBe("web-1");
    expect(
      (await repo.hosts.listByUserId("user-1")).map((item) => item.id),
    ).toEqual([host.id]);

    await adapter!.run(
      sql`UPDATE ssh_data SET updated_at = ${"2000-01-01 00:00:00"} WHERE id = ${host.id}`,
    );

    const updated = await repo.hosts.updateForUser("user-1", host.id, {
      name: "web-1-renamed",
      folder: "prod",
    });
    expect(updated?.name).toBe("web-1-renamed");
    expect(updated?.updatedAt).not.toBe("2000-01-01 00:00:00");
    expect(await repo.hosts.findByIdForUser("user-2", host.id)).toBeNull();

    expect(await repo.hosts.deleteForUser("user-1", host.id)).toEqual({
      syncId: expect.any(String),
    });
    expect(await repo.hosts.findById(host.id)).toBeNull();
  });

  it("encrypts host writes through the repository boundary", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "validateUserAccess").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "encryptRecord").mockImplementation(
      (_tableName, record) =>
        ({
          ...record,
          password: "encrypted-host-password",
        }) as typeof record,
    );
    vi.spyOn(DataCrypto, "decryptRecord").mockImplementation(
      (_tableName, record) => record,
    );

    const created = await repo.hosts.createEncryptedForUser("user-1", {
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
      password: "secret",
    });

    const raw = (
      await adapter!.query(
        sql`SELECT password FROM ssh_data WHERE id = ${created.id}`,
      )
    )[0] as { password: string };

    expect(raw.password).toBe("encrypted-host-password");

    await adapter!.run(
      sql`UPDATE ssh_data SET updated_at = ${"2000-01-01 00:00:00"} WHERE id = ${created.id}`,
    );

    await repo.hosts.updateEncryptedForUser("user-1", created.id, {
      password: "updated-secret",
    });

    const updatedRaw = (
      await adapter!.query(
        sql`SELECT password, updated_at FROM ssh_data WHERE id = ${created.id}`,
      )
    )[0] as { password: string; updated_at: string };

    expect(updatedRaw.password).toBe("encrypted-host-password");
    expect(updatedRaw.updated_at).not.toBe("2000-01-01 00:00:00");
    expect(DataCrypto.encryptRecord).toHaveBeenCalledWith(
      "ssh_data",
      expect.objectContaining({ password: "updated-secret" }),
      "user-1",
      Buffer.from("user-key"),
    );
  });

  it("loads hosts through the decryption boundary", async () => {
    const repo = await createRepositories();
    vi.spyOn(DataCrypto, "getUserDataKey").mockReturnValue(
      Buffer.from("user-key"),
    );
    vi.spyOn(DataCrypto, "decryptRecords").mockImplementation(
      (_tableName, records) => records,
    );

    const host = await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
      password: "secret",
    });

    await expect(
      repo.hosts.listDecryptedByUserId("user-1"),
    ).resolves.toMatchObject([{ id: host.id, password: "secret" }]);
    expect(DataCrypto.decryptRecords).toHaveBeenCalledWith(
      "ssh_data",
      expect.arrayContaining([expect.objectContaining({ id: host.id })]),
      "user-1",
      Buffer.from("user-key"),
    );
  });

  it("checks host import identity", async () => {
    const repo = await createRepositories();

    await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
    });

    await expect(
      repo.hosts.existsForImportIdentity("user-1", "10.0.0.10", 22, "root"),
    ).resolves.toBe(true);
    await expect(
      repo.hosts.existsForImportIdentity("user-1", "10.0.0.10", 2222, "root"),
    ).resolves.toBe(false);
  });

  it("deletes user hosts through the cleanup boundary", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(undefined, onWrite);

    await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
    });
    await repo.hosts.create({
      userId: "user-1",
      name: "web-2",
      ip: "10.0.0.11",
      port: 22,
      username: "root",
      authType: "password",
    });
    await repo.hosts.create({
      userId: "user-2",
      name: "other",
      ip: "10.0.0.12",
      port: 22,
      username: "root",
      authType: "password",
    });
    onWrite.mockClear();

    await expect(repo.hosts.deleteByUserId("user-1")).resolves.toBe(2);

    expect(await repo.hosts.listByUserId("user-1")).toEqual([]);
    expect((await repo.hosts.listByUserId("user-2")).length).toBe(1);
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("lists bulk update state and updates multiple owned hosts", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(undefined, onWrite);

    const first = await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "password",
      statsConfig: JSON.stringify({ cpu: true }),
    });
    const second = await repo.hosts.create({
      userId: "user-1",
      name: "web-2",
      ip: "10.0.0.11",
      port: 22,
      username: "root",
      authType: "password",
    });
    const other = await repo.hosts.create({
      userId: "user-2",
      name: "other",
      ip: "10.0.0.12",
      port: 22,
      username: "root",
      authType: "password",
    });
    await adapter!.run(
      sql`UPDATE ssh_data SET updated_at = ${"2000-01-01 00:00:00"} WHERE id IN (${first.id}, ${second.id})`,
    );
    onWrite.mockClear();

    const states = await repo.hosts.listBulkUpdateState("user-1", [
      first.id,
      second.id,
      other.id,
    ]);
    expect(states.map((state) => state.id)).toEqual([first.id, second.id]);

    await expect(
      repo.hosts.updateManyForUser("user-1", [first.id, second.id, other.id], {
        folder: "ops",
      }),
    ).resolves.toBe(2);
    expect((await repo.hosts.findById(first.id))?.folder).toBe("ops");
    expect((await repo.hosts.findById(other.id))?.folder).toBeNull();
    expect(onWrite).toHaveBeenCalledTimes(1);
    expect((await repo.hosts.findById(first.id))?.updatedAt).not.toBe(
      "2000-01-01 00:00:00",
    );
    expect((await repo.hosts.findById(second.id))?.updatedAt).not.toBe(
      "2000-01-01 00:00:00",
    );
  });

  it("records credential usage and increments usage counters", async () => {
    const repo = await createRepositories();
    const credential = await repo.credentials.create({
      userId: "user-1",
      name: "primary",
      authType: "password",
    });
    const host = await repo.hosts.create({
      userId: "user-1",
      name: "web-1",
      ip: "10.0.0.10",
      port: 22,
      username: "root",
      authType: "credential",
      credentialId: credential.id,
    });

    await repo.credentials.recordUsage(
      "user-1",
      credential.id,
      host.id,
      "2026-06-26T00:00:00.000Z",
    );

    const updated = await repo.credentials.findByIdForUser(
      "user-1",
      credential.id,
    );
    expect(updated?.usageCount).toBe(1);
    expect(updated?.lastUsed).toBe("2026-06-26T00:00:00.000Z");
  });

  it("sets a distinct sortOrder per credential via reorderForUser", async () => {
    const onWrite = vi.fn();
    const repo = await createRepositories(onWrite);

    const first = await repo.credentials.create({
      userId: "user-1",
      name: "one",
      authType: "password",
    });
    const second = await repo.credentials.create({
      userId: "user-1",
      name: "two",
      authType: "password",
    });
    onWrite.mockClear();

    const updated = await repo.credentials.reorderForUser("user-1", [
      { id: first.id, sortOrder: 2000 },
      { id: second.id, sortOrder: 1000 },
    ]);
    expect(updated).toBe(2);
    expect(onWrite).toHaveBeenCalledTimes(1);

    expect(
      await adapter!.query(
        sql`SELECT id, sort_order FROM ssh_credentials WHERE user_id = 'user-1' ORDER BY id`,
      ),
    ).toEqual([
      { id: first.id, sort_order: 2000 },
      { id: second.id, sort_order: 1000 },
    ]);
  });

  it("ignores credential ids the user does not own when reordering", async () => {
    const repo = await createRepositories();

    const other = await repo.credentials.create({
      userId: "user-2",
      name: "other",
      authType: "password",
    });

    const updated = await repo.credentials.reorderForUser("user-1", [
      { id: other.id, sortOrder: 5000 },
    ]);
    expect(updated).toBe(0);

    expect(
      await adapter!.query(
        sql`SELECT sort_order FROM ssh_credentials WHERE id = ${other.id}`,
      ),
    ).toEqual([{ sort_order: null }]);
  });

  it("no-ops reorderForUser on an empty positions array", async () => {
    const repo = await createRepositories();
    await expect(repo.credentials.reorderForUser("user-1", [])).resolves.toBe(
      0,
    );
  });

  it("cleans host access before deleting a host", async () => {
    const repo = await createRepositories();
    const host = await repo.hosts.create({
      userId: "user-1",
      name: "shared-host",
      ip: "10.0.0.20",
      port: 22,
      username: "root",
      authType: "password",
    });

    await adapter!.run(
      sql`INSERT INTO host_access (host_id, user_id, granted_by) VALUES (${host.id}, ${"user-2"}, ${"user-1"})`,
    );

    expect(await repo.hosts.deleteAccessForHost(host.id)).toBe(1);
    expect(await repo.hosts.deleteForUser("user-1", host.id)).toEqual({
      syncId: expect.any(String),
    });
  });
});
