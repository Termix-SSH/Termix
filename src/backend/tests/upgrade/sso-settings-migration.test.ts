/**
 * The silent sign-in default moving from core settings into the sso plugin's
 * admin settings.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  core: new Map<string, string>(),
  plugin: new Map<string, string | null>(),
  pluginInstalled: true,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentPluginRepository: () => ({
    findById: async (id: string) =>
      state.pluginInstalled && id === "sso" ? { id } : null,
  }),
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.core.get(key) ?? null,
    delete: async (key: string) => {
      state.core.delete(key);
    },
  }),
  createCurrentPluginSettingsRepository: () => ({
    get: async (
      _pluginId: string,
      _scope: string,
      _scopeId: string | null,
      key: string,
    ) => (state.plugin.has(key) ? { value: state.plugin.get(key) } : null),
    set: async (
      _pluginId: string,
      _scope: string,
      _scopeId: string | null,
      key: string,
      value: string | null,
    ) => {
      state.plugin.set(key, value);
    },
  }),
}));

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));

import { runSsoSettingsMigration } from "../../upgrade/sso-settings-migration.js";

beforeEach(() => {
  state.core = new Map();
  state.plugin = new Map();
  state.pluginInstalled = true;
});

describe("runSsoSettingsMigration", () => {
  it("moves the core value into the sso admin setting", async () => {
    state.core.set("oidc_silent_login_default", "true");
    expect(await runSsoSettingsMigration()).toEqual({ moved: true });
    expect(state.plugin.get("silentLoginDefault")).toBe("true");
    expect(state.core.has("oidc_silent_login_default")).toBe(false);
  });

  it("keeps a value already in plugin settings", async () => {
    state.core.set("oidc_silent_login_default", "true");
    state.plugin.set("silentLoginDefault", "false");
    await runSsoSettingsMigration();
    expect(state.plugin.get("silentLoginDefault")).toBe("false");
    expect(state.core.has("oidc_silent_login_default")).toBe(false);
  });

  it("does nothing twice or without the plugin", async () => {
    expect(await runSsoSettingsMigration()).toEqual({ moved: false });
    state.core.set("oidc_silent_login_default", "true");
    state.pluginInstalled = false;
    expect(await runSsoSettingsMigration()).toEqual({ moved: false });
    expect(state.core.get("oidc_silent_login_default")).toBe("true");
  });
});
