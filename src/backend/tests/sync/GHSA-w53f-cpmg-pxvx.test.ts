import { beforeEach, describe, expect, it, vi } from "vitest";

const SECRET = "owner-secret-value";
const state = vi.hoisted(() => ({
  credentialGrants: [] as Array<Record<string, unknown>>,
  hostLevel: "connect",
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [] }),
  createCurrentCredentialAccessRepository: () => ({
    listSharedWithUser: async () => state.credentialGrants,
  }),
  createCurrentCredentialRepository: () => ({
    findById: async (id: number) => ({
      id,
      syncId: `cred-${id}`,
      name: "ops",
      description: null,
      tags: null,
    }),
  }),
  createCurrentUserRepository: () => ({
    findById: async () => ({ username: "owner" }),
  }),
  createCurrentRbacAccessRepository: () => ({
    listVisibleHostAccessEntries: async () => [
      { hostId: 9, permissionLevel: state.hostLevel },
    ],
  }),
  createCurrentHostResolutionRepository: () => ({
    listOwnedHostIds: async () => new Set<number>(),
  }),
}));
vi.mock("../../hosts/usable-credential.js", () => ({
  findUsableCredential: async () => ({
    authType: "password",
    username: "root",
    password: SECRET,
    privateKey: SECRET,
    keyPassword: SECRET,
  }),
}));
vi.mock("../../hosts/host-resolver.js", () => ({
  resolveHostById: async () => ({
    id: 9,
    userId: "owner",
    syncId: "host-9",
    name: "web",
    ip: "10.0.0.9",
    port: 22,
    username: "root",
    authType: "password",
    password: SECRET,
    key: SECRET,
    keyPassword: SECRET,
    sudoPassword: SECRET,
    socks5Password: SECRET,
    socks5ProxyChain: JSON.stringify([
      { host: "p", port: 1080, type: 5, password: SECRET },
    ]),
    jumpHosts: [],
  }),
}));
vi.mock("../../sync/host-plugin-settings.js", () => ({
  exportHostPluginSettings: async () => null,
  importHostPluginSettings: async () => {},
}));
vi.mock("../../sync/host-protocol-auth.js", () => ({
  exportProtocolLogins: async () => ({}),
  importProtocolLogins: async () => {},
  exportSharedProtocolLogins: async () => ({
    rdp: { authType: "direct", username: "u", password: SECRET, fields: {} },
  }),
}));

const { registerCoreSyncEntities } = await import("../../sync/entities.js");
const { getEntity } = await import("../../plugins/sync-registry.js");
registerCoreSyncEntities();

async function load(type: string) {
  const entity = getEntity(type) as unknown as {
    load: (userId: string) => Promise<Array<Record<string, unknown>>>;
  };
  return entity.load("user-1");
}

beforeEach(() => {
  state.credentialGrants = [];
  state.hostLevel = "connect";
});

describe("GHSA-w53f-cpmg-pxvx desktop sync feed", () => {
  it("sends a use level credential without its secret", async () => {
    state.credentialGrants = [
      { credentialId: 1, ownerId: "owner", permissionLevel: "use" },
    ];
    const rows = await load("sharedCredentials");
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(SECRET);
    expect(rows[0].shared).toMatchObject({ secretWithheld: true });
  });

  it("still sends the secret with a manage grant", async () => {
    state.credentialGrants = [
      { credentialId: 1, ownerId: "owner", permissionLevel: "manage" },
    ];
    const rows = await load("sharedCredentials");
    expect(rows[0].password).toBe(SECRET);
  });

  it.each(["connect", "view"])(
    "sends a %s level host without any login",
    async (level) => {
      state.hostLevel = level;
      const rows = await load("sharedHosts");
      expect(rows).toHaveLength(1);
      expect(JSON.stringify(rows)).not.toContain(SECRET);
      expect(rows[0].shared).toMatchObject({ secretWithheld: true });
    },
  );

  it("keeps the login for an edit level host", async () => {
    state.hostLevel = "edit";
    const rows = await load("sharedHosts");
    expect(rows[0].password).toBe(SECRET);
  });
});
