import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { OpenTabRepository } from "./open-tab-repository.js";

describe("OpenTabRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<OpenTabRepository> {
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

      CREATE TABLE user_open_tabs (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        tab_type TEXT NOT NULL,
        host_id INTEGER,
        label TEXT NOT NULL,
        tab_order INTEGER NOT NULL DEFAULT 0,
        backend_session_id TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new OpenTabRepository(context, onWrite);
  }

  it("lists recent tabs ordered by tab order", async () => {
    const repo = await createRepository();

    await repo.upsertForUser(
      "user-1",
      {
        id: "tab-old",
        tabType: "terminal",
        label: "Old",
        tabOrder: 1,
      },
      "2026-06-27T00:00:00.000Z",
    );
    await repo.upsertForUser(
      "user-1",
      {
        id: "tab-new",
        tabType: "stats",
        label: "New",
        tabOrder: 0,
      },
      "2026-06-27T01:00:00.000Z",
    );
    await repo.upsertForUser(
      "user-2",
      {
        id: "other",
        tabType: "terminal",
        label: "Other",
        tabOrder: 0,
      },
      "2026-06-27T02:00:00.000Z",
    );

    expect(
      (await repo.listRecentForUser("user-1", "2026-06-27T00:30:00.000Z")).map(
        (tab) => tab.id,
      ),
    ).toEqual(["tab-new"]);
  });

  it("upserts tabs and preserves backend session when omitted", async () => {
    const repo = await createRepository();

    await repo.upsertForUser("user-1", {
      id: "tab-1",
      tabType: "terminal",
      hostId: 1,
      label: "Server",
      tabOrder: 0,
      backendSessionId: "session-1",
    });
    await repo.upsertForUser("user-1", {
      id: "tab-1",
      tabType: "terminal",
      hostId: 2,
      label: "Server renamed",
      tabOrder: 1,
    });

    expect(
      (await repo.listRecentForUser("user-1", "2000-01-01T00:00:00.000Z"))[0],
    ).toMatchObject({
      id: "tab-1",
      hostId: 2,
      label: "Server renamed",
      tabOrder: 1,
      backendSessionId: "session-1",
    });
  });

  it("replaces, updates, and deletes tabs for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.replaceForUser("user-1", [
      { id: "tab-1", tabType: "terminal", label: "One", tabOrder: 1 },
      { id: "tab-2", tabType: "settings", label: "Two", tabOrder: 0 },
    ]);
    expect(
      (await repo.listRecentForUser("user-1", "2000-01-01T00:00:00.000Z")).map(
        (tab) => tab.id,
      ),
    ).toEqual(["tab-2", "tab-1"]);

    expect(
      await repo.updateForUser("user-1", "missing", { label: "Missing" }),
    ).toBe(false);
    expect(
      await repo.updateForUser("user-1", "tab-1", { label: "Renamed" }),
    ).toBe(true);
    expect(await repo.deleteForUser("user-1", "tab-2")).toBe(1);
    expect(await repo.deleteByUserId("user-1")).toBe(1);
    expect(await repo.deleteByUserId("user-1")).toBe(0);
    expect(writeCount).toBe(4);
  });
});
