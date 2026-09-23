/**
 * The file-manager host-columns migration.
 *
 * An upgrade must be lossless: a host that had file manager disabled, a
 * custom default path, or SCP legacy mode on must keep that configuration
 * once the ssh_data columns are dropped. Running it twice must not duplicate
 * or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface HostRow {
  id: number;
  enable_file_manager: boolean;
  default_path: string | null;
  scp_legacy: boolean;
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

const pluginSettingsRepository = {
  get: async (
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
    ) ?? null,
  set: async (
    pluginId: string,
    scope: string,
    scopeId: string | null,
    key: string,
    value: string | null,
  ) => {
    const existing = settingsRows.find(
      (row) =>
        row.pluginId === pluginId &&
        row.scope === scope &&
        row.scopeId === scopeId &&
        row.key === key,
    );
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
    all: async () =>
      hostRows.filter(
        (row) =>
          row.enable_file_manager === false ||
          row.default_path !== null ||
          row.scp_legacy,
      ),
  }),
}));

const { runFileManagerSettingsMigration } =
  await import("../../utils/crypto-migration/file-manager-settings-migration.js");

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

describe("runFileManagerSettingsMigration", () => {
  it("moves a host with file manager disabled into plugin settings", async () => {
    hostRows.push({
      id: 1,
      enable_file_manager: false,
      default_path: "/srv/app",
      scp_legacy: true,
    });

    const result = await runFileManagerSettingsMigration();

    expect(result.moved).toBe(1);
    expect(storedValue(1, "enableFileManager")).toBe(false);
    expect(storedValue(1, "defaultPath")).toBe("/srv/app");
    expect(storedValue(1, "scpLegacy")).toBe(true);
  });

  it("does nothing on a fresh install with no non-default hosts", async () => {
    const result = await runFileManagerSettingsMigration();

    expect(result.moved).toBe(0);
    expect(settingsRows).toEqual([]);
  });

  it("is idempotent: a second run changes nothing", async () => {
    hostRows.push({
      id: 2,
      enable_file_manager: false,
      default_path: null,
      scp_legacy: false,
    });

    await runFileManagerSettingsMigration();
    const afterFirst = JSON.parse(JSON.stringify(settingsRows));

    const second = await runFileManagerSettingsMigration();

    expect(second.moved).toBe(0);
    expect(second.skipped).toBe(1);
    expect(settingsRows).toEqual(afterFirst);
  });

  it("moves each host independently", async () => {
    hostRows.push(
      {
        id: 1,
        enable_file_manager: false,
        default_path: null,
        scp_legacy: false,
      },
      {
        id: 2,
        enable_file_manager: true,
        default_path: "/data",
        scp_legacy: false,
      },
    );

    const result = await runFileManagerSettingsMigration();

    expect(result.moved).toBe(2);
    expect(storedValue(1, "enableFileManager")).toBe(false);
    expect(storedValue(2, "defaultPath")).toBe("/data");
  });
});
