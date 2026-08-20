import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { UserRepository } from "../../../database/repositories/user-repository.js";

describe("UserRepository.listPage", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(): Promise<UserRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash) VALUES
        ('u1', 'alice', 'hash'),
        ('u2', 'Bob', 'hash'),
        ('u3', 'carol', 'hash'),
        ('u4', 'dave', 'hash'),
        ('u5', 'alicia', 'hash');
    `);

    return new UserRepository(context);
  }

  it("returns a page ordered by username with the full total", async () => {
    const repo = await createRepository();

    const page = await repo.listPage({ limit: 2, offset: 0 });

    expect(page.users.map((u) => u.username)).toEqual(["alice", "alicia"]);
    // total counts every match, not just the returned page.
    expect(page.total).toBe(5);
  });

  it("pages forward without repeating or skipping a row", async () => {
    const repo = await createRepository();

    const first = await repo.listPage({ limit: 2, offset: 0 });
    const second = await repo.listPage({ limit: 2, offset: 2 });
    const third = await repo.listPage({ limit: 2, offset: 4 });

    expect(
      [...first.users, ...second.users, ...third.users].map((u) => u.username),
    ).toEqual(["alice", "alicia", "Bob", "carol", "dave"]);
  });

  it("filters by username case-insensitively", async () => {
    const repo = await createRepository();

    const page = await repo.listPage({ search: "ALI", limit: 10, offset: 0 });

    expect(page.users.map((u) => u.username)).toEqual(["alice", "alicia"]);
    expect(page.total).toBe(2);
  });

  it("counts only matching rows when searching", async () => {
    const repo = await createRepository();

    const page = await repo.listPage({ search: "ali", limit: 1, offset: 0 });

    expect(page.users).toHaveLength(1);
    expect(page.total).toBe(2);
  });

  it("returns an empty page for a term nobody matches", async () => {
    const repo = await createRepository();

    const page = await repo.listPage({ search: "zzz", limit: 10, offset: 0 });

    expect(page.users).toEqual([]);
    expect(page.total).toBe(0);
  });

  it("treats a blank search as no filter", async () => {
    const repo = await createRepository();

    const page = await repo.listPage({ search: "   ", limit: 10, offset: 0 });

    expect(page.total).toBe(5);
  });

  it("returns an empty page past the end of the results", async () => {
    const repo = await createRepository();

    const page = await repo.listPage({ limit: 10, offset: 99 });

    expect(page.users).toEqual([]);
    expect(page.total).toBe(5);
  });
});
