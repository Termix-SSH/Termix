import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { SnippetRepository } from "./snippet-repository.js";

describe("SnippetRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(onWrite?: () => void): Promise<{
    repository: SnippetRepository;
    sqlite: NonNullable<
      Awaited<ReturnType<SqliteDatabaseAdapter["connect"]>>["sqlite"]
    >;
  }> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE snippets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        content TEXT NOT NULL,
        description TEXT,
        folder TEXT,
        "order" INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        host_filter TEXT
      );

      CREATE TABLE snippet_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        color TEXT,
        icon TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO snippets (
        id, user_id, name, content, description, folder, "order", host_filter
      )
      VALUES
        (1, 'user-1', 'root', 'uptime', NULL, NULL, 2, NULL),
        (2, 'user-1', 'deploy', 'make deploy', 'Deploy app', 'ops', 1, 'linux'),
        (3, 'user-2', 'other', 'whoami', NULL, NULL, 1, NULL);

      INSERT INTO snippet_folders (id, user_id, name, color, icon)
      VALUES
        (1, 'user-1', 'ops', '#123456', 'terminal'),
        (2, 'user-1', 'db', NULL, NULL),
        (3, 'user-2', 'other', NULL, NULL);
    `);

    return {
      repository: new SnippetRepository(context, onWrite),
      sqlite: context.sqlite!,
    };
  }

  it("finds owned snippets only", async () => {
    const { repository } = await createRepository();

    await expect(repository.findOwnedById("user-1", 1)).resolves.toMatchObject({
      id: 1,
      userId: "user-1",
      name: "root",
    });
    await expect(repository.findOwnedById("user-1", 3)).resolves.toBeNull();
    await expect(repository.findOwnedById("user-1", 999)).resolves.toBeNull();
  });

  it("lists folders by name for a user", async () => {
    const { repository } = await createRepository();

    const rows = await repository.listFolders("user-1");

    expect(rows.map((row) => row.name)).toEqual(["db", "ops"]);
  });

  it("lists export data for a user", async () => {
    const { repository } = await createRepository();

    const snippets = await repository.listSnippetsForExport("user-1");
    const folders = await repository.listFoldersForExport("user-1");

    expect(snippets.map((row) => row.name)).toEqual(["root", "deploy"]);
    expect(folders.map((row) => row.name)).toEqual(["db", "ops"]);
  });

  it("creates folders and rejects duplicate names", async () => {
    const onWrite = vi.fn();
    const { repository } = await createRepository(onWrite);

    const created = await repository.createFolder(
      "user-1",
      "  new  ",
      " #fff ",
      " star ",
    );
    const duplicate = await repository.createFolder(
      "user-1",
      "ops",
      null,
      null,
    );

    expect(created).toMatchObject({
      userId: "user-1",
      name: "new",
      color: "#fff",
      icon: "star",
    });
    expect(duplicate).toBeNull();
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("updates folder metadata", async () => {
    const onWrite = vi.fn();
    const { repository } = await createRepository(onWrite);

    const updated = await repository.updateFolderMetadata(
      "user-1",
      "ops",
      " #abc ",
      undefined,
    );
    const missing = await repository.updateFolderMetadata(
      "user-1",
      "missing",
      null,
      null,
    );

    expect(updated).toMatchObject({
      name: "ops",
      color: "#abc",
      icon: "terminal",
    });
    expect(missing).toBeNull();
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("renames folders and attached snippets", async () => {
    const onWrite = vi.fn();
    const { repository } = await createRepository(onWrite);

    await expect(
      repository.renameFolder("user-1", "missing", "new"),
    ).resolves.toEqual({ status: "missing" });
    await expect(
      repository.renameFolder("user-1", "ops", "db"),
    ).resolves.toEqual({
      status: "conflict",
    });
    await expect(
      repository.renameFolder("user-1", "ops", "deploys"),
    ).resolves.toEqual({ status: "renamed" });

    await expect(repository.listFolders("user-1")).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "deploys" })]),
    );
    await expect(repository.findOwnedById("user-1", 2)).resolves.toMatchObject({
      folder: "deploys",
    });
    expect(onWrite).toHaveBeenCalledTimes(1);
  });

  it("deletes folders and moves snippets to the root", async () => {
    const onWrite = vi.fn();
    const { repository } = await createRepository(onWrite);

    await repository.deleteFolder("user-1", "ops");

    expect(
      (await repository.listFolders("user-1")).map((row) => row.name),
    ).toEqual(["db"]);
    await expect(repository.findOwnedById("user-1", 2)).resolves.toMatchObject({
      folder: null,
    });
    expect(onWrite).toHaveBeenCalledTimes(1);
  });
});
