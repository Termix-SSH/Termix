import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  hostOverride: null as number | null,
  folderOverride: null as { folder: string; credentialId: number } | null,
  ownerSecret: null as Record<string, unknown> | null,
  usable: new Set<number>(),
  folderLookups: [] as Array<{ folder: unknown; protocol: string }>,
}));

vi.mock("../../hosts/protocol-auth/registry.js", () => ({
  isAuthOverrideProtocol: (protocol: string) => protocol === "ssh",
}));

vi.mock("../../hosts/usable-credential.js", () => ({
  findUsableCredential: async (id: number) =>
    state.usable.has(id) ? { id, username: `user-${id}` } : null,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findHostOwnerId: async () => "owner",
  }),
  createCurrentRbacAccessRepository: () => ({
    findActiveHostAccess: async () => null,
  }),
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [] }),
  createCurrentSharedHostAuthOverrideRepository: () => ({
    findCredentialId: async () => state.hostOverride,
  }),
  createCurrentSharedFolderAuthOverrideRepository: () => ({
    findClosest: async (_userId: string, folder: unknown, protocol: string) => {
      state.folderLookups.push({ folder, protocol });
      return state.folderOverride;
    },
  }),
}));

vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({
      getSecretForUser: async () => state.ownerSecret,
      snapshotForUser: async () => undefined,
    }),
  },
}));

const { resolveRecipientSharedHostAuthentication } =
  await import("../../utils/shared-host-auth-resolver.js");

const host = (extra: Record<string, unknown> = {}) =>
  ({
    id: 42,
    userId: "owner",
    folder: "Prod / Web",
    authType: "credential",
    credentialId: 99,
    shareSshAuth: false,
    ...extra,
  }) as never;

beforeEach(() => {
  state.hostOverride = null;
  state.folderOverride = null;
  state.ownerSecret = null;
  state.usable = new Set();
  state.folderLookups = [];
});

describe("folder logins for shared hosts", () => {
  it("uses the folder's login when the host has none of its own", async () => {
    state.folderOverride = { folder: "Prod", credentialId: 7 };
    state.usable.add(7);
    const result = await resolveRecipientSharedHostAuthentication(
      host(),
      42,
      "recipient",
      "ssh",
    );
    expect(result).toMatchObject({
      source: "personal-override",
      credentialId: 7,
      folder: "Prod",
    });
    expect(state.folderLookups).toEqual([
      { folder: "Prod / Web", protocol: "ssh" },
    ]);
  });

  it("lets the host's own login win over the folder's", async () => {
    state.hostOverride = 5;
    state.folderOverride = { folder: "Prod", credentialId: 7 };
    state.usable.add(5).add(7);
    const result = await resolveRecipientSharedHostAuthentication(
      host(),
      42,
      "recipient",
      "ssh",
    );
    expect(result).toMatchObject({ credentialId: 5 });
    expect(result).not.toHaveProperty("folder");
  });

  it("skips a folder login the user can no longer use", async () => {
    state.folderOverride = { folder: "Prod", credentialId: 7 };
    state.ownerSecret = { authType: "password", password: "x" };
    const result = await resolveRecipientSharedHostAuthentication(
      host({ shareSshAuth: true }),
      42,
      "recipient",
      "ssh",
    );
    expect(result).toMatchObject({ source: "owner-shared" });
  });

  it("asks for a login when nothing is set", async () => {
    const result = await resolveRecipientSharedHostAuthentication(
      host(),
      42,
      "recipient",
      "ssh",
    );
    expect(result).toEqual({ source: "required" });
  });
});
