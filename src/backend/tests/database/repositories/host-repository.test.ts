import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { HostRepository } from "../../../database/repositories/host-repository.js";

describe("HostRepository.reorderForUser", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<HostRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES
        (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'password'),
        (2, 'user-1', 'two', '10.0.0.2', 22, 'root', 'password'),
        (3, 'user-2', 'other', '10.0.0.3', 22, 'root', 'password');
    `);

    return new HostRepository(context, onWrite);
  }

  it("sets a distinct sortOrder per host", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const updated = await repo.reorderForUser("user-1", [
      { id: 1, sortOrder: 2000 },
      { id: 2, sortOrder: 1000 },
    ]);
    expect(updated).toBe(2);
    expect(writeCount).toBe(1);

    expect(
      await adapter!.query(
        sql`SELECT id, sort_order FROM ssh_data WHERE user_id = 'user-1' ORDER BY id`,
      ),
    ).toEqual([
      { id: 1, sort_order: 2000 },
      { id: 2, sort_order: 1000 },
    ]);
  });

  it("ignores ids the user does not own", async () => {
    const repo = await createRepository();

    const updated = await repo.reorderForUser("user-1", [
      { id: 3, sortOrder: 5000 },
    ]);
    expect(updated).toBe(0);

    expect(
      await adapter!.query(
        sql`SELECT sort_order FROM ssh_data WHERE id = 3`,
      ),
    ).toEqual([{ sort_order: null }]);
  });

  it("no-ops on an empty positions array", async () => {
    const repo = await createRepository();
    await expect(repo.reorderForUser("user-1", [])).resolves.toBe(0);
  });
});
