import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HostFolderRepository } from "../../../database/repositories/host-folder-repository.js";

describe("HostFolderRepository", () => {
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
    repository: HostFolderRepository;
    sqlite: NonNullable<
      Awaited<ReturnType<TestSqliteDatabase["connect"]>>["sqlite"]
    >;
  }> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_credentials (id, user_id, name, folder, auth_type, username)
      VALUES (1, 'user-1', 'cred-one', 'prod', 'password', 'root'),
        (2, 'user-1', 'cred-two', 'prod / api', 'password', 'root'),
        (3, 'user-2', 'cred-other', 'prod', 'password', 'root');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, folder, auth_type)
      VALUES
        (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'prod', 'password'),
        (2, 'user-1', 'two', '10.0.0.2', 22, 'root', 'prod / api', 'password'),
        (3, 'user-2', 'other', '10.0.0.3', 22, 'root', 'prod', 'password');
      INSERT INTO ssh_folders (id, user_id, name, color, icon)
      VALUES
        (1, 'user-1', 'prod', '#111111', 'server'),
        (2, 'user-1', 'prod / api', '#222222', 'box'),
        (3, 'user-2', 'prod', '#333333', 'user');
    `);

    return {
      repository: new HostFolderRepository(context, onWrite),
      get sqlite() {
        return adapter!.raw;
      },
    };
  }

  it("renames folders across hosts, credentials, and folder records", async () => {
    let writes = 0;
    const { repository, sqlite } = await createRepository(() => {
      writes += 1;
    });

    await expect(
      repository.renameFolder(
        "user-1",
        "prod",
        "ops",
        "2026-01-01T00:00:00.000Z",
      ),
    ).resolves.toEqual({ updatedHosts: 2, updatedCredentials: 2 });

    expect(
      sqlite
        .prepare("SELECT folder FROM ssh_data WHERE user_id = ? ORDER BY id")
        .all("user-1"),
    ).toEqual([{ folder: "ops" }, { folder: "ops / api" }]);
    expect(
      sqlite
        .prepare(
          "SELECT folder FROM ssh_credentials WHERE user_id = ? ORDER BY id",
        )
        .all("user-1"),
    ).toEqual([{ folder: "ops" }, { folder: "ops / api" }]);
    expect(
      sqlite
        .prepare("SELECT name FROM ssh_folders WHERE user_id = ? ORDER BY id")
        .all("user-1"),
    ).toEqual([{ name: "ops" }, { name: "ops / api" }]);
    expect(writes).toBe(1);
  });

  it("lists folders and upserts metadata", async () => {
    let writes = 0;
    const { repository } = await createRepository(() => {
      writes += 1;
    });

    await expect(repository.listFolders("user-1")).resolves.toHaveLength(2);
    await expect(
      repository.upsertMetadata(
        "user-1",
        "prod",
        "#abcdef",
        "folder",
        undefined,
        "2026-02-01T00:00:00.000Z",
      ),
    ).resolves.toMatchObject({
      created: false,
      folder: { color: "#abcdef", icon: "folder" },
    });
    await expect(
      repository.upsertMetadata(
        "user-1",
        "new",
        null,
        null,
        null,
        "2026-03-01T00:00:00.000Z",
      ),
    ).resolves.toMatchObject({
      created: true,
      folder: { name: "new" },
    });
    expect(writes).toBe(2);
  });

  it("assigns a credential to a folder and resolves it for nested paths", async () => {
    const { repository } = await createRepository();

    await expect(
      repository.upsertMetadata(
        "user-1",
        "prod",
        undefined,
        undefined,
        1,
        "2026-02-01T00:00:00.000Z",
      ),
    ).resolves.toMatchObject({
      created: false,
      folder: { credentialId: 1 },
    });

    const folders = await repository.listFolders("user-1");
    const prodFolder = folders.find((f) => f.name === "prod");
    expect(prodFolder?.credentialId).toBe(1);
  });

  it("lists and deletes hosts and folder records in a folder tree", async () => {
    let writes = 0;
    const { repository, sqlite } = await createRepository(() => {
      writes += 1;
    });

    const hostsToDelete = await repository.listHostsInFolder("user-1", "prod");
    expect(hostsToDelete.map((host) => host.id)).toEqual([1, 2]);

    await repository.deleteHostsAndFolderRecords("user-1", "prod");

    expect(sqlite.prepare("SELECT id FROM ssh_data ORDER BY id").all()).toEqual(
      [{ id: 3 }],
    );
    expect(
      sqlite.prepare("SELECT id FROM ssh_folders ORDER BY id").all(),
    ).toEqual([{ id: 3 }]);
    expect(writes).toBe(1);
  });

  it("deletes folder records for a user", async () => {
    let writes = 0;
    const { repository, sqlite } = await createRepository(() => {
      writes += 1;
    });

    await expect(repository.deleteByUserId("user-1")).resolves.toBe(2);

    expect(sqlite.prepare("SELECT id FROM ssh_data ORDER BY id").all()).toEqual(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
    );
    expect(
      sqlite.prepare("SELECT id FROM ssh_folders ORDER BY id").all(),
    ).toEqual([{ id: 3 }]);
    expect(writes).toBe(1);
  });
});
