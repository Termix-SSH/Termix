import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { SessionRecordingRepository } from "../../../database/repositories/session-recording-repository.js";

describe("SessionRecordingRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<SessionRecordingRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
      INSERT INTO ssh_data (id, user_id, name, ip, port, username, auth_type)
      VALUES (1, 'user-1', 'one', '10.0.0.1', 22, 'root', 'password'), (2, 'user-1', 'two', '10.0.0.2', 22, 'root', 'password'), (3, 'user-2', 'other', '10.0.0.3', 22, 'root', 'password');
    `);

    return new SessionRecordingRepository(context, onWrite);
  }

  it("creates and lists session recordings with host metadata", async () => {
    const repo = await createRepository();

    const first = await repo.create({
      userId: "user-1",
      hostId: 1,
      startedAt: "2026-06-27T00:00:00.000Z",
      endedAt: "2026-06-27T00:01:00.000Z",
      duration: 60,
      recordingPath: "/tmp/one.log",
    });
    await repo.create({
      userId: "user-1",
      hostId: 2,
      startedAt: "2026-06-27T00:02:00.000Z",
      recordingPath: "/tmp/two.log",
    });
    await repo.create({
      userId: "user-2",
      hostId: 3,
      startedAt: "2026-06-27T00:03:00.000Z",
    });

    expect(first).toMatchObject({
      userId: "user-1",
      hostId: 1,
      duration: 60,
      recordingPath: "/tmp/one.log",
    });

    const rows = await repo.listByUserIdWithHost("user-1");
    expect(rows.map((row) => row.hostName)).toEqual(["two", "one"]);
    expect(rows[0]).toMatchObject({
      hostIp: "10.0.0.2",
      recordingPath: "/tmp/two.log",
      protocol: "ssh",
      format: "text",
    });
  });

  it("finds paths and prunes old recordings", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const old = await repo.create({
      userId: "user-1",
      hostId: 1,
      startedAt: "2026-01-01T00:00:00.000Z",
      recordingPath: "/tmp/old.log",
    });
    const current = await repo.create({
      userId: "user-1",
      hostId: 1,
      startedAt: "2026-06-27T00:00:00.000Z",
      recordingPath: "/tmp/current.log",
    });
    expect(writeCount).toBe(2);

    expect(await repo.findPathByIdForUser("user-2", old.id)).toBeNull();
    expect(await repo.findPathByIdForUser("user-1", old.id)).toMatchObject({
      recordingPath: "/tmp/old.log",
    });
    expect(await repo.listPathsOlderThan("2026-02-01T00:00:00.000Z")).toEqual([
      { id: old.id, recordingPath: "/tmp/old.log" },
    ]);

    expect(await repo.deleteById(old.id)).toBe(true);
    expect(await repo.deleteById(old.id)).toBe(false);
    expect(await repo.findByIdForUser("user-1", current.id)).toMatchObject({
      id: current.id,
    });
    expect(writeCount).toBe(3);
  });

  it("deletes recordings by user and host references", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const first = await repo.create({
      userId: "user-1",
      hostId: 1,
      startedAt: "2026-06-27T00:00:00.000Z",
    });
    await repo.create({
      userId: "user-1",
      hostId: 2,
      startedAt: "2026-06-27T00:01:00.000Z",
    });
    await repo.create({
      userId: "user-2",
      hostId: 3,
      startedAt: "2026-06-27T00:02:00.000Z",
    });
    expect(writeCount).toBe(3);

    expect(await repo.deleteForUser("user-2", first.id)).toBe(false);
    expect(await repo.deleteForUser("user-1", first.id)).toBe(true);
    expect(await repo.deleteByHostIds([])).toBe(0);
    expect(await repo.deleteByHostIds([2])).toBe(1);
    expect(writeCount).toBe(5);

    expect(await repo.deleteByUserId("user-2")).toBe(1);
    expect(await repo.deleteByHostId(3)).toBe(0);
    expect(writeCount).toBe(6);
  });
});
