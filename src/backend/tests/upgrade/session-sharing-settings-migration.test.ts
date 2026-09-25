/**
 * The session sharing settings migration.
 *
 * An upgrade must be lossless: an instance with sharing switched off, and a
 * host with sharing switched off, must stay off once the plugin reads its own
 * settings. Running it twice must not duplicate or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface SettingsRow {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
}

const blockedHostIds: number[] = [];
const coreSettings = new Map<string, string>();
const settingsRows: SettingsRow[] = [];

const find = (
  pluginId: string,
  scope: string,
  scopeId: string | null,
  key: string,
) =>
  settingsRows.find(
    (row) =>
      row.pluginId === pluginId &&
      row.scope === scope &&
      row.scopeId === scopeId &&
      row.key === key,
  );

const pluginSettingsRepository = {
  get: async (
    pluginId: string,
    scope: string,
    scopeId: string | null,
    key: string,
  ) => find(pluginId, scope, scopeId, key) ?? null,
  set: async (
    pluginId: string,
    scope: string,
    scopeId: string | null,
    key: string,
    value: string | null,
  ) => {
    const existing = find(pluginId, scope, scopeId, key);
    if (existing) {
      existing.value = value;
      return;
    }
    settingsRows.push({ pluginId, scope, scopeId, key, value });
  },
};

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginSettingsRepository: () => pluginSettingsRepository,
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => coreSettings.get(key) ?? null,
  }),
}));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => ({
    all: async () => blockedHostIds.map((id) => ({ id })),
  }),
}));

const { runSessionSharingSettingsMigration } =
  await import("../../upgrade/session-sharing-settings-migration.js");

function stored(scopeId: string | null, key: string): unknown {
  const row = settingsRows.find(
    (entry) => entry.scopeId === scopeId && entry.key === key,
  );
  return row?.value == null ? undefined : JSON.parse(row.value);
}

beforeEach(() => {
  blockedHostIds.length = 0;
  coreSettings.clear();
  settingsRows.length = 0;
});

describe("runSessionSharingSettingsMigration", () => {
  it("moves a disabled global switch into the admin setting", async () => {
    coreSettings.set("session_sharing_globally_enabled", "false");

    const result = await runSessionSharingSettingsMigration();

    expect(result.movedGlobal).toBe(true);
    expect(stored(null, "globallyEnabled")).toBe(false);
    expect(settingsRows[0]).toMatchObject({
      pluginId: "session-sharing",
      scope: "admin",
    });
  });

  it("moves hosts that turned sharing off into host settings", async () => {
    blockedHostIds.push(4, 9);

    const result = await runSessionSharingSettingsMigration();

    expect(result.movedHosts).toBe(2);
    expect(stored("4", "allowSessionSharing")).toBe(false);
    expect(stored("9", "allowSessionSharing")).toBe(false);
  });

  it("writes nothing when sharing was on everywhere", async () => {
    coreSettings.set("session_sharing_globally_enabled", "true");

    const result = await runSessionSharingSettingsMigration();

    expect(result).toEqual({ movedGlobal: false, movedHosts: 0, skipped: 0 });
    expect(settingsRows).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    coreSettings.set("session_sharing_globally_enabled", "false");
    blockedHostIds.push(2);

    await runSessionSharingSettingsMigration();
    const afterFirst = JSON.parse(JSON.stringify(settingsRows));
    const second = await runSessionSharingSettingsMigration();

    expect(second.movedGlobal).toBe(false);
    expect(second.movedHosts).toBe(0);
    expect(second.skipped).toBe(2);
    expect(settingsRows).toEqual(afterFirst);
  });

  it("does not overwrite a value the plugin already saved", async () => {
    blockedHostIds.push(5);
    await pluginSettingsRepository.set(
      "session-sharing",
      "host",
      "5",
      "allowSessionSharing",
      "true",
    );

    const result = await runSessionSharingSettingsMigration();

    expect(result.skipped).toBe(1);
    expect(stored("5", "allowSessionSharing")).toBe(true);
  });
});
