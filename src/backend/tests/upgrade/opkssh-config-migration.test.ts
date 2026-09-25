/**
 * The OPKSSH config move. A 2.8 install's config must reach the opkssh
 * plugin's folder, the old file must stay for a downgrade, and the install
 * must keep the redirect URI its identity providers know. Running it twice
 * must not overwrite anything.
 */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  settings: new Map<string, string | null>(),
  pluginInstalled: true,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "opkssh" ? { id } : null,
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (_p: string, _s: string, _id: string | null, key: string) =>
      state.settings.has(key) ? { key, value: state.settings.get(key) } : null,
    set: async (
      _p: string,
      _s: string,
      _id: string | null,
      key: string,
      value: string | null,
    ) => {
      state.settings.set(key, value);
    },
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import { runOpksshConfigMigration } from "../../upgrade/opkssh-config-migration.js";

let dataDir: string;
const legacy = () => path.join(dataDir, ".opk", "config.yml");
const target = () => path.join(dataDir, "plugins", "opkssh", "config.yml");

beforeEach(async () => {
  state.settings = new Map();
  state.pluginInstalled = true;
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "opkssh-config-"));
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("runOpksshConfigMigration", () => {
  it("copies the config, keeps the old one and the old redirect URI, once", async () => {
    await fs.mkdir(path.dirname(legacy()), { recursive: true });
    await fs.writeFile(legacy(), "providers:\n  - alias: google\n");

    expect(await runOpksshConfigMigration(dataDir)).toEqual({
      copied: true,
      legacyCallback: true,
    });
    expect(await fs.readFile(target(), "utf8")).toContain("alias: google");
    expect(await fs.readFile(legacy(), "utf8")).toContain("alias: google");
    expect(state.settings.get("legacyCallback")).toBe("true");

    await fs.writeFile(target(), "providers:\n  - alias: edited\n");
    state.settings.set("legacyCallback", "false");
    expect(await runOpksshConfigMigration(dataDir)).toEqual({
      copied: false,
      legacyCallback: false,
    });
    expect(await fs.readFile(target(), "utf8")).toContain("alias: edited");
    expect(state.settings.get("legacyCallback")).toBe("false");
  });

  it("does nothing on an install that never set up OPKSSH", async () => {
    expect(await runOpksshConfigMigration(dataDir)).toEqual({
      copied: false,
      legacyCallback: false,
    });
    expect(state.settings.size).toBe(0);
  });

  it("waits for the plugin row", async () => {
    state.pluginInstalled = false;
    await fs.mkdir(path.dirname(legacy()), { recursive: true });
    await fs.writeFile(legacy(), "providers: []\n");
    await runOpksshConfigMigration(dataDir);
    await expect(fs.access(target())).rejects.toThrow();
  });
});
