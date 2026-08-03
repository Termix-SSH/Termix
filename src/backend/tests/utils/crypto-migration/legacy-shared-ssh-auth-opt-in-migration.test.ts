import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  sqlite: null as unknown as Database.Database,
  settings: new Map<string, string>(),
  resyncedHostIds: [] as number[],
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

vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({
      resyncHost: async (hostId: number) => {
        state.resyncedHostIds.push(hostId);
      },
    }),
  },
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

import { runLegacySharedSshAuthOptInMigration } from "../../../utils/crypto-migration/legacy-shared-ssh-auth-opt-in-migration.js";

beforeEach(() => {
  state.sqlite = new Database(":memory:");
  state.sqlite.exec(`
    CREATE TABLE ssh_data (
      id INTEGER PRIMARY KEY,
      share_ssh_auth INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE host_access (
      id INTEGER PRIMARY KEY,
      host_id INTEGER NOT NULL,
      expires_at TEXT
    );
    CREATE TABLE shared_host_secrets (
      id INTEGER PRIMARY KEY,
      host_access_id INTEGER NOT NULL,
      protocol TEXT NOT NULL
    );
    INSERT INTO ssh_data (id, share_ssh_auth)
    VALUES (1, 0), (2, 0), (3, 1), (4, 0), (5, 0);
    INSERT INTO host_access (id, host_id, expires_at)
    VALUES
      (10, 1, NULL),
      (30, 3, NULL),
      (40, 4, NULL),
      (50, 5, '2000-01-01T00:00:00.000Z');
    INSERT INTO shared_host_secrets (id, host_access_id, protocol)
    VALUES
      (100, 10, 'ssh'),
      (400, 40, 'rdp'),
      (500, 50, 'ssh');
  `);
  state.settings.clear();
  state.resyncedHostIds = [];
  state.saves = [];
});

afterEach(() => {
  state.sqlite.close();
});

describe("runLegacySharedSshAuthOptInMigration", () => {
  it("preserves preexisting sharing while leaving unshared hosts private", async () => {
    await expect(runLegacySharedSshAuthOptInMigration()).resolves.toEqual({
      enabled: 1,
      resynced: 2,
      skipped: 0,
    });

    expect(
      state.sqlite
        .prepare("SELECT id, share_ssh_auth FROM ssh_data ORDER BY id")
        .all(),
    ).toEqual([
      { id: 1, share_ssh_auth: 1 },
      { id: 2, share_ssh_auth: 0 },
      { id: 3, share_ssh_auth: 1 },
      { id: 4, share_ssh_auth: 0 },
      { id: 5, share_ssh_auth: 0 },
    ]);
    expect(state.resyncedHostIds).toEqual([1, 3]);
    expect(state.settings.get("legacy_shared_ssh_auth_opt_in_v1")).toBe("done");
    expect(state.saves).toEqual(["legacy_shared_ssh_auth_opt_in_migration"]);
  });

  it("recognizes a legacy SSH credential snapshot as prior sharing evidence", async () => {
    state.sqlite.exec(`
      CREATE TABLE shared_credentials (
        id INTEGER PRIMARY KEY,
        host_access_id INTEGER NOT NULL
      );
      INSERT INTO shared_credentials (id, host_access_id) VALUES (1, 40);
    `);

    await expect(runLegacySharedSshAuthOptInMigration()).resolves.toEqual({
      enabled: 2,
      resynced: 3,
      skipped: 0,
    });

    expect(
      state.sqlite
        .prepare("SELECT share_ssh_auth FROM ssh_data WHERE id = 4")
        .get(),
    ).toEqual({ share_ssh_auth: 1 });
    expect(state.resyncedHostIds).toEqual([1, 3, 4]);
  });

  it("is idempotent", async () => {
    await runLegacySharedSshAuthOptInMigration();
    state.resyncedHostIds = [];
    state.saves = [];

    expect(await runLegacySharedSshAuthOptInMigration()).toBeNull();
    expect(state.resyncedHostIds).toEqual([]);
    expect(state.saves).toEqual([]);
  });

  it("does not re-share private hosts after the privacy migration has run", async () => {
    state.settings.set("private_shared_ssh_auth_v1", "done");

    await expect(runLegacySharedSshAuthOptInMigration()).resolves.toEqual({
      enabled: 0,
      resynced: 1,
      skipped: 0,
    });

    expect(
      state.sqlite
        .prepare("SELECT share_ssh_auth FROM ssh_data WHERE id = 1")
        .get(),
    ).toEqual({ share_ssh_auth: 0 });
    expect(state.resyncedHostIds).toEqual([3]);
  });
});
