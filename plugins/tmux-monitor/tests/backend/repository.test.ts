import { afterEach, describe, expect, it } from "vitest";
import {
  createMockCtx,
  createTestDb,
  type TestDb,
} from "@termix/plugin-sdk/testing";
import { sessionTags } from "../../src/backend/tables.js";
import { createSessionTagRepository } from "../../src/backend/repository.js";
import { manifest, pluginDir } from "./helpers";

let db: TestDb | null = null;

afterEach(() => {
  db?.close();
  db = null;
});

async function createRepository() {
  db = await createTestDb(pluginDir);
  db.sqlite.exec(
    "INSERT INTO users (id, username) VALUES ('user-1', 'user-1'), ('user-2', 'user-2')",
  );
  db.sqlite.exec("INSERT INTO ssh_data (id) VALUES (1), (2)");

  const mock = createMockCtx({
    pluginId: manifest.id,
    manifest,
    capabilities: manifest.capabilities,
    db: db.database,
  });
  const table = await mock.ctx.db.define(sessionTags);
  const repository = createSessionTagRepository(mock.ctx.db, table);

  db.sqlite.exec(`
    INSERT INTO p_tmux_monitor_session_tags (user_id, host_id, session_name, tag)
    VALUES
      ('user-1', 1, 'api', 'prod'),
      ('user-1', 1, 'api', 'critical'),
      ('user-1', 1, 'worker', 'batch'),
      ('user-2', 2, 'api', 'other');
  `);

  return repository;
}

describe("createSessionTagRepository", () => {
  it("groups tags by session for a user and host", async () => {
    const repository = await createRepository();

    const tags = await repository.listByUserAndHost("user-1", 1);

    expect(tags.get("api")).toEqual(["prod", "critical"]);
    expect(tags.get("worker")).toEqual(["batch"]);
    expect(tags.has("missing")).toBe(false);
  });

  it("renames tags by host/session, leaving other hosts alone", async () => {
    const repository = await createRepository();

    await repository.renameSessionForHost(1, "api", "api-renamed");

    const renamed = await repository.listByUserAndHost("user-1", 1);
    expect(renamed.get("api-renamed")).toEqual(["prod", "critical"]);
    expect(renamed.has("api")).toBe(false);

    const other = await repository.listByUserAndHost("user-2", 2);
    expect(other.get("api")).toEqual(["other"]);
  });

  it("deletes tags by host/session", async () => {
    const repository = await createRepository();

    await repository.deleteSessionForHost(1, "api");

    const tags = await repository.listByUserAndHost("user-1", 1);
    expect(tags.has("api")).toBe(false);
    expect(tags.get("worker")).toEqual(["batch"]);
  });

  it("replaces tags for one user/host/session only", async () => {
    const repository = await createRepository();

    await repository.replaceForUserHostSession("user-1", 1, "api", [
      "blue",
      "green",
    ]);

    const tags = await repository.listByUserAndHost("user-1", 1);
    expect(tags.get("api")).toEqual(["blue", "green"]);
    expect(tags.get("worker")).toEqual(["batch"]);

    await repository.replaceForUserHostSession("user-1", 1, "worker", []);
    const cleared = await repository.listByUserAndHost("user-1", 1);
    expect(cleared.has("worker")).toBe(false);
  });
});
