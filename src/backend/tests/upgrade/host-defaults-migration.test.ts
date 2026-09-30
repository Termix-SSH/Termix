import { beforeEach, describe, expect, it, vi } from "vitest";

type PluginRow = {
  pluginId: string;
  scope: string;
  scopeId: string | null;
  key: string;
  value: string | null;
};

const db = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  pluginRows: [] as PluginRow[],
  defaults: [] as Array<{
    scope: Record<string, unknown>;
    namespace: string;
    key: string;
    value: string;
  }>,
  hosts: [] as Array<Record<string, unknown>>,
  folders: [] as Array<{ id: number; userId: string; credentialId: number }>,
  folderCredential: new Map<string, number>(),
}));

const manifests = vi.hoisted(() => [
  {
    id: "ssh-terminal",
    contributes: {
      settings: {
        host: {
          fields: [
            { key: "fontSize", type: "number", default: 14 },
            { key: "theme", type: "string", default: "termix" },
            { key: "localEcho", type: "select", default: "auto" },
            { key: "linkClickBehavior", type: "select", default: "confirm" },
          ],
        },
      },
    },
  },
  {
    id: "remote-desktop",
    contributes: {
      settings: {
        host: {
          fields: [{ key: "colorDepth", type: "select", default: "inherit" }],
        },
      },
    },
  },
  { id: "host-metrics", contributes: { settings: { host: { fields: [] } } } },
]);

vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn() },
}));
vi.mock("../../database/routes/host-plugin-settings.js", () => ({
  hostSettingsPlugins: () => manifests,
}));
vi.mock("../../database/db/schema.js", () => ({
  sshFolders: { id: "id", userId: "userId", credentialId: "credentialId" },
}));
vi.mock("../../database/repositories/factory.js", () => {
  const scopeKey = (scope: Record<string, unknown>) =>
    scope.level === "admin"
      ? "admin"
      : scope.level === "user"
        ? `u:${scope.userId}`
        : `f:${scope.folderId}`;
  return {
    createCurrentSettingsRepository: () => ({
      get: async (key: string) => db.settings[key] ?? null,
      set: async (key: string, value: string) => {
        db.settings[key] = value;
      },
    }),
    createCurrentPluginSettingsRepository: () => ({
      listByKey: async (pluginId: string, scope: string, key: string) =>
        db.pluginRows.filter(
          (row) =>
            row.pluginId === pluginId && row.scope === scope && row.key === key,
        ),
      getAll: async (pluginId: string, scope: string, scopeId: string) =>
        db.pluginRows.filter(
          (row) =>
            row.pluginId === pluginId &&
            row.scope === scope &&
            row.scopeId === scopeId,
        ),
      set: async (
        pluginId: string,
        scope: string,
        scopeId: string,
        key: string,
        value: string,
      ) => {
        db.pluginRows = db.pluginRows.filter(
          (row) =>
            !(
              row.pluginId === pluginId &&
              row.scope === scope &&
              row.scopeId === scopeId &&
              row.key === key
            ),
        );
        db.pluginRows.push({ pluginId, scope, scopeId, key, value });
      },
      delete: async (
        pluginId: string,
        scope: string,
        scopeId: string,
        key: string,
      ) => {
        db.pluginRows = db.pluginRows.filter(
          (row) =>
            !(
              row.pluginId === pluginId &&
              row.scope === scope &&
              row.scopeId === scopeId &&
              row.key === key
            ),
        );
      },
    }),
    createCurrentHostDefaultsRepository: () => ({
      listScope: async (scope: Record<string, unknown>) =>
        db.defaults.filter((row) => scopeKey(row.scope) === scopeKey(scope)),
      apply: async (
        scope: Record<string, unknown>,
        set: Array<{ namespace: string; key: string; value: string }>,
      ) => {
        for (const entry of set) db.defaults.push({ scope, ...entry });
      },
      listHosts: async () => db.hosts,
      updateHosts: async (
        patches: Array<{ id: number; values: Record<string, unknown> }>,
      ) => {
        for (const patch of patches) {
          Object.assign(
            db.hosts.find((host) => host.id === patch.id)!,
            patch.values,
          );
        }
      },
    }),
    createCurrentHostResolutionRepository: () => ({
      findFolderCredentialId: async (_userId: string, folder: string) =>
        db.folderCredential.get(folder) ?? null,
    }),
    createCurrentRepositoryContext: () => ({
      drizzle: {
        select: () => ({
          from: () => ({ where: async () => db.folders }),
        }),
      },
    }),
  };
});

const { runHostDefaultsMigration } =
  await import("../../upgrade/host-defaults-migration.js");

function level(namespace: string, key: string, scopeLevel: string) {
  const row = db.defaults.find(
    (entry) =>
      entry.namespace === namespace &&
      entry.key === key &&
      entry.scope.level === scopeLevel,
  );
  return row ? JSON.parse(row.value) : undefined;
}

function hostValue(hostId: number, pluginId: string, key: string) {
  const row = db.pluginRows.find(
    (entry) =>
      entry.pluginId === pluginId &&
      entry.scope === "host" &&
      entry.scopeId === String(hostId) &&
      entry.key === key,
  );
  return row?.value ? JSON.parse(row.value) : undefined;
}

const plugin = (
  pluginId: string,
  scope: string,
  scopeId: string | null,
  key: string,
  value: unknown,
): PluginRow => ({
  pluginId,
  scope,
  scopeId,
  key,
  value: JSON.stringify(value),
});

beforeEach(() => {
  db.settings = {};
  db.pluginRows = [];
  db.defaults = [];
  db.hosts = [];
  db.folders = [];
  db.folderCredential = new Map();
});

describe("runHostDefaultsMigration", () => {
  it("moves the old server defaults, dropping the credential and password", async () => {
    db.settings.host_defaults = JSON.stringify({
      useSocks5: true,
      socks5Host: "proxy",
      socks5Port: 1081,
      socks5Password: "secret",
      credentialId: 3,
      statusCheckEnabled: false,
    });
    db.pluginRows.push(
      plugin("ssh-terminal", "admin", null, "newHostFontSize", 18),
      plugin("host-metrics", "admin", null, "enabledForNewHosts", false),
    );
    db.folders = [{ id: 4, userId: "u1", credentialId: 9 }];

    await runHostDefaultsMigration();

    expect(level("core", "socks5", "admin")).toMatchObject({
      useSocks5: true,
      socks5Host: "proxy",
      socks5Port: 1081,
    });
    expect(JSON.stringify(db.defaults)).not.toContain("secret");
    expect(level("core", "statusCheckEnabled", "admin")).toBe(false);
    expect(level("ssh-terminal", "fontSize", "admin")).toBe(18);
    expect(level("host-metrics", "metricsEnabled", "admin")).toBe(false);
    expect(level("core", "auth", "folder")).toMatchObject({
      authType: "credential",
      credentialId: 9,
    });
  });

  it("moves each user's terminal and remote desktop defaults to their own level", async () => {
    db.pluginRows.push(
      plugin("ssh-terminal", "user", "u1", "terminalDefaults", {
        fontSize: 20,
      }),
      plugin("ssh-terminal", "user", "u1", "localEcho", "on"),
      plugin("remote-desktop", "user", "u1", "colorDepth", "16"),
      plugin("remote-desktop", "user", "u1", "disableAudio", "inherit"),
    );
    await runHostDefaultsMigration();
    expect(level("ssh-terminal", "fontSize", "user")).toBe(20);
    expect(level("ssh-terminal", "localEcho", "user")).toBe("on");
    expect(level("remote-desktop", "colorDepth", "user")).toBe("16");
    expect(level("remote-desktop", "disableAudio", "user")).toBeUndefined();
  });

  it("writes in the look a host really had while it followed its user", async () => {
    db.hosts = [
      { id: 1, userId: "u1", defaultOverrides: null },
      { id: 2, userId: "u1", defaultOverrides: null },
      { id: 3, userId: "u1", defaultOverrides: '{"core":[]}' },
    ];
    db.pluginRows.push(
      plugin("ssh-terminal", "user", "u1", "terminalDefaults", {
        fontSize: 20,
      }),
      plugin("ssh-terminal", "user", "u1", "localEcho", "on"),
      plugin("ssh-terminal", "host", "1", "fontSize", 30),
      plugin("ssh-terminal", "host", "1", "localEcho", "default"),
      plugin("ssh-terminal", "host", "2", "inheritAppearance", false),
      plugin("ssh-terminal", "host", "2", "fontSize", 30),
      plugin("ssh-terminal", "host", "2", "localEcho", "off"),
      plugin("remote-desktop", "user", "u1", "colorDepth", "24"),
    );

    await runHostDefaultsMigration();

    // Followed the user: the user's look, and their echo mode.
    expect(hostValue(1, "ssh-terminal", "fontSize")).toBe(20);
    expect(hostValue(1, "ssh-terminal", "localEcho")).toBe("on");
    expect(hostValue(1, "remote-desktop", "colorDepth")).toBe("24");
    // Had its own look: kept.
    expect(hostValue(2, "ssh-terminal", "fontSize")).toBe(30);
    expect(hostValue(2, "ssh-terminal", "localEcho")).toBe("off");
    // Saved since host defaults: left alone.
    expect(hostValue(3, "ssh-terminal", "fontSize")).toBeUndefined();
  });

  it("gives a credential host its folder's credential", async () => {
    db.hosts = [
      {
        id: 1,
        userId: "u1",
        authType: "credential",
        credentialId: null,
        folder: "Prod",
        defaultOverrides: null,
      },
    ];
    db.folderCredential.set("Prod", 12);
    await runHostDefaultsMigration();
    expect(db.hosts[0].credentialId).toBe(12);
  });

  it("moves each level once", async () => {
    db.settings.host_defaults = JSON.stringify({ statusCheckEnabled: false });
    await runHostDefaultsMigration();
    db.defaults = [];
    await runHostDefaultsMigration();
    expect(level("core", "statusCheckEnabled", "admin")).toBeUndefined();
  });
});
