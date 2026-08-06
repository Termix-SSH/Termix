import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sqlite: null as unknown as Database.Database,
  settings: new Map<string, string>(),
  saves: [] as string[],
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings.get(key) ?? null,
    set: async (key: string, value: string) => {
      state.settings.set(key, value);
    },
  }),
  getCurrentRepositorySqlite: () => state.sqlite,
}));

vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: {
    forceSave: async (reason: string) => {
      state.saves.push(reason);
    },
  },
}));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}));

import { runPrivateSharedSshAuthMigration } from "../../../utils/crypto-migration/private-shared-ssh-auth-migration.js";

beforeEach(() => {
  state.sqlite = new Database(":memory:");
  state.sqlite.exec(`
    CREATE TABLE ssh_data (
      id INTEGER PRIMARY KEY,
      share_ssh_auth INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE host_access (
      id INTEGER PRIMARY KEY,
      host_id INTEGER NOT NULL
    );
    CREATE TABLE shared_host_secrets (
      id INTEGER PRIMARY KEY,
      host_access_id INTEGER NOT NULL,
      protocol TEXT NOT NULL
    );
    INSERT INTO ssh_data (id, share_ssh_auth)
    VALUES (1, 1), (2, 0);
    INSERT INTO host_access (id, host_id)
    VALUES (10, 1), (20, 2);
    INSERT INTO shared_host_secrets (id, host_access_id, protocol)
    VALUES
      (1, 10, 'ssh'),
      (2, 10, 'rdp'),
      (3, 20, 'ssh'),
      (4, 20, 'vnc');
  `);
  state.settings.clear();
  state.saves = [];
});

afterEach(() => {
  state.sqlite.close();
});

describe("runPrivateSharedSshAuthMigration", () => {
  it("preserves opted-in SSH snapshots and removes only private ones", async () => {
    expect(await runPrivateSharedSshAuthMigration()).toBe(1);
    expect(
      state.sqlite
        .prepare(
          "SELECT host_access_id, protocol FROM shared_host_secrets ORDER BY id",
        )
        .all(),
    ).toEqual([
      { host_access_id: 10, protocol: "ssh" },
      { host_access_id: 10, protocol: "rdp" },
      { host_access_id: 20, protocol: "vnc" },
    ]);
    expect(state.settings.get("private_shared_ssh_auth_v1")).toBe("done");
    expect(state.saves).toEqual(["private_shared_ssh_auth_migration"]);
  });

  it("is idempotent", async () => {
    state.settings.set("private_shared_ssh_auth_v1", "done");

    expect(await runPrivateSharedSshAuthMigration()).toBeNull();
    expect(
      state.sqlite
        .prepare("SELECT COUNT(*) AS count FROM shared_host_secrets")
        .get(),
    ).toEqual({ count: 4 });
    expect(state.saves).toHaveLength(0);
  });
});
