import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { DashboardServiceLinkRepository } from "../../../database/repositories/dashboard-service-link-repository.js";

describe("DashboardServiceLinkRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<DashboardServiceLinkRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE dashboard_service_links (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        label TEXT NOT NULL,
        url TEXT NOT NULL,
        "order" INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new DashboardServiceLinkRepository(context, onWrite);
  }

  it("creates and lists links ordered by order then id", async () => {
    const repo = await createRepository();

    const first = await repo.createForUser(
      "user-1",
      { label: "Docs", url: "https://docs.example.com" },
      "2026-06-27T00:00:00.000Z",
    );
    const second = await repo.createForUser("user-1", {
      label: "Status",
      url: "https://status.example.com",
    });
    await repo.createForUser("user-2", {
      label: "Other",
      url: "https://other.example.com",
    });

    expect(first).toMatchObject({
      userId: "user-1",
      label: "Docs",
      order: 0,
      createdAt: "2026-06-27T00:00:00.000Z",
    });
    expect(second.order).toBe(1);
    expect(
      (await repo.listByUserId("user-1")).map((link) => link.label),
    ).toEqual(["Docs", "Status"]);
  });

  it("finds, updates, and deletes a user-owned link", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const link = await repo.createForUser("user-1", {
      label: "Docs",
      url: "https://docs.example.com",
    });
    expect(writeCount).toBe(1);

    expect(await repo.findByIdForUser("user-2", link.id)).toBeNull();
    const updated = await repo.updateForUser("user-1", link.id, {
      label: "Docs renamed",
    });
    expect(updated).toMatchObject({
      id: link.id,
      label: "Docs renamed",
      url: "https://docs.example.com",
    });
    expect(writeCount).toBe(2);

    expect(await repo.updateForUser("user-2", link.id, { label: "Nope" })).toBe(
      null,
    );
    expect(writeCount).toBe(2);

    expect(await repo.deleteForUser("user-2", link.id)).toBe(false);
    expect(await repo.deleteForUser("user-1", link.id)).toBe(true);
    expect(writeCount).toBe(3);
  });

  it("deletes all dashboard links for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.createForUser("user-1", {
      label: "Docs",
      url: "https://docs.example.com",
    });
    await repo.createForUser("user-1", {
      label: "Status",
      url: "https://status.example.com",
    });
    await repo.createForUser("user-2", {
      label: "Other",
      url: "https://other.example.com",
    });

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(2);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repo.listByUserId("user-1")).toEqual([]);
    expect(
      (await repo.listByUserId("user-2")).map((link) => link.label),
    ).toEqual(["Other"]);
    expect(writeCount).toBe(4);
  });
});
