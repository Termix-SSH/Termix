import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { DismissedAlertRepository } from "../../../database/repositories/dismissed-alert-repository.js";

describe("DismissedAlertRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<DismissedAlertRepository> {
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

      CREATE TABLE dismissed_alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        alert_id TEXT NOT NULL,
        dismissed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new DismissedAlertRepository(context, onWrite);
  }

  it("creates, lists, and finds dismissed alerts by user", async () => {
    const repo = await createRepository();

    await repo.create("user-1", "alert-1");
    await repo.create("user-1", "alert-2");
    await repo.create("user-2", "alert-3");

    expect(await repo.listAlertIdsByUserId("user-1")).toEqual([
      "alert-1",
      "alert-2",
    ]);
    expect((await repo.findForUser("user-1", "alert-1"))?.alertId).toBe(
      "alert-1",
    );
    expect(await repo.findForUser("user-1", "alert-3")).toBeNull();
    expect(
      (await repo.listByUserId("user-1")).map((row) => row.alertId),
    ).toEqual(["alert-1", "alert-2"]);
  });

  it("creates import alerts without duplicating user alert pairs", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await expect(
      repo.createForImport("user-1", "alert-1", "2026-01-01T00:00:00.000Z"),
    ).resolves.toBe(true);
    await expect(
      repo.createForImport("user-1", "alert-1", "2026-01-02T00:00:00.000Z"),
    ).resolves.toBe(false);

    const alerts = await repo.listByUserId("user-1");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      alertId: "alert-1",
      dismissedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(writeCount).toBe(1);
  });

  it("deletes dismissed alerts and only triggers writes for changed rows", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.create("user-1", "alert-1");
    await repo.create("user-1", "alert-2");
    await repo.create("user-2", "alert-3");
    expect(writeCount).toBe(3);

    expect(await repo.deleteForUser("user-1", "missing")).toBe(false);
    expect(writeCount).toBe(3);

    expect(await repo.deleteForUser("user-1", "alert-1")).toBe(true);
    expect(writeCount).toBe(4);
    expect(await repo.listAlertIdsByUserId("user-1")).toEqual(["alert-2"]);

    expect(await repo.deleteByUserId("user-1")).toBe(1);
    expect(writeCount).toBe(5);
    expect(await repo.deleteByUserId("user-1")).toBe(0);
    expect(writeCount).toBe(5);
  });
});
