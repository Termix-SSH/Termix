import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import { workspaces } from "../../src/backend/tables.js";
import {
  createWorkspaceRepository,
  type WorkspaceRepository,
} from "../../src/backend/repository.js";
import { pluginDir } from "./helpers";

let db: TestDb;
let repo: WorkspaceRepository;

beforeEach(async () => {
  db = await createTestDb(pluginDir, {
    before: (sqlite) =>
      sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')"),
  });
  repo = createWorkspaceRepository(
    db.database,
    await db.database.define(workspaces),
  );
});

afterEach(() => db.close());

describe("workspace repository", () => {
  it("reads a new row back by its own sync id", async () => {
    const a = await repo.create("user-1", { name: "A", payload: "{}" });
    const b = await repo.create("user-1", { name: "B", payload: "{}" });
    expect(a.name).toBe("A");
    expect(b.name).toBe("B");
    expect(a.syncId).not.toBe(b.syncId);
    expect(a.createdAt).toBe(a.updatedAt);
  });

  it("returns the updated last session rather than a new one", async () => {
    const first = await repo.upsertLastSession("user-1", '{"tabs":[]}', "t1");
    const second = await repo.upsertLastSession("user-1", '{"tabs":[1]}', "t2");
    expect(second.id).toBe(first.id);
    expect(second.payload).toBe('{"tabs":[1]}');
    expect(second.updatedAt).toBe("t2");
  });

  it("switches the default without touching another user's", async () => {
    const theirs = await repo.create("user-2", { name: "T", payload: "{}" });
    await repo.setDefault("user-2", theirs.id);

    const a = await repo.create("user-1", { name: "A", payload: "{}" });
    const b = await repo.create("user-1", { name: "B", payload: "{}" });
    await repo.setDefault("user-1", a.id);
    await repo.setDefault("user-1", b.id);

    expect((await repo.findById("user-1", a.id))?.isDefault).toBe(false);
    expect((await repo.findById("user-1", b.id))?.isDefault).toBe(true);
    expect((await repo.findById("user-2", theirs.id))?.isDefault).toBe(true);
  });

  it("refuses to edit or delete the last session", async () => {
    const last = await repo.upsertLastSession("user-1", "{}");
    expect(await repo.update("user-1", last.id, { name: "x" })).toBeNull();
    expect(await repo.setDefault("user-1", last.id)).toBeNull();
    expect(await repo.delete("user-1", last.id)).toBe(false);
  });
});
