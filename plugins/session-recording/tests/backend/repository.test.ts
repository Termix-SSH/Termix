import { afterEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { pluginDir } from "./helpers";
import { createSessionRecordingRepository } from "../../src/backend/repository";
import { sessionRecordings } from "../../src/backend/tables";

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

const fakeHosts = {
  list: async () => [
    {
      id: 7,
      userId: "user-1",
      name: "web",
      ip: "10.0.0.5",
      port: 22,
      username: "root",
      tags: null,
      folder: null,
      authType: "password",
    },
  ],
  get: async () => null,
  checkAccess: async () => ({
    hasAccess: false,
    isOwner: false,
    isShared: false,
  }),
  create: async () => {
    throw new Error("not used");
  },
  update: async () => null,
  listOwned: async () => [],
  share: async () => ({ hostId: 0, shared: false }),
  listUsers: async () => [],
  listRoles: async () => [],
  trackSession: () => () => {},
  recordActivity: async () => {},
};

async function setup() {
  db = await createTestDb(pluginDir);
  db.sqlite
    .prepare("INSERT INTO users (id, username) VALUES (?, ?)")
    .run("user-1", "alice");
  db.sqlite.prepare("INSERT INTO ssh_data (id) VALUES (?)").run(7);
  const table = await db.database.define(sessionRecordings);
  return createSessionRecordingRepository(db.database, table, fakeHosts);
}

describe("session recording repository", () => {
  it("creates a row and reads it back by recordingPath", async () => {
    const repo = await setup();
    const row = await repo.create({
      hostId: 7,
      userId: "user-1",
      username: "alice",
      startedAt: new Date().toISOString(),
      recordingPath: "/data/session_logs/user-1/a.cast",
      protocol: "ssh",
      format: "asciicast",
    });

    expect(row.id).toBeGreaterThan(0);
    expect(row.recordingPath).toBe("/data/session_logs/user-1/a.cast");
    expect(db!.persisted).toBeGreaterThan(0);
  });

  it("lists a user's recordings with host name and ip attached", async () => {
    const repo = await setup();
    await repo.create({
      hostId: 7,
      userId: "user-1",
      startedAt: new Date().toISOString(),
      recordingPath: "/data/session_logs/user-1/a.cast",
      protocol: "ssh",
      format: "asciicast",
    });

    const rows = await repo.listByUserIdWithHost("user-1");
    expect(rows).toHaveLength(1);
    expect(rows[0].hostName).toBe("web");
    expect(rows[0].hostIp).toBe("10.0.0.5");
  });

  it("finds and deletes only the owner's row", async () => {
    const repo = await setup();
    const row = await repo.create({
      hostId: 7,
      userId: "user-1",
      startedAt: new Date().toISOString(),
      recordingPath: "/data/session_logs/user-1/a.cast",
      protocol: "ssh",
      format: "asciicast",
    });

    expect(await repo.findByIdForUser("user-2", row.id)).toBeNull();
    expect(await repo.deleteForUser("user-2", row.id)).toBe(false);
    expect(await repo.deleteForUser("user-1", row.id)).toBe(true);
    expect(await repo.findByIdForUser("user-1", row.id)).toBeNull();
  });

  it("anonymizes a user's rows instead of deleting them", async () => {
    const repo = await setup();
    const row = await repo.create({
      hostId: 7,
      userId: "user-1",
      startedAt: new Date().toISOString(),
      recordingPath: "/data/session_logs/user-1/a.cast",
      protocol: "ssh",
      format: "asciicast",
    });

    await repo.anonymizeByUserId("user-1");

    const rows = await repo.listPathsOlderThan(
      new Date(Date.now() + 60_000).toISOString(),
    );
    expect(rows.map((r) => r.id)).toContain(row.id);
    expect(await repo.findByIdForUser("user-1", row.id)).toBeNull();
  });

  it("lists recordings older than a cutoff for retention pruning", async () => {
    const repo = await setup();
    await repo.create({
      hostId: 7,
      userId: "user-1",
      startedAt: "2020-01-01T00:00:00.000Z",
      recordingPath: "/data/session_logs/user-1/old.cast",
      protocol: "ssh",
      format: "asciicast",
    });

    const old = await repo.listPathsOlderThan("2021-01-01T00:00:00.000Z");
    expect(old).toHaveLength(1);

    const none = await repo.listPathsOlderThan("2019-01-01T00:00:00.000Z");
    expect(none).toHaveLength(0);
  });
});
