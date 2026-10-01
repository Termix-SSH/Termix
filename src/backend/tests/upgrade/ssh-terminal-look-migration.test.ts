/**
 * The terminal's look and behavior moving out of ssh_data.terminal_config and
 * user_preferences into the ssh-terminal plugin's settings. Lossless, and a
 * second run changes nothing.
 */

import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
}

const state = vi.hoisted(() => ({
  db: null as unknown,
  rows: [] as Row[],
  installed: true,
}));

const find = (scope: string, scopeId: string | null, key: string) =>
  state.rows.find(
    (row) =>
      row.pluginId === "ssh-terminal" &&
      row.scope === scope &&
      row.scopeId === scopeId &&
      row.key === key,
  );

vi.mock("../../database/db/index.js", () => ({ getDb: () => state.db }));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.installed && id === "ssh-terminal" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      _pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) => find(scope, scopeId, key) ?? null,
    getAllForScopeIds: async (scope: string, scopeIds: string[]) =>
      state.rows.filter(
        (row) => row.scope === scope && scopeIds.includes(row.scopeId ?? ""),
      ),
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      const existing = find(scope, scopeId, key);
      if (existing) existing.value = value;
      else state.rows.push({ pluginId, scope, scopeId, key, value });
    },
  }),
}));

const {
  runSshTerminalLookMigration,
  hostSettingsFromTerminalConfig,
  userSettingsFromPreferences,
} = await import("../../upgrade/ssh-terminal-look-migration.js");

let sqlite: Database.Database;

beforeEach(() => {
  state.rows.length = 0;
  state.installed = true;
  sqlite = new Database(":memory:");
  sqlite.exec(`
    CREATE TABLE ssh_data (id INTEGER PRIMARY KEY, terminal_config TEXT);
    CREATE TABLE user_preferences (
      user_id TEXT PRIMARY KEY,
      terminal_defaults TEXT,
      custom_themes TEXT,
      command_autocomplete INTEGER
    );
  `);
  state.db = drizzle(sqlite);
});

function host(id: number, key: string): unknown {
  const row = find("host", String(id), key);
  return row?.value == null ? undefined : JSON.parse(row.value);
}

function user(id: string, key: string): unknown {
  const row = find("user", id, key);
  return row?.value == null ? undefined : JSON.parse(row.value);
}

describe("hostSettingsFromTerminalConfig", () => {
  it("keeps a host that followed the user's look following it", () => {
    expect(
      hostSettingsFromTerminalConfig(
        JSON.stringify({
          autoTmux: true,
          localEcho: "on",
          keepaliveInterval: 30,
          startupSnippetId: 3,
        }),
      ),
    ).toEqual({ autoTmux: true, localEcho: "on" });
  });

  it("opts a host with its own look out of the user's defaults", () => {
    expect(
      hostSettingsFromTerminalConfig({
        theme: "Termix Dark",
        fontSize: "16",
        cursorStyle: "wobble",
        bellStyle: "visual",
      }),
    ).toEqual({
      inheritAppearance: false,
      theme: "termix",
      fontSize: 16,
      bellStyle: "visual",
    });
  });

  it("reads nothing out of garbage", () => {
    expect(hostSettingsFromTerminalConfig("not json")).toEqual({});
    expect(hostSettingsFromTerminalConfig(null)).toEqual({});
  });
});

describe("userSettingsFromPreferences", () => {
  it("takes the defaults, saved themes and autocomplete", () => {
    expect(
      userSettingsFromPreferences({
        terminal_defaults: JSON.stringify({ fontSize: 18, theme: "nord" }),
        custom_themes: JSON.stringify([
          { id: "a", name: "Mine", colors: { background: "#000" } },
        ]),
        command_autocomplete: 1,
      }),
    ).toEqual({
      terminalDefaults: { fontSize: 18, theme: "nord" },
      customThemes: [{ id: "a", name: "Mine", colors: { background: "#000" } }],
      commandAutocomplete: true,
    });
    expect(userSettingsFromPreferences({ command_autocomplete: null })).toEqual(
      {},
    );
  });
});

describe("runSshTerminalLookMigration", () => {
  function seed() {
    sqlite.prepare("INSERT INTO ssh_data VALUES (?, ?)").run(
      1,
      JSON.stringify({
        theme: "dracula",
        fontSize: 18,
        autoTmux: true,
        sudoPasswordAutoFill: true,
        keepaliveInterval: 30,
      }),
    );
    sqlite
      .prepare("INSERT INTO ssh_data VALUES (?, ?)")
      .run(2, JSON.stringify({ passwordPromptAutoFill: false }));
    sqlite
      .prepare("INSERT INTO ssh_data VALUES (?, ?)")
      .run(3, JSON.stringify({ keepaliveInterval: 10 }));
    sqlite.prepare("INSERT INTO ssh_data VALUES (?, ?)").run(4, null);
    sqlite
      .prepare("INSERT INTO user_preferences VALUES (?, ?, ?, ?)")
      .run(
        "u1",
        JSON.stringify({ cursorBlink: false }),
        JSON.stringify([
          { id: "t", name: "T", colors: { background: "#111" } },
        ]),
        1,
      );
    sqlite
      .prepare("INSERT INTO user_preferences VALUES (?, ?, ?, ?)")
      .run("u2", null, null, null);
  }

  it("copies each host's terminal keys and each user's terminal preferences", async () => {
    seed();
    const result = await runSshTerminalLookMigration();

    expect(result).toEqual({ hostsMoved: 2, hostsSkipped: 0, usersMoved: 1 });
    expect(host(1, "inheritAppearance")).toBe(false);
    expect(host(1, "theme")).toBe("dracula");
    expect(host(1, "fontSize")).toBe(18);
    expect(host(1, "autoTmux")).toBe(true);
    expect(host(1, "sudoPasswordAutoFill")).toBe(true);
    expect(host(1, "keepaliveInterval")).toBeUndefined();
    expect(host(2, "passwordPromptAutoFill")).toBe(false);
    expect(host(2, "inheritAppearance")).toBeUndefined();
    expect(host(3, "keepaliveInterval")).toBeUndefined();
    expect(user("u1", "terminalDefaults")).toEqual({ cursorBlink: false });
    expect(user("u1", "customThemes")).toHaveLength(1);
    expect(user("u1", "commandAutocomplete")).toBe(true);
    expect(state.rows.some((row) => row.scopeId === "u2")).toBe(false);
  });

  it("changes nothing on a second run, even after values were edited", async () => {
    seed();
    await runSshTerminalLookMigration();
    find("host", "1", "fontSize")!.value = JSON.stringify(12);
    find("user", "u1", "commandAutocomplete")!.value = JSON.stringify(false);
    const before = JSON.stringify(state.rows);

    const second = await runSshTerminalLookMigration();

    expect(second).toEqual({ hostsMoved: 0, hostsSkipped: 2, usersMoved: 0 });
    expect(JSON.stringify(state.rows)).toBe(before);
    expect(host(1, "fontSize")).toBe(12);
  });

  it("waits for the plugin row", async () => {
    seed();
    state.installed = false;
    expect(await runSshTerminalLookMigration()).toEqual({
      hostsMoved: 0,
      hostsSkipped: 0,
      usersMoved: 0,
    });
    expect(state.rows).toEqual([]);
  });

  it("copies nothing from a database without the columns", async () => {
    sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE ssh_data (id INTEGER PRIMARY KEY)");
    state.db = drizzle(sqlite);
    expect(await runSshTerminalLookMigration()).toEqual({
      hostsMoved: 0,
      hostsSkipped: 0,
      usersMoved: 0,
    });
  });
});
