import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { TmuxSessionTagRepository } from "../../../database/repositories/tmux-session-tag-repository.js";

describe("TmuxSessionTagRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<TmuxSessionTagRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'password'), (2, 'user-2', 'two', '10.0.0.1', 22, 'root', 'password');
      INSERT INTO tmux_session_tags (user_id, host_id, session_name, tag)
      VALUES
        ('user-1', 1, 'api', 'prod'),
        ('user-1', 1, 'api', 'critical'),
        ('user-1', 1, 'worker', 'batch'),
        ('user-2', 2, 'api', 'other');
    `);

    return new TmuxSessionTagRepository(context, onWrite);
  }

  it("groups tags by session for a user and host", async () => {
    const repo = await createRepository();

    const tags = await repo.listByUserAndHost("user-1", 1);

    expect(tags.get("api")).toEqual(["prod", "critical"]);
    expect(tags.get("worker")).toEqual(["batch"]);
    expect(tags.has("missing")).toBe(false);
  });

  it("renames and deletes session tags by host/session", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(await repo.renameSessionForHost(1, "api", "api-renamed")).toBe(2);
    expect(await repo.renameSessionForHost(1, "missing", "noop")).toBe(0);

    const renamed = await repo.listByUserAndHost("user-1", 1);
    expect(renamed.get("api-renamed")).toEqual(["prod", "critical"]);
    expect(renamed.has("api")).toBe(false);

    expect(await repo.deleteSessionForHost(1, "api-renamed")).toBe(2);
    expect(await repo.deleteSessionForHost(1, "api-renamed")).toBe(0);
    expect(writeCount).toBe(2);
  });

  it("replaces tags for one user/host/session", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    expect(
      await repo.replaceForUserHostSession("user-1", 1, "api", [
        "blue",
        "green",
      ]),
    ).toBe(4);

    const tags = await repo.listByUserAndHost("user-1", 1);
    expect(tags.get("api")).toEqual(["blue", "green"]);
    expect(tags.get("worker")).toEqual(["batch"]);

    expect(
      await repo.replaceForUserHostSession("user-1", 1, "worker", []),
    ).toBe(1);
    expect(
      await repo.replaceForUserHostSession("user-1", 1, "missing", []),
    ).toBe(0);
    expect(writeCount).toBe(2);
  });

  it("deletes all tags for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(3);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repo.listByUserAndHost("user-1", 1)).toEqual(new Map());
    expect(await repo.listByUserAndHost("user-2", 2)).toEqual(
      new Map([["api", ["other"]]]),
    );
    expect(writeCount).toBe(1);
  });
});
