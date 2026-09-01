import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { WorkspaceRepository } from "../../../database/repositories/workspace-repository.js";

describe("WorkspaceRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<WorkspaceRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new WorkspaceRepository(context, onWrite);
  }

  it("creates and lists manual workspaces scoped to the owning user", async () => {
    const repo = await createRepository();

    await repo.create("user-1", { name: "Prod Debugging", payload: "{}" });
    await repo.create("user-2", { name: "Other user's", payload: "{}" });

    const list = await repo.listByUser("user-1");
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({
      userId: "user-1",
      name: "Prod Debugging",
      kind: "manual",
      isDefault: false,
    });
    expect(list[0].syncId).toBeTruthy();
  });

  it("finds a workspace by id scoped to the owner", async () => {
    const repo = await createRepository();
    const created = await repo.create("user-1", {
      name: "Test A",
      payload: "{}",
    });

    expect(await repo.findById("user-1", created.id)).toMatchObject({
      id: created.id,
    });
    expect(await repo.findById("user-2", created.id)).toBeNull();
  });

  it("upsertLastSession creates then updates a single row, never a second one", async () => {
    const repo = await createRepository();

    const first = await repo.upsertLastSession("user-1", '{"tabs":[]}');
    expect(first.kind).toBe("last_session");

    const second = await repo.upsertLastSession(
      "user-1",
      '{"tabs":[{"slotId":"a"}]}',
    );
    expect(second.id).toBe(first.id);
    expect(second.payload).toBe('{"tabs":[{"slotId":"a"}]}');

    const all = await repo.listByUser("user-1");
    expect(all.filter((w) => w.kind === "last_session")).toHaveLength(1);
  });

  it("update renames/recolors a manual workspace but rejects last_session", async () => {
    const repo = await createRepository();
    const manual = await repo.create("user-1", {
      name: "Old Name",
      payload: "{}",
    });
    const lastSession = await repo.upsertLastSession("user-1", "{}");

    const updated = await repo.update("user-1", manual.id, {
      name: "New Name",
      color: "#fff",
    });
    expect(updated).toMatchObject({ name: "New Name", color: "#fff" });

    const rejected = await repo.update("user-1", lastSession.id, {
      name: "Should not work",
    });
    expect(rejected).toBeNull();
  });

  it("updateContent overwrites payload for a manual workspace but rejects last_session", async () => {
    const repo = await createRepository();
    const manual = await repo.create("user-1", {
      name: "Test A",
      payload: "{}",
    });
    const lastSession = await repo.upsertLastSession("user-1", "{}");

    const updated = await repo.updateContent(
      "user-1",
      manual.id,
      '{"tabs":[1]}',
    );
    expect(updated?.payload).toBe('{"tabs":[1]}');

    const rejected = await repo.updateContent(
      "user-1",
      lastSession.id,
      '{"tabs":[2]}',
    );
    expect(rejected).toBeNull();
  });

  it("setDefault clears any prior default and rejects last_session", async () => {
    const repo = await createRepository();
    const a = await repo.create("user-1", { name: "A", payload: "{}" });
    const b = await repo.create("user-1", { name: "B", payload: "{}" });
    const lastSession = await repo.upsertLastSession("user-1", "{}");

    await repo.setDefault("user-1", a.id);
    expect((await repo.findById("user-1", a.id))?.isDefault).toBe(true);

    await repo.setDefault("user-1", b.id);
    expect((await repo.findById("user-1", a.id))?.isDefault).toBe(false);
    expect((await repo.findById("user-1", b.id))?.isDefault).toBe(true);

    const rejected = await repo.setDefault("user-1", lastSession.id);
    expect(rejected).toBeNull();
  });

  it("unsetDefault clears isDefault on a manual workspace and rejects last_session", async () => {
    const repo = await createRepository();
    const a = await repo.create("user-1", { name: "A", payload: "{}" });
    const lastSession = await repo.upsertLastSession("user-1", "{}");

    await repo.setDefault("user-1", a.id);
    expect((await repo.findById("user-1", a.id))?.isDefault).toBe(true);

    await repo.unsetDefault("user-1", a.id);
    expect((await repo.findById("user-1", a.id))?.isDefault).toBe(false);

    const rejected = await repo.unsetDefault("user-1", lastSession.id);
    expect(rejected).toBeNull();
  });

  it("touchLastUsed sets lastUsedAt", async () => {
    const repo = await createRepository();
    const workspace = await repo.create("user-1", {
      name: "A",
      payload: "{}",
    });
    expect(workspace.lastUsedAt).toBeNull();

    await repo.touchLastUsed(
      "user-1",
      workspace.id,
      "2026-08-11T00:00:00.000Z",
    );
    expect((await repo.findById("user-1", workspace.id))?.lastUsedAt).toBe(
      "2026-08-11T00:00:00.000Z",
    );
  });

  it("delete removes a manual workspace but rejects last_session", async () => {
    const repo = await createRepository();
    const manual = await repo.create("user-1", { name: "A", payload: "{}" });
    const lastSession = await repo.upsertLastSession("user-1", "{}");

    await expect(repo.delete("user-1", lastSession.id)).resolves.toBe(false);
    await expect(repo.delete("user-1", manual.id)).resolves.toBe(true);
    expect(await repo.findById("user-1", manual.id)).toBeNull();
  });

  it("triggers writes on create/update/delete", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const created = await repo.create("user-1", {
      name: "A",
      payload: "{}",
    });
    await repo.update("user-1", created.id, { name: "B" });
    await repo.delete("user-1", created.id);

    expect(writeCount).toBe(3);
  });

  it("deleteByUserId removes every workspace owned by the user", async () => {
    const repo = await createRepository();
    await repo.create("user-1", { name: "A", payload: "{}" });
    await repo.create("user-1", { name: "B", payload: "{}" });
    await repo.create("user-2", { name: "C", payload: "{}" });

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(2);
    expect(await repo.listByUser("user-1")).toHaveLength(0);
    expect(await repo.listByUser("user-2")).toHaveLength(1);
  });
});
