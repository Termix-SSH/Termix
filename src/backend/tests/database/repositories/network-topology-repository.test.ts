import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { NetworkTopologyRepository } from "../../../database/repositories/network-topology-repository.js";

describe("NetworkTopologyRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<NetworkTopologyRepository> {
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

      CREATE TABLE network_topology (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        topology TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new NetworkTopologyRepository(context, onWrite);
  }

  it("finds, creates, and updates topology by user id", async () => {
    const repo = await createRepository();

    expect(await repo.findByUserId("user-1")).toBeNull();

    await repo.upsertForUser(
      "user-1",
      JSON.stringify({ nodes: [{ id: "host-1" }], edges: [] }),
      "2026-06-27T00:00:00.000Z",
    );
    expect(await repo.findByUserId("user-1")).toMatchObject({
      userId: "user-1",
      topology: '{"nodes":[{"id":"host-1"}],"edges":[]}',
      updatedAt: "2026-06-27T00:00:00.000Z",
    });

    await repo.upsertForUser(
      "user-1",
      JSON.stringify({ nodes: [], edges: [{ id: "edge-1" }] }),
      "2026-06-27T01:00:00.000Z",
    );
    expect(await repo.findByUserId("user-1")).toMatchObject({
      userId: "user-1",
      topology: '{"nodes":[],"edges":[{"id":"edge-1"}]}',
      updatedAt: "2026-06-27T01:00:00.000Z",
    });
  });

  it("deletes topology and only triggers writes for changed rows", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsertForUser("user-1", "{}");
    await repo.upsertForUser("user-1", '{"nodes":[]}');
    expect(writeCount).toBe(2);

    expect(await repo.deleteByUserId("missing")).toBe(0);
    expect(writeCount).toBe(2);

    expect(await repo.deleteByUserId("user-1")).toBe(1);
    expect(writeCount).toBe(3);
    expect(await repo.findByUserId("user-1")).toBeNull();
  });
});
