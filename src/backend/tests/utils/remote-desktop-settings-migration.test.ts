/**
 * The Remote Desktop settings migration.
 *
 * An upgrade must be lossless: the admin switch and guacd address, each
 * user's RDP defaults and every host's RDP/VNC/Telnet options must come
 * through into the plugin's own settings, whatever shape an old host had.
 * Running it twice must not duplicate or clobber what it moved.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
}

const state = vi.hoisted(() => ({
  coreSettings: new Map<string, string>(),
  pluginRows: [] as Array<{
    pluginId: string;
    scope: string;
    scopeId: string | null;
    key: string;
    value: string | null;
  }>,
  hostRows: [] as Array<Record<string, unknown>>,
  userRows: [] as Array<{ user_id: string; rdp_defaults: string | null }>,
  statements: [] as string[],
  pluginInstalled: true,
}));

const find = (scope: string, scopeId: string | null, key: string) =>
  state.pluginRows.find(
    (row) => row.scope === scope && row.scopeId === scopeId && row.key === key,
  );

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "remote-desktop" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      _pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) => find(scope, scopeId, key) ?? null,
    getAll: async (_pluginId: string, scope: string, scopeId: string | null) =>
      state.pluginRows.filter(
        (row) => row.scope === scope && row.scopeId === scopeId,
      ),
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      const existing = find(scope, scopeId, key);
      if (existing) {
        existing.value = value;
        return;
      }
      state.pluginRows.push({ pluginId, scope, scopeId, key, value });
    },
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.coreSettings.get(key) ?? null,
  }),
}));

vi.mock("../../utils/crypto-migration/raw-rows.js", () => ({
  selectRows: async (query: { queryChunks?: unknown[] }) => {
    const text = JSON.stringify(query.queryChunks ?? query);
    return text.includes("user_preferences") ? state.userRows : state.hostRows;
  },
  runStatement: async (query: unknown) => {
    state.statements.push(JSON.stringify(query));
  },
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

const { runRemoteDesktopSettingsMigration, hostSettingsFromRow } =
  await import("../../utils/crypto-migration/remote-desktop-settings-migration.js");

const value = (scope: string, scopeId: string | null, key: string) => {
  const row = find(scope, scopeId, key) as Row | undefined;
  return row?.value == null ? undefined : JSON.parse(row.value);
};

function host(overrides: Record<string, unknown>) {
  return {
    id: 1,
    port: 22,
    connection_type: "ssh",
    enable_rdp: 0,
    enable_vnc: 0,
    enable_telnet: 0,
    rdp_port: 3389,
    vnc_port: 5900,
    telnet_port: 23,
    rdp_security: null,
    rdp_ignore_cert: 0,
    security: null,
    ignore_cert: 0,
    guacamole_config: null,
    enable_terminal_toolbar: 1,
    ...overrides,
  };
}

beforeEach(() => {
  state.coreSettings.clear();
  state.pluginRows.length = 0;
  state.hostRows.length = 0;
  state.userRows.length = 0;
  state.statements.length = 0;
  state.pluginInstalled = true;
});

describe("runRemoteDesktopSettingsMigration", () => {
  it("moves the admin switch and guacd address", async () => {
    state.coreSettings.set("guac_enabled", "false");
    state.coreSettings.set("guac_url", "guacd:4822");

    const result = await runRemoteDesktopSettingsMigration();

    expect(result.moved).toEqual(["guac_enabled", "guac_url"]);
    expect(value("admin", null, "enabled")).toBe(false);
    expect(value("admin", null, "guacdUrl")).toBe("guacd:4822");
  });

  it("moves a host's options, reading SQLite's 0 and 1 as booleans", async () => {
    state.hostRows.push(
      host({
        id: 7,
        enable_rdp: 1,
        enable_vnc: 0,
        rdp_port: 3390,
        rdp_security: "nla",
        rdp_ignore_cert: 1,
        guacamole_config: JSON.stringify({ "color-depth": 24 }),
        enable_terminal_toolbar: 0,
      }),
    );

    const result = await runRemoteDesktopSettingsMigration();

    expect(result.hostsMoved).toBe(1);
    expect(value("host", "7", "enableRdp")).toBe(true);
    expect(value("host", "7", "enableVnc")).toBeUndefined();
    expect(value("host", "7", "rdpPort")).toBe(3390);
    expect(value("host", "7", "rdpSecurity")).toBe("nla");
    expect(value("host", "7", "rdpIgnoreCert")).toBe(true);
    expect(value("host", "7", "guacamoleConfig")).toEqual({
      "color-depth": 24,
    });
    expect(value("host", "7", "enableToolbar")).toBe(false);
  });

  it("leaves a plain SSH host alone", async () => {
    state.hostRows.push(host({ id: 3 }));
    const result = await runRemoteDesktopSettingsMigration();
    expect(result.hostsMoved).toBe(0);
    expect(state.pluginRows).toHaveLength(0);
  });

  it("reads real booleans too, as Postgres returns them", async () => {
    state.hostRows.push(host({ id: 8, enable_vnc: true, vnc_port: 5901 }));
    await runRemoteDesktopSettingsMigration();
    expect(value("host", "8", "enableVnc")).toBe(true);
    expect(value("host", "8", "vncPort")).toBe(5901);
  });

  it("moves each user's RDP defaults", async () => {
    state.userRows.push({
      user_id: "u1",
      rdp_defaults: JSON.stringify({
        colorDepth: 24,
        resizeMethod: "reconnect",
        disableCopy: true,
        enableWallpaper: false,
      }),
    });
    state.userRows.push({ user_id: "u2", rdp_defaults: null });

    const result = await runRemoteDesktopSettingsMigration();

    expect(result.usersMoved).toBe(1);
    expect(value("user", "u1", "colorDepth")).toBe("24");
    expect(value("user", "u1", "resizeMethod")).toBe("reconnect");
    expect(value("user", "u1", "disableCopy")).toBe("on");
    expect(value("user", "u1", "enableWallpaper")).toBe("off");
  });

  it("changes nothing when run twice", async () => {
    state.coreSettings.set("guac_url", "guacd:4822");
    state.hostRows.push(host({ id: 7, enable_rdp: 1, rdp_port: 3390 }));
    state.userRows.push({
      user_id: "u1",
      rdp_defaults: JSON.stringify({ colorDepth: 16 }),
    });

    await runRemoteDesktopSettingsMigration();
    const firstRun = JSON.stringify(state.pluginRows);
    // Changed after the first run: must not be overwritten by the old values.
    find("host", "7", "rdpPort")!.value = JSON.stringify(4000);
    const second = await runRemoteDesktopSettingsMigration();

    expect(second.moved).toEqual([]);
    expect(second.usersMoved).toBe(0);
    expect(second.hostsMoved).toBe(0);
    expect(second.hostsSkipped).toBe(1);
    expect(value("host", "7", "rdpPort")).toBe(4000);
    expect(JSON.parse(firstRun)).toHaveLength(state.pluginRows.length);
  });

  it("does nothing until the plugin row exists", async () => {
    state.pluginInstalled = false;
    state.coreSettings.set("guac_url", "guacd:4822");
    state.hostRows.push(host({ id: 7, enable_rdp: 1 }));
    await runRemoteDesktopSettingsMigration();
    expect(state.pluginRows).toHaveLength(0);
  });
});

describe("hostSettingsFromRow", () => {
  it("turns a connection_type-only host into its protocol switch and port", () => {
    expect(
      hostSettingsFromRow(
        host({ connection_type: "vnc", port: 5905, vnc_port: null }),
      ),
    ).toEqual({ enableVnc: true, vncPort: 5905 });
  });

  it("folds the older security and ignore_cert columns in", () => {
    expect(
      hostSettingsFromRow(
        host({
          enable_rdp: 1,
          rdp_security: null,
          security: "tls",
          rdp_ignore_cert: null,
          ignore_cert: 1,
        }),
      ),
    ).toEqual({ enableRdp: true, rdpSecurity: "tls", rdpIgnoreCert: true });
  });
});
