import { describe, expect, it, vi } from "vitest";

const resolveHostById = vi.fn(async () => ({
  id: 9,
  userId: "owner",
  syncId: "host-9",
  name: "web",
  ip: "10.0.0.9",
  port: 22,
  username: "root",
  authType: "none",
  password: null,
  key: null,
  jumpHosts: [],
  loginRequired: true,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [3] }),
  createCurrentUserRepository: () => ({
    findById: async () => ({ username: "owner" }),
  }),
  createCurrentRbacAccessRepository: () => ({
    listVisibleHostAccessEntries: async () => [
      { hostId: 9, permissionLevel: "edit" },
    ],
  }),
  createCurrentHostResolutionRepository: () => ({
    listOwnedHostIds: async () => new Set<number>(),
  }),
}));
vi.mock("../../hosts/host-resolver.js", () => ({ resolveHostById }));
vi.mock("../../sync/host-plugin-settings.js", () => ({
  exportHostPluginSettings: async () => null,
  importHostPluginSettings: async () => {},
}));
vi.mock("../../sync/host-protocol-auth.js", () => ({
  exportProtocolLogins: async () => ({}),
  importProtocolLogins: async () => {},
  exportSharedProtocolLogins: async () => ({}),
}));

const { registerCoreSyncEntities } = await import("../../sync/entities.js");
const { getEntity } = await import("../../plugins/sync-registry.js");
registerCoreSyncEntities();

describe("shared host with no login for the recipient", () => {
  it("still syncs, marked as needing a login", async () => {
    const entity = getEntity("sharedHosts") as unknown as {
      load: (userId: string) => Promise<Array<Record<string, unknown>>>;
    };
    const rows = await entity.load("user-1");

    expect(resolveHostById).toHaveBeenCalledWith(9, "user-1", {
      allowMissingLogin: true,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].syncId).toBe("host-9");
    expect(rows[0].loginRequired).toBeUndefined();
    expect(rows[0].shared).toMatchObject({
      secretWithheld: true,
      loginRequired: true,
      permissionLevel: "edit",
    });
  });
});
