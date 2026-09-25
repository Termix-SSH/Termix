/**
 * The SSH terminal settings migration.
 *
 * An upgrade must be lossless: an install's session timeout, command history
 * switch, touch tuning and image storage settings, and every host that turned
 * a terminal switch off, must come through into the plugin's own settings.
 * Running it twice must not duplicate or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
  encrypted: boolean;
}

interface HostRow {
  id: number;
  enable_terminal: number | null;
  enable_terminal_toolbar: number | null;
  enable_command_history: number | null;
}

const coreSettings = new Map<string, string>();
const pluginRows: Row[] = [];
const hostRows: HostRow[] = [];
let pluginInstalled = true;

const find = (
  pluginId: string,
  scope: string,
  scopeId: string | null,
  key: string,
) =>
  pluginRows.find(
    (row) =>
      row.pluginId === pluginId &&
      row.scope === scope &&
      row.scopeId === scopeId &&
      row.key === key,
  );

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      pluginInstalled && id === "ssh-terminal" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
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
      encrypted = false,
    ) => {
      const existing = find(pluginId, scope, scopeId, key);
      if (existing) {
        existing.value = value;
        existing.encrypted = encrypted;
        return;
      }
      pluginRows.push({ pluginId, scope, scopeId, key, value, encrypted });
    },
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => coreSettings.get(key) ?? null,
  }),
}));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => ({
    all: async () =>
      hostRows.filter(
        (row) =>
          row.enable_terminal === 0 ||
          row.enable_terminal_toolbar === 0 ||
          row.enable_command_history === 0,
      ),
  }),
}));

vi.mock("../../utils/system-secret-crypto.js", () => ({
  encryptSystemSecret: async (plaintext: string) =>
    plaintext.startsWith("sysenc:") ? plaintext : `sysenc:${plaintext}`,
}));

const { runSshTerminalSettingsMigration } =
  await import("../../upgrade/ssh-terminal-settings-migration.js");

function admin(key: string): unknown {
  const row = find("ssh-terminal", "admin", null, key);
  return row?.value == null ? undefined : JSON.parse(row.value);
}

function host(id: number, key: string): unknown {
  const row = find("ssh-terminal", "host", String(id), key);
  return row?.value == null ? undefined : JSON.parse(row.value);
}

beforeEach(() => {
  coreSettings.clear();
  pluginRows.length = 0;
  hostRows.length = 0;
  pluginInstalled = true;
});

describe("runSshTerminalSettingsMigration", () => {
  it("moves the admin settings with their types, the local dir as a secret", async () => {
    coreSettings.set("terminal_session_timeout_minutes", "120");
    coreSettings.set("terminal_session_persistence_enabled", "false");
    coreSettings.set("command_history_enabled", "false");
    coreSettings.set(
      "touch_input_settings",
      JSON.stringify({ enabled: false, dragThresholdPx: 12 }),
    );
    coreSettings.set("terminal_image_storage_mode", "local");
    coreSettings.set("terminal_image_local_dir", "/data/images");
    coreSettings.set("terminal_image_max_count", "50");

    const result = await runSshTerminalSettingsMigration();

    expect(result.moved).toHaveLength(7);
    expect(admin("sessionTimeoutMinutes")).toBe(120);
    expect(admin("sessionPersistence")).toBe(false);
    expect(admin("commandHistoryEnabled")).toBe(false);
    expect(admin("touchInput")).toEqual({
      enabled: false,
      dragThresholdPx: 12,
    });
    expect(admin("imageStorageMode")).toBe("local");
    expect(admin("imageMaxCount")).toBe(50);
    const localDir = find("ssh-terminal", "admin", null, "imageLocalDir");
    expect(localDir?.encrypted).toBe(true);
    expect(JSON.parse(localDir!.value!)).toBe("sysenc:/data/images");
  });

  it("copies each host that switched something off, keeping the rest on", async () => {
    hostRows.push(
      {
        id: 1,
        enable_terminal: 1,
        enable_terminal_toolbar: 0,
        enable_command_history: 1,
      },
      {
        id: 2,
        enable_terminal: 0,
        enable_terminal_toolbar: 1,
        enable_command_history: 0,
      },
      {
        id: 3,
        enable_terminal: 1,
        enable_terminal_toolbar: 1,
        enable_command_history: 1,
      },
    );

    const result = await runSshTerminalSettingsMigration();

    expect(result.hostsMoved).toBe(2);
    expect(host(1, "enableTerminal")).toBe(true);
    expect(host(1, "enableTerminalToolbar")).toBe(false);
    expect(host(1, "enableCommandHistory")).toBe(true);
    expect(host(2, "enableTerminal")).toBe(false);
    expect(host(2, "enableCommandHistory")).toBe(false);
    // All on is the plugin's default, so it needs no row.
    expect(host(3, "enableTerminal")).toBeUndefined();
  });

  it("changes nothing on a second run, even after the admin changed a value", async () => {
    coreSettings.set("terminal_session_timeout_minutes", "120");
    hostRows.push({
      id: 1,
      enable_terminal: 0,
      enable_terminal_toolbar: 1,
      enable_command_history: 1,
    });
    await runSshTerminalSettingsMigration();

    const changed = find(
      "ssh-terminal",
      "admin",
      null,
      "sessionTimeoutMinutes",
    );
    changed!.value = JSON.stringify(15);
    const rowsBefore = pluginRows.length;

    const second = await runSshTerminalSettingsMigration();

    expect(second.moved).toEqual([]);
    expect(second.hostsMoved).toBe(0);
    expect(second.hostsSkipped).toBe(1);
    expect(pluginRows).toHaveLength(rowsBefore);
    expect(admin("sessionTimeoutMinutes")).toBe(15);
  });

  it("does nothing until the plugin row exists", async () => {
    pluginInstalled = false;
    coreSettings.set("terminal_session_timeout_minutes", "120");
    const result = await runSshTerminalSettingsMigration();
    expect(result.moved).toEqual([]);
    expect(pluginRows).toEqual([]);
  });
});
