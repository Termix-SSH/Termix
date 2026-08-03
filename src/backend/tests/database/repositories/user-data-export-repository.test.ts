import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { UserDataExportRepository } from "../../../database/repositories/user-data-export-repository.js";

describe("UserDataExportRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(): Promise<UserDataExportRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_credentials (id, user_id, name, auth_type, username, password)
      VALUES
        (1, 'user-1', 'prod', 'password', 'root', 'secret'),
        (2, 'user-2', 'other', 'password', 'root', 'secret');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES
        (1, 'user-1', 'web', '10.0.0.1', 22, 'root', 'password'),
        (2, 'user-2', 'db', '10.0.0.2', 22, 'root', 'password');
    `);

    return new UserDataExportRepository(context);
  }

  it("lists only the current user's exportable hosts and credentials", async () => {
    const repository = await createRepository();

    expect(await repository.listHostsByUserId("user-1")).toMatchObject([
      {
        id: 1,
        userId: "user-1",
        name: "web",
        ip: "10.0.0.1",
      },
    ]);

    expect(await repository.listCredentialsByUserId("user-1")).toMatchObject([
      {
        id: 1,
        userId: "user-1",
        name: "prod",
        username: "root",
      },
    ]);
  });
});
