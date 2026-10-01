/**
 * The terminal macros migration: a user's saved macros must come through
 * into the ssh-terminal plugin's macros setting, and running it twice must
 * change nothing.
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
const preferenceRows: Array<Record<string, unknown>> = [];

const find = (scopeId: string, key: string) =>
  pluginRows.find(
    (row) =>
      row.pluginId === "ssh-terminal" &&
      row.scope === "user" &&
      row.scopeId === scopeId &&
      row.key === key,
  );

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) => (id === "ssh-terminal" ? { id } : null),
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (_p: string, _s: string, scopeId: string, key: string) =>
      find(scopeId, key) ?? null,
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string,
      key: string,
      value: string | null,
    ) => {
      const existing = find(scopeId, key);
      if (existing) existing.value = value;
      else pluginRows.push({ pluginId, scope, scopeId, key, value });
    },
  }),
}));

vi.mock("../../database/db/index.js", () => ({
  getDb: () => ({ all: async () => preferenceRows }),
}));

const { runSshTerminalMacrosMigration, macrosFromPreferences } =
  await import("../../upgrade/ssh-terminal-macros-migration.js");

const macro = { id: "m1", name: "Deploy", steps: [{ id: "s", type: "send" }] };

beforeEach(() => {
  pluginRows.length = 0;
  preferenceRows.length = 0;
});

describe("macrosFromPreferences", () => {
  it("keeps valid macros and drops the rest", () => {
    expect(
      macrosFromPreferences(JSON.stringify([macro, { id: 1 }, "x"])),
    ).toEqual([macro]);
    expect(macrosFromPreferences("[]")).toBeNull();
    expect(macrosFromPreferences("{bad")).toBeNull();
  });
});

describe("runSshTerminalMacrosMigration", () => {
  it("moves each user's macros once", async () => {
    preferenceRows.push(
      { user_id: "u1", terminal_macros: JSON.stringify([macro]) },
      { user_id: "u2", terminal_macros: "[]" },
    );
    expect(await runSshTerminalMacrosMigration()).toEqual({ usersMoved: 1 });
    expect(JSON.parse(find("u1", "macros")!.value!)).toEqual([macro]);
    expect(find("u2", "macros")).toBeUndefined();

    const snapshot = JSON.stringify(pluginRows);
    expect(await runSshTerminalMacrosMigration()).toEqual({ usersMoved: 0 });
    expect(JSON.stringify(pluginRows)).toBe(snapshot);
  });

  it("leaves a user who already has macros in the plugin alone", async () => {
    pluginRows.push({
      pluginId: "ssh-terminal",
      scope: "user",
      scopeId: "u1",
      key: "macros",
      value: "[]",
    });
    preferenceRows.push({
      user_id: "u1",
      terminal_macros: JSON.stringify([macro]),
    });
    await runSshTerminalMacrosMigration();
    expect(find("u1", "macros")!.value).toBe("[]");
  });
});
