import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  defaults: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../../database/routes/host-plugin-settings.js", () => ({
  hostSettingsPlugins: () => [],
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({ get: async () => null }),
  createCurrentHostDefaultsRepository: () => ({
    listForUsers: async () => db.defaults,
    listFolders: async () => [],
    listHostPlacement: async () => [],
  }),
}));

const { applyHostDefaultsToWrite } =
  await import("../../../hosts/defaults/write-rules.js");
const { applyOverrideChange } =
  await import("../../../hosts/defaults/overrides.js");

function userDefault(key: string, value: unknown) {
  db.defaults.push({
    level: "user",
    userId: "u1",
    folderId: null,
    namespace: "core",
    key,
    value: JSON.stringify(value),
  });
}

beforeEach(() => {
  db.defaults = [];
});

describe("applyHostDefaultsToWrite", () => {
  it("takes the editor's list as the answer and fills what it inherits", async () => {
    userDefault("sshPort", 2022);
    const columns: Record<string, unknown> = {
      sshPort: 9999,
      port: 9999,
      connectionType: "ssh",
    };
    const overrides = await applyHostDefaultsToWrite({
      ownerId: "u1",
      hostId: null,
      columns,
      body: { defaultOverrides: { core: [], term: ["fontSize"] } },
    });
    expect(columns.sshPort).toBe(2022);
    expect(columns.port).toBe(2022);
    expect(overrides.core).toEqual([]);
    expect(overrides.term).toEqual(["fontSize"]);
  });

  it("inherits what a create leaves out, and keeps what it sets", async () => {
    userDefault("sshPort", 2022);
    userDefault("statusCheckEnabled", false);
    const columns: Record<string, unknown> = {
      sshPort: 22,
      port: 22,
      statusCheckEnabled: 1,
      username: "deploy",
      connectionType: "ssh",
    };
    const overrides = await applyHostDefaultsToWrite({
      ownerId: "u1",
      hostId: null,
      columns,
      body: { ip: "10.0.0.1", port: 22, username: "deploy" },
    });
    expect(columns.statusCheckEnabled).toBe(false);
    // The port was sent and differs from the default, so it is the host's.
    expect(overrides.core).toContain("sshPort");
    expect(columns.sshPort).toBe(22);
    expect(overrides.core).toContain("username");
  });

  it("marks a changed key on an update without a list, and keeps the rest", async () => {
    userDefault("sshPort", 2022);
    const stored = {
      id: 5,
      userId: "u1",
      sshPort: 2022,
      port: 2022,
      statusCheckEnabled: true,
      username: "root",
      defaultOverrides: JSON.stringify({ core: ["username"] }),
    };
    const columns: Record<string, unknown> = {
      sshPort: 2022,
      port: 2022,
      statusCheckEnabled: 0,
      username: "root",
    };
    const overrides = await applyHostDefaultsToWrite({
      ownerId: "u1",
      hostId: 5,
      columns,
      body: {},
      stored: stored as never,
    });
    expect(overrides.core).toEqual(["statusCheckEnabled", "username"]);
  });

  it("keeps a locked key's state for a shared editor", async () => {
    const overrides = await applyHostDefaultsToWrite({
      ownerId: "u1",
      hostId: 5,
      columns: {},
      body: { defaultOverrides: { core: [] } },
      stored: {
        id: 5,
        userId: "u1",
        defaultOverrides: JSON.stringify({ core: ["auth"] }),
      } as never,
      lockedKeys: ["auth"],
    });
    expect(overrides.core).toContain("auth");
  });
});

describe("applyOverrideChange", () => {
  it("adds and removes keys, per namespace", () => {
    const next = applyOverrideChange(
      { core: ["sshPort"], term: ["fontSize", "theme"] },
      { own: [["core", "username"]], inherit: [["term", "theme"]] },
    );
    expect(next).toEqual({ core: ["sshPort", "username"], term: ["fontSize"] });
  });

  it("leaves a namespace nobody classified yet to its first pass", () => {
    expect(applyOverrideChange({ core: [] }, { own: [["term", "x"]] })).toEqual(
      { core: [] },
    );
    expect(applyOverrideChange(null, { own: [["core", "x"]] })).toEqual({});
  });

  it("resets everything, known namespaces included", () => {
    expect(
      applyOverrideChange({ core: ["a"] }, { inheritAll: true }, [
        "core",
        "term",
      ]),
    ).toEqual({ core: [], term: [] });
  });
});
