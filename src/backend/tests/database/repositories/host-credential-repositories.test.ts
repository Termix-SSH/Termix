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
    sqlite: NonNullable<
      Awaited<ReturnType<TestSqliteDatabase["connect"]>>["sqlite"]
    >;
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
      get sqlite() {
        return adapter!.raw;
      },
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
    repo.sqlite
      .prepare("UPDATE ssh_credentials SET updated_at = ? WHERE id = ?")
      .run("2000-01-01 00:00:00", created.id);

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

    const raw = repo.sqlite
      .prepare("SELECT password FROM ssh_credentials WHERE id = ?")
      .get(created.id) as { password: string };

    expect(raw.password).toBe("user-encrypted-password");

    repo.sqlite
      .prepare("UPDATE ssh_credentials SET updated_at = ? WHERE id = ?")
      .run("2000-01-01 00:00:00", created.id);

    await repo.credentials.updateEncryptedForUser("user-1", created.id, {
      password: "updated-secret",
    });

    const updatedRaw = repo.sqlite
      .prepare("SELECT password, updated_at FROM ssh_credentials WHERE id = ?")
      .get(created.id) as { password: string; updated_at: string };

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
    repo.sqlite
      .prepare("UPDATE ssh_credentials SET updated_at = ? WHERE id = ?")
      .run("2000-01-01 00:00:00", primary.id);
    onWrite.mockClear();

    await expect(
      repo.credentials.renameFolder("user-1", "prod", "ops"),
    ).resolves.toBe(2);

    expect(await repo.credentials.listFolders("user-1")).toEqual(["ops"]);
    expect(await repo.credentials.listFolders("user-2")).toEqual(["prod"]);
    expect(onWrite).toHaveBeenCalledTimes(1);

    const renamedRow = repo.sqlite
      .prepare("SELECT updated_at FROM ssh_credentials WHERE id = ?")
      .get(primary.id) as { updated_at: string };
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

    repo.sqlite
      .prepare("UPDATE ssh_data SET updated_at = ? WHERE id = ?")
      .run("2000-01-01 00:00:00", host.id);

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

    const raw = repo.sqlite
      .prepare("SELECT password FROM ssh_data WHERE id = ?")
      .get(created.id) as { password: string };

    expect(raw.password).toBe("encrypted-host-password");

    repo.sqlite
      .prepare("UPDATE ssh_data SET updated_at = ? WHERE id = ?")
      .run("2000-01-01 00:00:00", created.id);

    await repo.hosts.updateEncryptedForUser("user-1", created.id, {
      password: "updated-secret",
    });

    const updatedRaw = repo.sqlite
      .prepare("SELECT password, updated_at FROM ssh_data WHERE id = ?")
      .get(created.id) as { password: string; updated_at: string };

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
    repo.sqlite
      .prepare("UPDATE ssh_data SET updated_at = ? WHERE id IN (?, ?)")
      .run("2000-01-01 00:00:00", first.id, second.id);
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

    repo.sqlite
      .prepare(
        "INSERT INTO host_access (host_id, user_id, granted_by) VALUES (?, ?, ?)",
      )
      .run(host.id, "user-2", "user-1");

    expect(await repo.hosts.deleteAccessForHost(host.id)).toBe(1);
    expect(await repo.hosts.deleteForUser("user-1", host.id)).toEqual({
      syncId: expect.any(String),
    });
  });
});
