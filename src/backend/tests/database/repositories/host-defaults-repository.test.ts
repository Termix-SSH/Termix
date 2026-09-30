import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HostDefaultsRepository } from "../../../database/repositories/host-defaults-repository.js";

describe("HostDefaultsRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(): Promise<HostDefaultsRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_folders (id, user_id, name)
      VALUES (1, 'user-1', 'prod'), (2, 'user-2', 'prod');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, folder, auth_type)
      VALUES
        (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'prod', 'password'),
        (2, 'user-2', 'two', '10.0.0.2', 22, 'root', null, 'password');
    `);
    return new HostDefaultsRepository(context);
  }

  it("keeps each level apart, the server level included", async () => {
    const repository = await createRepository();
    await repository.apply(
      { level: "admin" },
      [{ namespace: "core", key: "sshPort", value: "2022" }],
      [],
      "user-1",
    );
    await repository.apply(
      { level: "user", userId: "user-1" },
      [{ namespace: "core", key: "sshPort", value: "2023" }],
      [],
      "user-1",
    );
    await repository.apply(
      { level: "folder", userId: "user-1", folderId: 1 },
      [{ namespace: "term", key: "fontSize", value: "16" }],
      [],
      "user-1",
    );

    expect(await repository.listScope({ level: "admin" })).toHaveLength(1);
    const forUser = await repository.listForUsers(["user-1"]);
    expect(forUser.map((row) => `${row.level}:${row.value}`).sort()).toEqual([
      "admin:2022",
      "folder:16",
      "user:2023",
    ]);
    expect(await repository.listForUsers(["user-2"])).toHaveLength(1);
  });

  it("updates a key in place and clears one", async () => {
    const repository = await createRepository();
    const scope = { level: "user" as const, userId: "user-1" };
    await repository.apply(
      scope,
      [{ namespace: "core", key: "sshPort", value: "1" }],
      [],
      null,
    );
    await repository.apply(
      scope,
      [{ namespace: "core", key: "sshPort", value: "2" }],
      [],
      null,
    );
    expect((await repository.listScope(scope)).map((row) => row.value)).toEqual(
      ["2"],
    );
    await repository.apply(
      scope,
      [],
      [{ namespace: "core", key: "sshPort" }],
      null,
    );
    expect(await repository.listScope(scope)).toEqual([]);
  });

  it("finds or creates a folder row for a path", async () => {
    const repository = await createRepository();
    expect(await repository.ensureFolder("user-1", "prod")).toBe(1);
    const created = await repository.ensureFolder("user-1", "prod / web");
    expect(await repository.findFolder(created)).toMatchObject({
      userId: "user-1",
      name: "prod / web",
    });
  });

  it("reads and writes hosts in bulk", async () => {
    const repository = await createRepository();
    expect(
      (await repository.listHosts({ userIds: ["user-1"] })).map(
        (row) => row.id,
      ),
    ).toEqual([1]);
    await repository.updateHosts([
      { id: 1, values: { sshPort: 2022, defaultOverrides: '{"core":[]}' } },
    ]);
    const [row] = await repository.listHosts({ hostIds: [1] });
    expect(row.sshPort).toBe(2022);
    expect(row.defaultOverrides).toBe('{"core":[]}');
    expect(await repository.listHostPlacement(["user-1"])).toEqual([
      { id: 1, userId: "user-1", folder: "prod", parentHostId: null },
    ]);
  });
});
