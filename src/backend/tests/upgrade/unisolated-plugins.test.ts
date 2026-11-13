/**
 * Moving to plugin API 2 must not turn off the official API 1 plugins an
 * admin had on: their switch is set once, and only for official plugins.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  rows: new Map<string, Record<string, unknown>>(),
  settings: new Map<string, string>(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    listAll: async () => [...db.rows.values()],
    update: async (id: string, input: Record<string, unknown>) => {
      Object.assign(db.rows.get(id)!, input);
      return db.rows.get(id);
    },
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => db.settings.get(key) ?? null,
    set: async (key: string, value: string) => void db.settings.set(key, value),
  }),
}));

const { seedUnisolatedSwitches, UNISOLATED_SEEDED_KEY } =
  await import("../../upgrade/unisolated-plugins.js");

function plugin(
  id: string,
  api: string,
  source: "bundled" | "user",
  signedTier?: string,
) {
  return {
    id,
    source,
    signedTier,
    manifest: { id, engine: { api, termix: "*" } },
  } as never;
}

function row(id: string, state: string, runUnisolated = false) {
  db.rows.set(id, { id, state, runUnisolated });
}

beforeEach(() => {
  db.rows.clear();
  db.settings.clear();
});

describe("seedUnisolatedSwitches", () => {
  it("turns the switch on once for official API 1 plugins that were on", async () => {
    row("docker", "enabled");
    row("signed", "failed");
    row("off", "disabled");
    row("community", "enabled");
    row("modern", "enabled");
    const loaded = [
      plugin("docker", "^1.15", "bundled"),
      plugin("signed", "1", "user", "official"),
      plugin("off", "1", "bundled"),
      plugin("community", "1", "user", "community"),
      plugin("modern", "^2.0.0", "bundled"),
    ];
    const turnedOn = await seedUnisolatedSwitches(loaded, new Set());
    expect(turnedOn.sort()).toEqual(["docker", "signed"]);
    expect(db.rows.get("community")?.runUnisolated).toBe(false);
    expect(db.rows.get("modern")?.runUnisolated).toBe(false);
    expect(db.rows.get("off")?.runUnisolated).toBe(false);
    expect(db.settings.get(UNISOLATED_SEEDED_KEY)).toBe("1");
  });

  it("leaves an admin's later choice alone, except for plugins new this boot", async () => {
    db.settings.set(UNISOLATED_SEEDED_KEY, "1");
    row("docker", "enabled");
    row("fresh", "enabled");
    const loaded = [
      plugin("docker", "1", "bundled"),
      plugin("fresh", "1", "bundled"),
    ];
    const turnedOn = await seedUnisolatedSwitches(loaded, new Set(["fresh"]));
    expect(turnedOn).toEqual(["fresh"]);
    expect(db.rows.get("docker")?.runUnisolated).toBe(false);
  });

  it("copies the stored switch onto the loaded plugin", async () => {
    db.settings.set(UNISOLATED_SEEDED_KEY, "1");
    row("docker", "enabled", true);
    const loaded = [plugin("docker", "1", "bundled")];
    await seedUnisolatedSwitches(loaded, new Set());
    expect((loaded[0] as { runUnisolated?: boolean }).runUnisolated).toBe(true);
  });
});
