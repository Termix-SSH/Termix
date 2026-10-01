import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { graphs } from "../../src/backend/tables.js";
import {
  createGraphRepository,
  type GraphRepository,
} from "../../src/backend/repository.js";
import { pluginDir } from "./helpers";

let db: TestDb;
let repo: GraphRepository;

beforeEach(async () => {
  db = await createTestDb(pluginDir, {
    before: (sqlite) =>
      sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')"),
  });
  repo = createGraphRepository(db.database, await db.database.define(graphs));
});

afterEach(() => db.close());

describe("graph repository", () => {
  it("finds, creates, and updates topology by user id", async () => {
    expect(await repo.findByUserId("user-1")).toBeNull();

    await repo.upsertForUser(
      "user-1",
      JSON.stringify({ nodes: [{ id: "host-1" }], edges: [] }),
    );
    expect(await repo.findByUserId("user-1")).toMatchObject({
      userId: "user-1",
      topology: '{"nodes":[{"id":"host-1"}],"edges":[]}',
    });

    await repo.upsertForUser(
      "user-1",
      JSON.stringify({ nodes: [], edges: [{ id: "edge-1" }] }),
    );
    expect(await repo.findByUserId("user-1")).toMatchObject({
      userId: "user-1",
      topology: '{"nodes":[],"edges":[{"id":"edge-1"}]}',
    });
  });

  it("keeps rows for different users separate", async () => {
    await repo.upsertForUser("user-1", '{"nodes":[]}');
    await repo.upsertForUser("user-2", '{"nodes":["a"]}');

    expect((await repo.findByUserId("user-1"))?.topology).toBe('{"nodes":[]}');
    expect((await repo.findByUserId("user-2"))?.topology).toBe(
      '{"nodes":["a"]}',
    );
  });
});
