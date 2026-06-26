import { afterEach, describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../runtime/sqlite-adapter.js";
import { UserPreferenceRepository } from "./user-preference-repository.js";

describe("UserPreferenceRepository", () => {
  let adapter: SqliteDatabaseAdapter | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  async function createRepository(
    onWrite?: () => void | Promise<void>,
  ): Promise<UserPreferenceRepository> {
    adapter = new SqliteDatabaseAdapter({
      dialect: "sqlite",
      url: ":memory:",
      sqlitePath: ":memory:",
    });
    const context = await adapter.connect();
    context.sqlite?.exec(`
      CREATE TABLE users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        is_admin INTEGER NOT NULL DEFAULT 0,
        is_oidc INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE user_preferences (
        user_id TEXT PRIMARY KEY,
        reopen_tabs_on_login INTEGER NOT NULL DEFAULT 0,
        theme TEXT,
        font_size TEXT,
        accent_color TEXT,
        language TEXT,
        storage_mode TEXT,
        command_autocomplete INTEGER,
        command_palette_enabled INTEGER,
        show_host_tags INTEGER,
        host_tray_on_click INTEGER,
        pin_app_rail INTEGER,
        folders_collapsed INTEGER,
        confirm_snippet_execution INTEGER,
        disable_update_check INTEGER,
        confirm_tab_close INTEGER,
        hidden_rail_tabs TEXT,
        compact_host_view INTEGER,
        status_color_scheme TEXT,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );

      INSERT INTO users (id, username, password_hash)
      VALUES ('user-1', 'alice', 'hash');
    `);

    return new UserPreferenceRepository(context, onWrite);
  }

  it("finds, creates, and updates preferences by user id", async () => {
    const repo = await createRepository();

    expect(await repo.findByUserId("user-1")).toBeNull();

    const created = await repo.upsert("user-1", {
      reopenTabsOnLogin: true,
      theme: "dark",
      storageMode: "local",
      commandAutocomplete: true,
    });
    expect(created).toMatchObject({
      userId: "user-1",
      reopenTabsOnLogin: true,
      theme: "dark",
      storageMode: "local",
      commandAutocomplete: true,
    });

    const updated = await repo.upsert("user-1", {
      theme: "light",
      commandAutocomplete: false,
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    expect(updated).toMatchObject({
      userId: "user-1",
      reopenTabsOnLogin: true,
      theme: "light",
      storageMode: "local",
      commandAutocomplete: false,
    });
  });

  it("deletes preferences by user id only when rows exist", async () => {
    let writeCount = 0;
    const repo = await createRepository(() => {
      writeCount += 1;
    });

    await repo.upsert("user-1", { theme: "dark" });
    expect(writeCount).toBe(1);

    expect(await repo.deleteByUserId("missing")).toBe(0);
    expect(writeCount).toBe(1);

    expect(await repo.deleteByUserId("user-1")).toBe(1);
    expect(writeCount).toBe(2);
    expect(await repo.findByUserId("user-1")).toBeNull();
  });
});
