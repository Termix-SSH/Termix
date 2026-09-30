/**
 * The snippets settings migration: host quick actions, the startup snippet
 * and the two snippet user preferences must come through into the snippets
 * plugin's settings, and running it twice must change nothing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
}

const pluginRows: Row[] = [];
const hostRows: Array<Record<string, unknown>> = [];
const preferenceRows: Array<Record<string, unknown>> = [];
let pluginInstalled = true;

const find = (scope: string, scopeId: string | null, key: string) =>
  pluginRows.find(
    (row) =>
      row.pluginId === "snippets" &&
      row.scope === scope &&
      row.scopeId === scopeId &&
      row.key === key,
  );

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      pluginInstalled && id === "snippets" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      _pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
    ) => find(scope, scopeId, key) ?? null,
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      const existing = find(scope, scopeId, key);
      if (existing) existing.value = value;
      else pluginRows.push({ pluginId, scope, scopeId, key, value });
    },
  }),
}));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => ({
    all: async (query: unknown) =>
      JSON.stringify(query).includes("user_preferences")
        ? preferenceRows
        : hostRows,
  }),
}));

const { runSnippetsSettingsMigration, snippetHostSettingsFromRow } =
  await import("../../upgrade/snippets-settings-migration.js");

function value(scope: string, scopeId: string, key: string): unknown {
  const row = find(scope, scopeId, key);
  return row?.value == null ? undefined : JSON.parse(row.value);
}

beforeEach(() => {
  pluginRows.length = 0;
  hostRows.length = 0;
  preferenceRows.length = 0;
  pluginInstalled = true;
});

describe("snippetHostSettingsFromRow", () => {
  it("reads quick actions and the startup snippet, dropping broken rows", () => {
    expect(
      snippetHostSettingsFromRow({
        quick_actions: JSON.stringify([
          { name: "Restart", snippetId: 3 },
          { name: "Broken", snippetId: "x" },
          { name: "Str", snippetId: "4" },
        ]),
        terminal_config: JSON.stringify({ fontSize: 14, startupSnippetId: 9 }),
      }),
    ).toEqual({
      quickActions: [
        { name: "Restart", snippetId: 3 },
        { name: "Str", snippetId: 4 },
      ],
      startupSnippetId: 9,
    });
  });

  it("reads nothing from a row without either", () => {
    expect(
      snippetHostSettingsFromRow({
        quick_actions: "[]",
        terminal_config: JSON.stringify({ fontSize: 14 }),
      }),
    ).toEqual({});
  });
});

describe("runSnippetsSettingsMigration", () => {
  it("moves host and user values once", async () => {
    hostRows.push(
      {
        id: 1,
        quick_actions: JSON.stringify([{ name: "Up", snippetId: 2 }]),
        terminal_config: JSON.stringify({ startupSnippetId: 5 }),
      },
      { id: 2, quick_actions: null, terminal_config: "{}" },
    );
    preferenceRows.push(
      { user_id: "u1", confirm_snippet_execution: 1, folders_collapsed: 0 },
      {
        user_id: "u2",
        confirm_snippet_execution: null,
        folders_collapsed: null,
      },
    );

    const first = await runSnippetsSettingsMigration();
    expect(first).toEqual({ hostsMoved: 1, hostsSkipped: 0, usersMoved: 1 });
    expect(value("host", "1", "quickActions")).toEqual([
      { name: "Up", snippetId: 2 },
    ]);
    expect(value("host", "1", "startupSnippetId")).toBe(5);
    expect(value("user", "u1", "confirmExecution")).toBe(true);
    expect(value("user", "u1", "foldersCollapsed")).toBe(false);
    expect(find("user", "u2", "confirmExecution")).toBeUndefined();

    const snapshot = JSON.stringify(pluginRows);
    const second = await runSnippetsSettingsMigration();
    expect(second).toEqual({ hostsMoved: 0, hostsSkipped: 1, usersMoved: 0 });
    expect(JSON.stringify(pluginRows)).toBe(snapshot);
  });

  it("never overwrites what the user already changed in the plugin", async () => {
    pluginRows.push({
      pluginId: "snippets",
      scope: "host",
      scopeId: "1",
      key: "startupSnippetId",
      value: "7",
    });
    hostRows.push({
      id: 1,
      quick_actions: JSON.stringify([{ name: "Up", snippetId: 2 }]),
      terminal_config: JSON.stringify({ startupSnippetId: 5 }),
    });
    await runSnippetsSettingsMigration();
    expect(value("host", "1", "startupSnippetId")).toBe(7);
    expect(find("host", "1", "quickActions")).toBeUndefined();
  });

  it("does nothing while the plugin is not installed", async () => {
    pluginInstalled = false;
    hostRows.push({
      id: 1,
      quick_actions: JSON.stringify([{ name: "Up", snippetId: 2 }]),
      terminal_config: null,
    });
    await runSnippetsSettingsMigration();
    expect(pluginRows).toHaveLength(0);
  });
});
