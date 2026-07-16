import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { C2sTunnelPresetRepository } from "../../../database/repositories/c2s-tunnel-preset-repository.js";

describe("C2sTunnelPresetRepository", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<C2sTunnelPresetRepository> {
    adapter = new TestSqliteDatabase();
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL
      );

      CREATE TABLE c2s_tunnel_presets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id TEXT NOT NULL,
        name TEXT NOT NULL,
        config TEXT NOT NULL,
        platform TEXT,
        computer_name TEXT,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash'), ('user-2', 'bob', 'hash');
    `);

    return new C2sTunnelPresetRepository(context, onWrite);
  }

  it("creates and lists presets ordered by name", async () => {
    const repo = await createRepository();

    await repo.createForUser("user-1", {
      name: "Zulu",
      config: "[]",
      platform: "linux",
      computerName: "workstation",
    });
    await repo.createForUser("user-1", { name: "Alpha", config: "[]" });
    await repo.createForUser("user-2", { name: "Other", config: "[]" });

    const presets = await repo.listByUserId("user-1");

    expect(presets.map((preset) => preset.name)).toEqual(["Alpha", "Zulu"]);
    expect(presets[1]).toMatchObject({
      platform: "linux",
      computerName: "workstation",
    });
  });

  it("finds, updates, and deletes user-owned presets", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    const preset = await repo.createForUser("user-1", {
      name: "Home",
      config: "[]",
    });
    expect(writeCount).toBe(1);

    expect(await repo.findByIdForUser("user-2", preset.id)).toBeNull();
    expect(await repo.hasNameForUser("user-1", "Home")).toBe(true);
    expect(await repo.hasNameForUser("user-1", "Home", preset.id)).toBe(false);

    const updated = await repo.updateForUser("user-1", preset.id, {
      name: "Renamed",
      platform: "darwin",
    });
    expect(updated).toMatchObject({
      id: preset.id,
      name: "Renamed",
      platform: "darwin",
    });
    expect(writeCount).toBe(2);

    expect(
      await repo.updateForUser("user-2", preset.id, { name: "Nope" }),
    ).toBeNull();
    expect(writeCount).toBe(2);

    expect(await repo.deleteForUser("user-2", preset.id)).toBe(false);
    expect(await repo.deleteForUser("user-1", preset.id)).toBe(true);
    expect(writeCount).toBe(3);
  });

  it("deletes all presets for a user", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.createForUser("user-1", { name: "One", config: "[]" });
    await repo.createForUser("user-1", { name: "Two", config: "[]" });
    await repo.createForUser("user-2", { name: "Other", config: "[]" });

    await expect(repo.deleteByUserId("user-1")).resolves.toBe(2);
    await expect(repo.deleteByUserId("missing")).resolves.toBe(0);

    expect(await repo.listByUserId("user-1")).toEqual([]);
    expect(
      (await repo.listByUserId("user-2")).map((preset) => preset.name),
    ).toEqual(["Other"]);
    expect(writeCount).toBe(4);
  });
});
