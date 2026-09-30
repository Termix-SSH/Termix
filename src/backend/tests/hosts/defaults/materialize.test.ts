import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The materialize pass against in-memory tables: hosts, plugin host rows and
 * the defaults levels.
 */

type Row = Record<string, unknown> & { id: number; userId: string };

const db = vi.hoisted(() => ({
  hosts: [] as Array<Record<string, unknown> & { id: number; userId: string }>,
  pluginRows: [] as Array<{
    pluginId: string;
    scope: string;
    scopeId: string;
    key: string;
    value: string | null;
    encrypted: boolean;
  }>,
  defaults: [] as Array<Record<string, unknown>>,
  folders: [] as Array<{ id: number; userId: string; name: string }>,
  events: [] as unknown[],
  notified: [] as unknown[],
}));

const manifest = vi.hoisted(() => ({
  id: "term",
  contributes: {
    settings: {
      host: {
        enableKey: "enabled",
        enableDefault: true,
        fields: [
          { key: "fontSize", type: "number", default: 14 },
          { key: "mac", type: "string", defaultable: false },
        ],
      },
    },
  },
}));

vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  hostSettingsPlugins: () => [manifest],
}));
vi.mock("../../../plugins/events.js", () => ({
  TOPICS: { hostUpdated: "host.updated" },
  pluginEvents: { emit: (...args: unknown[]) => db.events.push(args) },
}));
vi.mock("../../../sync/server/feed.js", () => ({ markChanged: () => {} }));
vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ resyncHost: async () => {} }),
  },
}));
vi.mock("../../../plugins/settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../plugins/settings.js")>()),
  notifySettingChange: (...args: unknown[]) => db.notified.push(args),
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  createCurrentHostDefaultsRepository: () => ({
    listHosts: async (filter: {
      hostIds?: number[];
      userIds?: string[];
      all?: boolean;
    }) =>
      db.hosts.filter(
        (host) =>
          filter.all ||
          filter.hostIds?.includes(host.id) ||
          filter.userIds?.includes(host.userId),
      ),
    listForUsers: async (userIds: string[]) =>
      db.defaults.filter(
        (row) =>
          row.level === "admin" || userIds.includes(row.userId as string),
      ),
    listFolders: async (userIds: string[]) =>
      db.folders.filter((folder) => userIds.includes(folder.userId)),
    listHostPlacement: async (userIds: string[]) =>
      db.hosts
        .filter((host) => userIds.includes(host.userId))
        .map((host) => ({
          id: host.id,
          userId: host.userId,
          folder: (host.folder as string | null) ?? null,
          parentHostId: (host.parentHostId as number | null) ?? null,
        })),
    updateHosts: async (patches: Array<{ id: number; values: object }>) => {
      for (const patch of patches) {
        const host = db.hosts.find((row) => row.id === patch.id)!;
        Object.assign(host, patch.values);
      }
    },
  }),
  createCurrentPluginSettingsRepository: () => ({
    getAllForScopeIds: async (_scope: string, ids: string[]) =>
      db.pluginRows.filter((row) => ids.includes(row.scopeId)),
    set: async (
      pluginId: string,
      scope: string,
      scopeId: string,
      key: string,
      value: string,
    ) => {
      const existing = db.pluginRows.find(
        (row) =>
          row.pluginId === pluginId &&
          row.scopeId === scopeId &&
          row.key === key,
      );
      if (existing) existing.value = value;
      else
        db.pluginRows.push({
          pluginId,
          scope,
          scopeId,
          key,
          value,
          encrypted: false,
        });
    },
    delete: async (
      pluginId: string,
      _scope: string,
      scopeId: string,
      key: string,
    ) => {
      db.pluginRows = db.pluginRows.filter(
        (row) =>
          !(
            row.pluginId === pluginId &&
            row.scopeId === scopeId &&
            row.key === key
          ),
      );
      return true;
    },
  }),
}));

const { materializeHosts } =
  await import("../../../hosts/defaults/materialize.js");

function host(partial: Partial<Row> & { id: number }): Row {
  return {
    userId: "u1",
    connectionType: "ssh",
    port: 22,
    sshPort: 22,
    username: "root",
    authType: "password",
    folder: null,
    parentHostId: null,
    statusCheckEnabled: true,
    defaultOverrides: null,
    sharedSource: null,
    ...partial,
  };
}

function setDefault(
  level: "admin" | "user" | "folder",
  key: string,
  value: unknown,
  extra: Record<string, unknown> = {},
) {
  const [namespace, name] = key.split(".");
  db.defaults.push({
    level,
    namespace,
    key: name,
    value: JSON.stringify(value),
    userId: level === "admin" ? null : "u1",
    folderId: null,
    ...extra,
  });
}

function pluginValue(hostId: number, key: string): unknown {
  const row = db.pluginRows.find(
    (entry) => entry.scopeId === String(hostId) && entry.key === key,
  );
  return row ? JSON.parse(row.value as string) : undefined;
}

beforeEach(() => {
  db.hosts = [];
  db.pluginRows = [];
  db.defaults = [];
  db.folders = [];
  db.events = [];
  db.notified = [];
});

describe("materializeHosts", () => {
  it("classifies a host from before host defaults: matching values follow them", async () => {
    db.hosts = [host({ id: 1, sshPort: 22 }), host({ id: 2, sshPort: 2222 })];
    db.pluginRows.push({
      pluginId: "term",
      scope: "host",
      scopeId: "2",
      key: "fontSize",
      value: "18",
      encrypted: false,
    });

    const result = await materializeHosts({ all: true });

    expect(result.changedHostIds).toEqual([]);
    const first = JSON.parse(db.hosts[0].defaultOverrides as string);
    const second = JSON.parse(db.hosts[1].defaultOverrides as string);
    expect(first.core).not.toContain("sshPort");
    expect(second.core).toContain("sshPort");
    expect(first.term).toEqual([]);
    expect(second.term).toEqual(["fontSize"]);
    // Nothing a user sees changed.
    expect(db.hosts[1].sshPort).toBe(2222);
  });

  it("writes a new default into every host that follows it, and no other", async () => {
    db.hosts = [
      host({ id: 1, defaultOverrides: JSON.stringify({ core: [], term: [] }) }),
      host({
        id: 2,
        sshPort: 2200,
        defaultOverrides: JSON.stringify({ core: ["sshPort"], term: [] }),
      }),
    ];
    setDefault("user", "core.sshPort", 2022);
    setDefault("admin", "term.fontSize", 16);

    const result = await materializeHosts({ userIds: ["u1"] });

    expect(result.changedHostIds).toEqual([1, 2]);
    expect(db.hosts[0].sshPort).toBe(2022);
    expect(db.hosts[0].port).toBe(2022);
    expect(db.hosts[1].sshPort).toBe(2200);
    expect(pluginValue(1, "fontSize")).toBe(16);
    expect(pluginValue(2, "fontSize")).toBe(16);
    expect(db.events).toHaveLength(2);
    expect(db.notified).toEqual([["term", "fontSize", 16]]);
  });

  it("removes the row when a key goes back to the manifest default", async () => {
    db.hosts = [
      host({ id: 1, defaultOverrides: JSON.stringify({ core: [], term: [] }) }),
    ];
    db.pluginRows.push({
      pluginId: "term",
      scope: "host",
      scopeId: "1",
      key: "fontSize",
      value: "16",
      encrypted: false,
    });
    await materializeHosts({ all: true });
    expect(pluginValue(1, "fontSize")).toBeUndefined();
  });

  it("follows the deepest folder, and a sub-host follows its parent's", async () => {
    db.folders = [
      { id: 10, userId: "u1", name: "Prod" },
      { id: 11, userId: "u1", name: "Prod / Web" },
    ];
    const classified = JSON.stringify({ core: [], term: [] });
    db.hosts = [
      host({ id: 1, folder: "Prod / Web", defaultOverrides: classified }),
      host({ id: 2, parentHostId: 1, defaultOverrides: classified }),
      host({ id: 3, folder: "Prod", defaultOverrides: classified }),
    ];
    setDefault("folder", "core.sshPort", 2100, { folderId: 10 });
    setDefault("folder", "core.sshPort", 2200, { folderId: 11 });

    await materializeHosts({ all: true });

    expect(db.hosts.map((row) => row.sshPort)).toEqual([2200, 2200, 2100]);
  });

  it("never writes a jump chain through the host itself", async () => {
    db.folders = [{ id: 10, userId: "u1", name: "Lab" }];
    db.hosts = [
      host({
        id: 1,
        folder: "Lab",
        defaultOverrides: JSON.stringify({ core: [], term: [] }),
      }),
    ];
    setDefault("folder", "core.jumpHosts", [{ hostId: 1 }, { hostId: 9 }], {
      folderId: 10,
    });
    await materializeHosts({ all: true });
    expect(JSON.parse(db.hosts[0].jumpHosts as string)).toEqual([
      { hostId: 9 },
    ]);
  });

  it("previews without writing", async () => {
    db.hosts = [
      host({ id: 1, defaultOverrides: JSON.stringify({ core: [], term: [] }) }),
    ];
    const result = await materializeHosts(
      { all: true },
      {
        dryRun: true,
        overlay: {
          level: "admin",
          set: new Map([["core.sshPort", 2022]]),
          unset: new Set(),
        },
      },
    );
    expect(result.changedHostIds).toEqual([1]);
    expect(db.hosts[0].sshPort).toBe(22);
  });

  it("leaves a desktop's copy of a shared host alone", async () => {
    db.hosts = [host({ id: 1, sharedSource: "{}" })];
    setDefault("admin", "core.sshPort", 2022);
    await materializeHosts({ all: true });
    expect(db.hosts[0].sshPort).toBe(22);
    expect(db.hosts[0].defaultOverrides).toBeNull();
  });
});
