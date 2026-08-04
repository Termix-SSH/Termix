import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { FileManagerBookmarkRepository } from "../../../database/repositories/file-manager-bookmark-repository.js";

describe("FileManagerBookmarkRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<FileManagerBookmarkRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'password'), (2, 'user-1', 'two', '10.0.0.1', 22, 'root', 'password'), (3, 'user-2', 'other', '10.0.0.1', 22, 'root', 'password');
    `);

    return new FileManagerBookmarkRepository(context, onWrite);
  }

  it("upserts and lists recent files by last-opened time", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsertRecent(
      "user-1",
      { hostId: 1, path: "/var/log/app.log" },
      "2026-01-01T00:00:00.000Z",
    );
    await repo.upsertRecent(
      "user-1",
      { hostId: 1, path: "/opt/app/config.json", name: "Config" },
      "2026-01-02T00:00:00.000Z",
    );
    await repo.upsertRecent(
      "user-1",
      { hostId: 1, path: "/var/log/app.log" },
      "2026-01-03T00:00:00.000Z",
    );

    const recent = await repo.listRecentForHost("user-1", 1);

    expect(recent.map((entry) => entry.path)).toEqual([
      "/var/log/app.log",
      "/opt/app/config.json",
    ]);
    expect(recent[0].lastOpened).toBe("2026-01-03T00:00:00.000Z");
    expect(recent[0].name).toBe("app.log");
    expect(writeCount).toBe(3);

    expect(
      await repo.deleteRecentForHostPath("user-1", {
        hostId: 1,
        path: "/var/log/app.log",
      }),
    ).toBe(1);
    expect(writeCount).toBe(4);
  });

  it("creates pinned files and shortcuts without duplicating paths", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(
      await repo.createPinned(
        "user-1",
        { hostId: 1, path: "/srv/www", name: "Web" },
        "2026-01-01T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      await repo.createPinned("user-1", { hostId: 1, path: "/srv/www" }),
    ).toBe(false);
    expect((await repo.listPinnedForHost("user-1", 1))[0]).toMatchObject({
      name: "Web",
      path: "/srv/www",
    });

    expect(
      await repo.createShortcut(
        "user-1",
        { hostId: 1, path: "/etc/nginx" },
        "2026-01-02T00:00:00.000Z",
      ),
    ).toBe(true);
    expect(
      await repo.createShortcut("user-1", { hostId: 1, path: "/etc/nginx" }),
    ).toBe(false);
    expect((await repo.listShortcutsForHost("user-1", 1))[0]).toMatchObject({
      name: "nginx",
      path: "/etc/nginx",
    });
    expect(writeCount).toBe(2);

    expect(
      await repo.deletePinnedForHostPath("user-1", {
        hostId: 1,
        path: "/srv/www",
      }),
    ).toBe(1);
    expect(
      await repo.deleteShortcutForHostPath("user-1", {
        hostId: 1,
        path: "/etc/nginx",
      }),
    ).toBe(1);
    expect(writeCount).toBe(4);
  });

  it("creates import bookmarks without duplicating user path/name pairs", async () => {
    const repo = await createRepository();

    await expect(
      repo.createRecentForImport(
        "user-1",
        { hostId: 1, path: "/tmp/a.txt", name: "A" },
        "2026-01-01T00:00:00.000Z",
      ),
    ).resolves.toBe(true);
    await expect(
      repo.createRecentForImport("user-1", {
        hostId: 2,
        path: "/tmp/a.txt",
        name: "A",
      }),
    ).resolves.toBe(false);

    await expect(
      repo.createPinnedForImport("user-1", {
        hostId: 1,
        path: "/srv/www",
        name: "Web",
      }),
    ).resolves.toBe(true);
    await expect(
      repo.createPinnedForImport("user-1", {
        hostId: 2,
        path: "/srv/www",
        name: "Web",
      }),
    ).resolves.toBe(false);

    await expect(
      repo.createShortcutForImport("user-1", {
        hostId: 1,
        path: "/etc/nginx",
        name: "Nginx",
      }),
    ).resolves.toBe(true);
    await expect(
      repo.createShortcutForImport("user-1", {
        hostId: 2,
        path: "/etc/nginx",
        name: "Nginx",
      }),
    ).resolves.toBe(false);
  });

  it("deletes bookmarks by user, host, and host list", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsertRecent("user-1", { hostId: 1, path: "/one" });
    await repo.createPinned("user-1", { hostId: 2, path: "/two" });
    await repo.createShortcut("user-2", { hostId: 3, path: "/three" });
    expect(writeCount).toBe(3);

    expect(await repo.deleteByHostId(1)).toBe(1);
    expect(await repo.deleteByHostId(1)).toBe(0);
    expect(await repo.deleteByHostIds([])).toBe(0);
    expect(await repo.deleteByHostIds([2])).toBe(1);
    expect(writeCount).toBe(5);

    expect(await repo.deleteByUserId("user-2")).toBe(1);
    expect(await repo.deleteByUserId("user-2")).toBe(0);
    expect(writeCount).toBe(6);
  });
});
