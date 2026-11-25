import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * An SSH host dials `port`. Rows from before 2.3, and imports, can still hold
 * the old `ssh_port` default of 22 next to it: no read, write, defaults pass
 * or reset may let that 22 replace the port the host dials.
 */

type Row = Record<string, unknown> & { id: number; userId: string };

const db = vi.hoisted(() => ({
  hosts: [] as Array<Record<string, unknown> & { id: number; userId: string }>,
  defaults: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  hostSettingsPlugins: () => [],
}));
vi.mock("../../../plugins/events.js", () => ({
  TOPICS: { hostUpdated: "host.updated" },
  pluginEvents: { emit: () => {} },
}));
vi.mock("../../../sync/server/feed.js", () => ({ markChanged: () => {} }));
vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ resyncHost: async () => {} }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  createCurrentHostDefaultsRepository: () => ({
    listHosts: async (filter: {
      hostIds?: number[];
      userIds?: string[];
      all?: boolean;
    }) =>
      db.hosts
        .filter(
          (host) =>
            filter.all ||
            filter.hostIds?.includes(host.id) ||
            filter.userIds?.includes(host.userId),
        )
        .map((host) => ({ ...host })),
    listForUsers: async () => db.defaults,
    listFolders: async () => [],
    listHostPlacement: async () =>
      db.hosts.map((host) => ({
        id: host.id,
        userId: host.userId,
        folder: null,
        parentHostId: null,
      })),
    updateHosts: async (patches: Array<{ id: number; values: object }>) => {
      for (const patch of patches) {
        Object.assign(
          db.hosts.find((row) => row.id === patch.id)!,
          {
            ...patch.values,
          },
        );
      }
    },
  }),
  createCurrentPluginSettingsRepository: () => ({
    getAllForScopeIds: async () => [],
  }),
}));

const { applyHostDefaultsToWrite, applyDefaultsAfterHostWrite } =
  await import("../../../hosts/defaults/index.js");
const { materializeHosts } =
  await import("../../../hosts/defaults/materialize.js");
const { changeHostOverrides } =
  await import("../../../hosts/defaults/overrides.js");
const { readCoreDefault } =
  await import("../../../hosts/defaults/core-columns.js");
const { transformHostResponse } =
  await import("../../../database/routes/host-normalizers.js");

const core = (...keys: string[]) => JSON.stringify({ core: keys });

function host(partial: Partial<Row>): Row {
  return {
    id: 1,
    userId: "u1",
    connectionType: "ssh",
    enableSsh: true,
    username: "root",
    authType: "password",
    folder: null,
    parentHostId: null,
    statusCheckEnabled: true,
    sharedSource: null,
    ...partial,
  };
}

function userDefault(key: string, value: unknown) {
  db.defaults = db.defaults.filter((row) => row.key !== key);
  db.defaults.push({
    level: "user",
    userId: "u1",
    folderId: null,
    namespace: "core",
    key,
    value: JSON.stringify(value),
  });
}

function ownsPort(row: Row): boolean {
  return (JSON.parse(row.defaultOverrides as string).core as string[]).includes(
    "sshPort",
  );
}

/** A write as the host routes, imports and ctx.hosts make it. */
async function save(
  columns: Record<string, unknown>,
  body: Record<string, unknown> = columns,
): Promise<Row> {
  const row = db.hosts[0];
  const overrides = await applyHostDefaultsToWrite({
    ownerId: "u1",
    hostId: row.id,
    columns,
    body,
    stored: { ...row } as never,
  });
  Object.assign(row, columns, { defaultOverrides: JSON.stringify(overrides) });
  await applyDefaultsAfterHostWrite(row.id);
  return row;
}

beforeEach(() => {
  db.hosts = [];
  db.defaults = [];
});

describe("reading the SSH port", () => {
  it.each([
    { shape: "ssh 2222/22", row: { port: 2222, sshPort: 22 }, read: 2222 },
    { shape: "ssh 22/2200", row: { port: 22, sshPort: 2200 }, read: 22 },
    { shape: "ssh 2222/null", row: { port: 2222, sshPort: null }, read: 2222 },
    {
      shape: "rdp 3389/2222",
      row: { connectionType: "rdp", port: 3389, sshPort: 2222 },
      read: 2222,
    },
    {
      shape: "rdp 3389/null",
      row: { connectionType: "rdp", port: 3389, sshPort: null },
      read: 3389,
    },
  ])("$shape reads $read", ({ row, read }) => {
    const shaped = host(row);
    expect(readCoreDefault("sshPort", shaped)).toBe(read);
    expect(transformHostResponse(shaped).sshPort).toBe(read);
  });
});

/** Stored rows, as 2.9 and later leave them. */
const SHAPES = {
  // Before 2.3, classified as inheriting the built-in 22.
  legacy: { port: 2222, sshPort: 22, defaultOverrides: core() },
  // The same, with the boot migration failed or skipped.
  unclassified: { port: 2222, sshPort: 22, defaultOverrides: null },
  // Imported since 2.9: its own port, still next to the column default.
  imported: { port: 2230, sshPort: 22, defaultOverrides: core("sshPort") },
  equal: { port: 22, sshPort: 22, defaultOverrides: core() },
  equalOwn: { port: 2223, sshPort: 2223, defaultOverrides: core("sshPort") },
};

/** What each caller sends. `shown` is the port the API returns. */
const WRITES = {
  notesOnly: () => ({ columns: { notes: "n" } }),
  savedGetBody: (stored: Row, shown: unknown) => ({
    columns: { connectionType: "ssh", port: shown, sshPort: shown },
    body: {
      port: shown,
      sshPort: shown,
      defaultOverrides: JSON.parse((stored.defaultOverrides as string) ?? "{}"),
    },
  }),
  sshPortEcho: (stored: Row) => ({ columns: { sshPort: stored.sshPort } }),
  sshPortChange: () => ({ columns: { sshPort: 2300 } }),
  portChange: () => ({ columns: { port: 2240 } }),
};

describe("a write, then a new SSH port default of 2400", () => {
  it.each([
    ["legacy", "notesOnly", 2222, true],
    ["legacy", "savedGetBody", 2222, true],
    ["legacy", "sshPortEcho", 2222, true],
    ["legacy", "sshPortChange", 2300, true],
    ["legacy", "portChange", 2240, true],
    ["unclassified", "notesOnly", 2222, true],
    ["unclassified", "savedGetBody", 2222, true],
    ["unclassified", "sshPortEcho", 2222, true],
    ["imported", "notesOnly", 2230, true],
    ["imported", "savedGetBody", 2230, true],
    ["imported", "sshPortEcho", 2230, true],
    ["equal", "notesOnly", 22, false],
    ["equal", "savedGetBody", 22, false],
    ["equal", "sshPortEcho", 22, false],
    ["equal", "sshPortChange", 2300, true],
    ["equalOwn", "savedGetBody", 2223, true],
  ] as const)("%s + %s: port %i, own %s", async (shape, kind, port, own) => {
    db.hosts = [host(SHAPES[shape])];
    const stored = { ...db.hosts[0] };
    const shown = transformHostResponse(stored).sshPort;
    const { columns, body } = WRITES[kind](stored, shown) as {
      columns: Record<string, unknown>;
      body?: Record<string, unknown>;
    };

    const row = await save(columns, body);
    expect([row.port, row.sshPort]).toEqual([port, port]);
    expect(ownsPort(row)).toBe(own);

    userDefault("sshPort", 2400);
    await materializeHosts({ all: true });
    const after = own ? port : 2400;
    expect([row.port, row.sshPort]).toEqual([after, after]);
  });

  it("leaves another connection type's port alone", async () => {
    db.hosts = [
      host({
        connectionType: "rdp",
        port: 3389,
        sshPort: 22,
        defaultOverrides: core(),
      }),
    ];
    const row = await save({ notes: "n" });
    userDefault("sshPort", 2400);
    await materializeHosts({ all: true });
    expect([row.port, row.sshPort]).toEqual([3389, 2400]);
  });

  it("dials the stored SSH port when a host becomes SSH", async () => {
    db.hosts = [
      host({
        connectionType: "rdp",
        port: 3389,
        sshPort: 2222,
        defaultOverrides: core("sshPort"),
      }),
    ];
    const row = await save({ connectionType: "ssh" });
    expect([row.port, row.sshPort]).toEqual([2222, 2222]);
  });
});

describe("the defaults pass", () => {
  it("keeps an invalid port it has no core list for, through a default change", async () => {
    db.hosts = [host({ port: 70000, sshPort: 22, defaultOverrides: null })];
    await materializeHosts({ all: true });
    userDefault("sshPort", 2400);
    await materializeHosts({ all: true });

    const [row] = db.hosts;
    expect([row.port, row.sshPort]).toEqual([70000, 22]);
    expect(ownsPort(row)).toBe(true);
    // Its other keys were classified as usual, not left as a partial list.
    expect(JSON.parse(row.defaultOverrides as string).core).toContain(
      "username",
    );
  });

  it("keeps an inherited mismatched port through a default change", async () => {
    db.hosts = [host(SHAPES.legacy)];
    userDefault("sshPort", 2400);
    await materializeHosts({ all: true });
    expect(db.hosts[0].port).toBe(2222);
    expect(ownsPort(db.hosts[0])).toBe(true);
  });
});

describe("resetting a mismatched host's defaults", () => {
  it.each([
    { reset: "sshPort", change: { inherit: [["core", "sshPort"]] }, port: 22 },
    { reset: "core", change: { inheritNamespaces: ["core"] }, port: 22 },
    { reset: "all", change: { inheritAll: true }, port: 22 },
    {
      reset: "another key",
      change: { inherit: [["core", "username"]] },
      port: 2222,
    },
  ] as const)(
    "a reset of $reset gives port $port",
    async ({ change, port }) => {
      db.hosts = [
        host({ port: 2222, sshPort: 22, defaultOverrides: core("sshPort") }),
      ];
      await changeHostOverrides([1], change as never);
      const [row] = db.hosts;
      expect(row.port).toBe(port);
      expect(ownsPort(row)).toBe(port !== 22);
    },
  );

  it("resets the port of a host no pass has classified yet", async () => {
    db.hosts = [host({ port: 2222, sshPort: 22, defaultOverrides: null })];
    await changeHostOverrides([1], { inherit: [["core", "sshPort"]] });
    const [row] = db.hosts;
    expect([row.port, row.sshPort]).toEqual([22, 22]);
    expect(ownsPort(row)).toBe(false);
    // Its other keys were still classified from their values.
    expect(JSON.parse(row.defaultOverrides as string).core).toContain(
      "username",
    );
  });
});
