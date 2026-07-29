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
    await adapter.exec(`
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
