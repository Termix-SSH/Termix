/**
 * Host plugin settings over remote sync: non-secret values travel with the
 * host, and a plugin can translate a local row id to its syncId and back.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix/plugin-sdk/manifest";

const h = vi.hoisted(() => ({
  stored: new Map<string, unknown>(),
  writes: [] as Array<[string, number, string, unknown]>,
  hooks: new Map<string, unknown>(),
  manifests: [] as PluginManifest[],
}));

vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  hostSettingsPlugins: () => h.manifests,
}));
vi.mock("../../../plugins/registry.js", () => ({
  consume: (key: string) => h.hooks.get(key),
}));
vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../plugins/settings.js", () => ({
  declaredFields: (manifest: PluginManifest) =>
    manifest.contributes!.settings!.host!.fields,
  getAllSettings: async (
    manifest: PluginManifest,
    _scope: string,
    id: number,
  ) =>
    Object.fromEntries(
      manifest.contributes!.settings!.host!.fields.map((field) => [
        field.key,
        h.stored.get(`${manifest.id}:${id}:${field.key}`),
      ]),
    ),
  setSetting: async (
    manifest: PluginManifest,
    _scope: string,
    id: number,
    key: string,
    value: unknown,
  ) => {
    h.writes.push([manifest.id, id, key, value]);
    return null;
  },
}));

const { exportHostPluginSettings, importHostPluginSettings } =
  await import("../../../database/routes/sync-host-plugin-settings.js");

const VAULT = {
  id: "vault",
  contributes: {
    settings: {
      host: {
        fields: [
          { key: "profileId", type: "number", labelKey: "k" },
          { key: "token", type: "secret", labelKey: "k" },
        ],
      },
    },
  },
} as unknown as PluginManifest;

beforeEach(() => {
  h.stored.clear();
  h.writes.length = 0;
  h.hooks.clear();
  h.manifests = [VAULT];
  h.hooks.set("vault.hostSettingsSync", {
    exportValue: (key: string, value: unknown) =>
      key === "profileId" && value === 4 ? "profile-sync-4" : value,
    importValue: (key: string, value: unknown) =>
      key === "profileId" && value === "profile-sync-4" ? 11 : value,
  });
});

describe("host plugin settings over sync", () => {
  it("exports non-secret values through the plugin's translation", async () => {
    h.stored.set("vault:1:profileId", 4);
    h.stored.set("vault:1:token", "secret");
    expect(await exportHostPluginSettings(1)).toEqual({
      vault: { profileId: "profile-sync-4" },
    });
  });

  it("imports them back to local ids", async () => {
    await importHostPluginSettings(9, {
      vault: { profileId: "profile-sync-4", token: "ignored" },
    });
    expect(h.writes).toEqual([["vault", 9, "profileId", 11]]);
  });

  it("ignores a payload without plugin settings", async () => {
    await importHostPluginSettings(9, undefined);
    expect(h.writes).toEqual([]);
  });
});
