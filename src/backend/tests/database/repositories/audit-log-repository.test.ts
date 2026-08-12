import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { TestSqliteDatabase } from "./test-support.js";
import { AuditLogRepository } from "../../../database/repositories/audit-log-repository.js";

describe("AuditLogRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  beforeEach(() => {
    AuditLogRepository.resetPruneThrottleForTests();
  });

  afterEach(async () => {
    delete process.env.AUDIT_LOG_MAX_ENTRIES;
    delete process.env.AUDIT_LOG_RETENTION_DAYS;
    AuditLogRepository.resetPruneThrottleForTests();
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
    await adapter.exec(`
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

  it("keeps entries when their user is deleted, detaching instead of removing", async () => {
    const repo = await createRepository();

    await repo.create({
      userId: "user-1",
      username: "alice",
      action: "delete_host",
      resourceType: "host",
      resourceId: "9",
      success: true,
      timestamp: "2026-07-01T00:00:00.000Z",
    });
    await repo.create({
      userId: "user-2",
      username: "bob",
      action: "create_host",
      resourceType: "host",
      resourceId: "8",
      success: true,
      timestamp: "2026-07-02T00:00:00.000Z",
    });

    expect(await repo.anonymizeByUserId("user-1")).toBe(1);

    const { logs } = await repo.listPage({ filters: {}, limit: 10, offset: 0 });
    expect(logs).toHaveLength(2);

    const detached = logs.find((log) => log.action === "delete_host");
    // The account is gone; the entry and its actor name are not.
    expect(detached?.userId).toBeNull();
    expect(detached?.username).toBe("alice");
    expect(logs.find((log) => log.action === "create_host")?.userId).toBe(
      "user-2",
    );
  });

  it("reports nothing to detach for a user with no entries", async () => {
    const repo = await createRepository();

    expect(await repo.anonymizeByUserId("user-2")).toBe(0);
  });

  describe("pruning", () => {
    async function countEntries(): Promise<number> {
      const rows = await adapter!.query<{ count: number }>(
        sql`SELECT COUNT(*) AS count FROM audit_logs`,
      );
      return Number(rows[0].count);
    }

    let writeSeq = 0;
    beforeEach(() => {
      writeSeq = 0;
    });

    async function write(repo: AuditLogRepository, n: number): Promise<void> {
      for (let i = 0; i < n; i++) {
        await repo.create({
          userId: "user-1",
          username: "alice",
          action: "host_connect",
          resourceType: "host",
          success: true,
          // Monotonic across calls so a second batch never reuses timestamps
          // from the first, which would make "oldest first" ambiguous.
          timestamp: new Date(
            Date.UTC(2026, 0, 1, 0, 0, writeSeq++),
          ).toISOString(),
        });
      }
    }

    it("enforces the entry cap down to the target ratio", async () => {
      process.env.AUDIT_LOG_MAX_ENTRIES = "10";
      const repo = await createRepository();

      await write(repo, 10);
      await repo.pruneNow();

      // Cap 10, target ratio 0.9 -> trimmed back to 9.
      expect(await countEntries()).toBe(9);
    });

    it("drops the oldest entries first when over the cap", async () => {
      process.env.AUDIT_LOG_MAX_ENTRIES = "10";
      const repo = await createRepository();

      await write(repo, 10);
      await repo.pruneNow();

      const rows = await adapter!.query<{ timestamp: string }>(
        sql`SELECT timestamp FROM audit_logs ORDER BY timestamp ASC`,
      );
      // The first-written entry is the one discarded.
      expect(rows[0].timestamp).toBe(
        new Date(Date.UTC(2026, 0, 1, 0, 0, 1)).toISOString(),
      );
    });

    it("removes entries past the retention window", async () => {
      process.env.AUDIT_LOG_RETENTION_DAYS = "1";
      const repo = await createRepository();

      await repo.create({
        username: "alice",
        action: "old",
        resourceType: "host",
        success: true,
        timestamp: new Date(Date.now() - 5 * 86_400_000).toISOString(),
      });
      await repo.create({
        username: "alice",
        action: "fresh",
        resourceType: "host",
        success: true,
        timestamp: new Date().toISOString(),
      });

      await repo.pruneNow();

      const rows = await adapter!.query<{ action: string }>(
        sql`SELECT action FROM audit_logs`,
      );
      expect(rows.map((row) => row.action)).toEqual(["fresh"]);
    });

    it("keeps enforcing the cap across a burst of writes", async () => {
      process.env.AUDIT_LOG_MAX_ENTRIES = "10";
      const repo = await createRepository();

      // The cap is checked on the write that crosses it, not on a timer, so a
      // burst cannot run the table away past the ceiling.
      await write(repo, 24);

      expect(await countEntries()).toBeLessThanOrEqual(10);
    });

    it("re-reads the row count after entries are deleted elsewhere", async () => {
      process.env.AUDIT_LOG_MAX_ENTRIES = "10";
      const repo = await createRepository();

      await write(repo, 9);
      // Clears the table, so the cached count is now far too high.
      await repo.deleteByUserId("user-1");
      await write(repo, 9);

      // Had the count kept counting up from 9, this second batch would have
      // tripped the cap and pruned; a correct re-read leaves all 9 in place.
      expect(await countEntries()).toBe(9);
    });

    it("keeps the write succeeding even when pruning cannot run", async () => {
      process.env.AUDIT_LOG_MAX_ENTRIES = "not-a-number";
      const repo = await createRepository();

      await expect(write(repo, 1)).resolves.toBeUndefined();
      expect(await countEntries()).toBe(1);
    });
  });
});
