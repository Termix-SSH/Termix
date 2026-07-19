import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { AuditLogRepository } from "../../../database/repositories/audit-log-repository.js";

describe("AuditLogRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<AuditLogRepository> {
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

      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        username TEXT NOT NULL,
        action TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT,
        resource_name TEXT,
        details TEXT,
        ip_address TEXT,
        user_agent TEXT,
        success INTEGER NOT NULL,
        error_message TEXT,
        timestamp TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new AuditLogRepository(context, onWrite);
  }

  it("creates, filters, pages, and lists actions", async () => {
    const repo = await createRepository();

    await repo.create({
      userId: "user-1",
      username: "alice",
      action: "create_host",
      resourceType: "host",
      resourceId: "1",
      success: true,
      timestamp: "2026-06-27T00:00:00.000Z",
    });
    await repo.create({
      userId: "user-2",
      username: "bob",
      action: "delete_host",
      resourceType: "host",
      resourceId: "2",
      success: false,
      timestamp: "2026-06-27T01:00:00.000Z",
    });

    const page = await repo.listPage({
      filters: {
        resourceType: "host",
        success: false,
        startDate: "2026-06-27T00:30:00.000Z",
      },
      limit: 10,
      offset: 0,
    });

    expect(page.total).toBe(1);
    expect(page.logs[0]).toMatchObject({
      userId: "user-2",
      action: "delete_host",
      success: false,
    });
    expect(await repo.listDistinctActions()).toEqual([
      "create_host",
      "delete_host",
    ]);
  });

  it("deletes logs by user id and only runs write hook for deleted rows", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.create({
      userId: "user-1",
      username: "alice",
      action: "login",
      resourceType: "auth",
      success: true,
    });
    await repo.create({
      userId: "user-2",
      username: "bob",
      action: "login",
      resourceType: "auth",
      success: true,
    });

    expect(await repo.deleteByUserId("missing")).toBe(0);
    expect(writeCount).toBe(2);

    expect(await repo.deleteByUserId("user-1")).toBe(1);
    expect(writeCount).toBe(3);
    expect(
      (
        await repo.listPage({
          filters: {},
          limit: 10,
          offset: 0,
        })
      ).logs.map((log) => log.userId),
    ).toEqual(["user-2"]);
  });
});
