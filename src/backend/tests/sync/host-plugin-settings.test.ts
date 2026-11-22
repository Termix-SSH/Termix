/**
 * Host plugin settings over remote sync: non-secret values travel with the
 * host, and a plugin can translate a local row id to its syncId and back.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PluginManifest } from "@termix-ssh/plugin-sdk/manifest";

const h = vi.hoisted(() => ({
  stored: new Map<string, unknown>(),
  writes: [] as Array<[string, number, string, unknown]>,
  hooks: new Map<string, unknown>(),
  manifests: [] as PluginManifest[],
  visible: null as Record<string, Record<string, unknown>> | null,
  viewerCalls: [] as Array<[Record<string, unknown>, string | undefined]>,
  pending: new Map<number, Record<string, Record<string, unknown>>>(),
}));

vi.mock("../../database/routes/host-plugin-settings.js", () => ({
  hostSettingsPlugins: () => h.manifests,
  withHostPluginSettings: async (
    host: Record<string, unknown>,
    viewerId?: string,
  ) => {
    h.viewerCalls.push([host, viewerId]);
    return h.visible ? { ...host, pluginSettings: h.visible } : host;
  },
}));
vi.mock("../../plugins/registry.js", () => ({
  consume: (key: string) => h.hooks.get(key),
}));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock("../../plugins/settings.js", () => ({
  declaredFields: (manifest: PluginManifest) =>
    manifest.contributes!.settings!.host!.fields,
  getAllSettings: async (
    manifest: PluginManifest,
    _scope: string,
    id: number,
    options: { storedOnly?: boolean } = {},
  ) =>
    Object.fromEntries(
      manifest
        .contributes!.settings!.host!.fields.filter(
          (field) =>
            !options.storedOnly ||
            h.stored.has(`${manifest.id}:${id}:${field.key}`),
        )
        .map((field) => [
          field.key,
          h.stored.has(`${manifest.id}:${id}:${field.key}`)
            ? h.stored.get(`${manifest.id}:${id}:${field.key}`)
            : field.default,
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
    h.stored.set(`${manifest.id}:${id}:${key}`, value);
    return null;
  },
}));
vi.mock("../../sync/pending-host-settings.js", () => ({
  getPendingHostSettings: async (hostId: number) => ({
    ...h.pending.get(hostId),
  }),
  setPendingHostSettings: async (
    hostId: number,
    byPlugin: Record<string, Record<string, unknown>>,
  ) => {
    h.pending.set(hostId, { ...byPlugin });
  },
  listPendingHostSettings: async (pluginIds: string[]) =>
    [...h.pending].flatMap(([hostId, byPlugin]) =>
      Object.entries(byPlugin)
        .filter(([pluginId]) => pluginIds.includes(pluginId))
        .map(([pluginId, settings]) => ({ hostId, pluginId, settings })),
    ),
  deletePendingHostSettings: async (hostId: number, pluginId: string) => {
    const byPlugin = { ...h.pending.get(hostId) };
    delete byPlugin[pluginId];
    h.pending.set(hostId, byPlugin);
  },
}));

const {
  applyPendingHostPluginSettings,
  exportHostPluginSettings,
  exportLinkedHostPluginSettings,
  importHostPluginSettings,
  importLinkedHostPluginSettings,
} = await import("../../sync/host-plugin-settings.js");

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

const MONITOR = {
  id: "monitor",
  contributes: {
    settings: {
      host: {
        fields: [
          { key: "enabled", type: "boolean", labelKey: "k", default: false },
          { key: "interval", type: "number", labelKey: "k", default: 5 },
        ],
      },
    },
  },
} as unknown as PluginManifest;

const TUNNELS = {
  id: "tunnels",
  contributes: {
    settings: {
      host: {
        fields: [
          {
            key: "enableTunnel",
            type: "boolean",
            labelKey: "k",
            default: false,
          },
          { key: "tunnelConnections", type: "custom", labelKey: "k" },
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
  h.visible = null;
  h.viewerCalls.length = 0;
  h.pending.clear();
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

  it("exports only what a shared host's viewer sees", async () => {
    h.manifests = [VAULT, TUNNELS];
    h.visible = {
      vault: { token: { set: true } },
      tunnels: { enableTunnel: true, tunnelConnections: [{ sourcePort: 22 }] },
    };
    expect(
      await exportHostPluginSettings(1, {
        userId: "viewer",
        permissionLevel: "connect",
      }),
    ).toEqual({
      tunnels: { enableTunnel: true, tunnelConnections: [{ sourcePort: 22 }] },
    });
    expect(h.viewerCalls).toEqual([
      [{ id: 1, isShared: true, permissionLevel: "connect" }, "viewer"],
    ]);
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

describe("host plugin settings on a linked desktop", () => {
  const SENT = {
    vault: { profileId: "profile-sync-4" },
    tunnels: { enableTunnel: true, tunnelConnections: [{ sourcePort: 22 }] },
  };

  beforeEach(() => {
    // Vault isn't running on this desktop yet.
    h.manifests = [TUNNELS];
    h.hooks.set("vault.hostSettingsSync", {
      exportValue: (key: string, value: unknown) =>
        key === "profileId" && value === 11 ? "profile-sync-4" : value,
      importValue: (key: string, value: unknown) =>
        key === "profileId" && value === "profile-sync-4" ? 11 : value,
    });
  });

  it("keeps what came for a plugin not running here and sends it back", async () => {
    await importLinkedHostPluginSettings(9, SENT);

    expect(h.writes).toEqual([
      ["tunnels", 9, "enableTunnel", true],
      ["tunnels", 9, "tunnelConnections", [{ sourcePort: 22 }]],
    ]);
    expect(await exportLinkedHostPluginSettings(9)).toEqual(SENT);
  });

  it("sends the same once that plugin starts, and writes what it kept", async () => {
    // What the desktop stored before the plugin stopped here.
    h.stored.set("vault:9:profileId", 12);
    await importLinkedHostPluginSettings(9, SENT);
    h.manifests = [TUNNELS, VAULT];

    expect(await exportLinkedHostPluginSettings(9)).toEqual(SENT);

    h.writes.length = 0;
    await applyPendingHostPluginSettings();
    expect(h.writes).toEqual([["vault", 9, "profileId", 11]]);
    expect(h.pending.get(9)).toEqual({});
    expect(await exportLinkedHostPluginSettings(9)).toEqual(SENT);
  });

  it("never sends a plugin's built-in defaults as a host's values", async () => {
    h.manifests = [MONITOR];
    expect(await exportLinkedHostPluginSettings(9)).toStrictEqual({});

    h.stored.set("monitor:9:interval", 10);
    expect(await exportLinkedHostPluginSettings(9)).toStrictEqual({
      monitor: { interval: 10 },
    });
  });

  it("keeps a field without a default, which has no value to send", async () => {
    h.manifests = [TUNNELS];
    expect(await exportLinkedHostPluginSettings(9)).toStrictEqual({
      tunnels: { tunnelConnections: undefined },
    });
  });

  it("takes a running plugin's values over what it kept", async () => {
    await importLinkedHostPluginSettings(9, SENT);
    h.manifests = [TUNNELS, VAULT];
    await importLinkedHostPluginSettings(9, { vault: { profileId: 12 } });

    expect(h.pending.get(9)).toEqual({});
    expect(await exportLinkedHostPluginSettings(9)).toEqual({
      vault: { profileId: 12 },
      tunnels: SENT.tunnels,
    });
  });

  it("forgets what it kept once the server stops sending it", async () => {
    await importLinkedHostPluginSettings(9, SENT);
    await importLinkedHostPluginSettings(9, { tunnels: SENT.tunnels });

    expect(await exportLinkedHostPluginSettings(9)).toEqual({
      tunnels: SENT.tunnels,
    });
  });

  it("leaves a server sending every field, defaults included", async () => {
    h.pending.set(9, { vault: { profileId: "profile-sync-4" } });

    const sent = await exportHostPluginSettings(9);
    expect(Object.keys(sent)).toEqual(["tunnels"]);
    expect(Object.keys(sent.tunnels)).toEqual([
      "enableTunnel",
      "tunnelConnections",
    ]);
    expect(sent.tunnels.enableTunnel).toBe(false);
  });
});

describe("a linked desktop starting a plugin, as in #1919", () => {
  const TMUX = {
    id: "tmux",
    contributes: {
      settings: {
        host: {
          fields: [
            { key: "enabled", type: "boolean", labelKey: "k", default: false },
            { key: "mouse", type: "boolean", labelKey: "k", default: true },
          ],
        },
      },
    },
  } as unknown as PluginManifest;
  const SERVER_HOST = 1;
  const DESKTOP_HOST = 9;

  // The server's host has the plugin on and mouse off. Setup 1 sets both
  // itself; in setup 2 "enabled" comes from the user's defaults.
  it.each([
    ["setup 1: the host sets both itself", { tmux: ["enabled", "mouse"] }],
    ["setup 2: the host sets only mouse itself", { tmux: ["mouse"] }],
  ])("leaves the server's host as it was (%s)", async (_setup, own) => {
    h.manifests = [TMUX];
    h.stored.set(`tmux:${SERVER_HOST}:enabled`, true);
    h.stored.set(`tmux:${SERVER_HOST}:mouse`, false);
    const sent = await exportHostPluginSettings(SERVER_HOST);

    // The desktop pulls the host while the plugin isn't running there.
    h.manifests = [];
    await importLinkedHostPluginSettings(DESKTOP_HOST, sent);
    const beforeStart = await exportLinkedHostPluginSettings(DESKTOP_HOST);

    // The plugin starts on the desktop, which then sends the host back.
    h.manifests = [TMUX];
    const afterStart = await exportLinkedHostPluginSettings(DESKTOP_HOST);
    await applyPendingHostPluginSettings();
    const afterApply = await exportLinkedHostPluginSettings(DESKTOP_HOST);
    await importHostPluginSettings(SERVER_HOST, afterApply, own);

    expect(h.stored.get(`tmux:${SERVER_HOST}:enabled`)).toBe(true);
    expect(h.stored.get(`tmux:${SERVER_HOST}:mouse`)).toBe(false);
    // The host reads the same as before, so starting the plugin is no edit.
    expect(afterStart).toEqual(beforeStart);
    expect(afterApply).toEqual(beforeStart);
    // And the desktop now shows the server's values.
    expect(h.stored.get(`tmux:${DESKTOP_HOST}:enabled`)).toBe(true);
    expect(h.stored.get(`tmux:${DESKTOP_HOST}:mouse`)).toBe(false);
  });
});
