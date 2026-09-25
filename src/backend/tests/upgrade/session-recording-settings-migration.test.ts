/**
 * The session logging host-column migration.
 *
 * The legacy column defaulted to true, the plugin's enable switch defaults
 * to false, so every host needs an explicit row, not just the ones that
 * turned it off. Running it twice must not duplicate or clobber what it
 * moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface HostRow {
  id: number;
  enable_session_logging: boolean | number | null;
}

interface SettingsRow {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
}

const hostRows: HostRow[] = [];
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
}));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => ({
    all: async () => hostRows,
  }),
}));

const { runSessionRecordingSettingsMigration } =
  await import("../../upgrade/session-recording-settings-migration.js");

function storedValue(hostId: number, key: string): unknown {
  const row = settingsRows.find(
    (entry) => entry.scopeId === String(hostId) && entry.key === key,
  );
  return row?.value === null || row?.value === undefined
    ? undefined
    : JSON.parse(row.value);
}

beforeEach(() => {
  hostRows.length = 0;
  settingsRows.length = 0;
});

describe("runSessionRecordingSettingsMigration", () => {
  it("moves an enabled host's switch into plugin settings", async () => {
    hostRows.push({ id: 1, enable_session_logging: true });

    const result = await runSessionRecordingSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(1, "enableSessionRecording")).toBe(true);
    expect(
      settingsRows.every((row) => row.pluginId === "session-recording"),
    ).toBe(true);
    expect(settingsRows.every((row) => row.scope === "host")).toBe(true);
  });

  it("moves a disabled host's switch too, since the defaults flipped", async () => {
    hostRows.push({ id: 3, enable_session_logging: false });

    const result = await runSessionRecordingSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(3, "enableSessionRecording")).toBe(false);
  });

  it("reads SQLite 0 and 1 as off and on", async () => {
    hostRows.push({ id: 6, enable_session_logging: 0 });
    hostRows.push({ id: 7, enable_session_logging: 1 });

    await runSessionRecordingSettingsMigration();

    expect(storedValue(6, "enableSessionRecording")).toBe(false);
    expect(storedValue(7, "enableSessionRecording")).toBe(true);
  });

  it("treats a null legacy value as on, matching the old column default", async () => {
    hostRows.push({ id: 4, enable_session_logging: null });

    const result = await runSessionRecordingSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(4, "enableSessionRecording")).toBe(true);
  });

  it("does nothing on a fresh install", async () => {
    const result = await runSessionRecordingSettingsMigration();

    expect(result.moved).toBe(0);
    expect(settingsRows).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    hostRows.push({ id: 2, enable_session_logging: true });

    await runSessionRecordingSettingsMigration();
    const afterFirst = JSON.parse(JSON.stringify(settingsRows));

    const second = await runSessionRecordingSettingsMigration();

    expect(second.moved).toBe(0);
    expect(second.skipped).toBe(1);
    expect(settingsRows).toEqual(afterFirst);
  });

  it("does not overwrite a value the plugin already saved", async () => {
    hostRows.push({ id: 5, enable_session_logging: true });
    await pluginSettingsRepository.set(
      "session-recording",
      "host",
      "5",
      "enableSessionRecording",
      "false",
    );

    const result = await runSessionRecordingSettingsMigration();

    expect(result.skipped).toBe(1);
    expect(storedValue(5, "enableSessionRecording")).toBe(false);
  });
});
