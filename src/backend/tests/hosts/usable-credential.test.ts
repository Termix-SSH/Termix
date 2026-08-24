import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  own: new Map<string, Record<string, unknown>>(), // `${userId}:${id}`
  rows: new Map<number, { id: number; userId: string }>(),
  grants: new Map<string, { id: number; permissionLevel: string }>(), // `${id}:${userId}`
  snapshots: new Map<string, Record<string, unknown>>(), // `${id}:${userId}`
  snapshotCalls: [] as unknown[][],
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentHostResolutionRepository: () => ({
    findCredentialByIdForUser: async (id: number, userId: string) =>
      state.own.get(`${userId}:${id}`) ?? null,
  }),
  createCurrentCredentialRepository: () => ({
    findById: async (id: number) => state.rows.get(id) ?? null,
  }),
  createCurrentRoleRepository: () => ({ listUserRoleIds: async () => [] }),
  createCurrentCredentialAccessRepository: () => ({
    findActiveGrant: async (id: number, userId: string) =>
      state.grants.get(`${id}:${userId}`) ?? null,
  }),
}));

vi.mock("../../utils/shared-credential-secrets-manager.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../utils/shared-credential-secrets-manager.js")
  >("../../utils/shared-credential-secrets-manager.js");
  return {
    ...actual,
    SharedCredentialSecretsManager: {
      getInstance: () => ({
        getSecretForUser: async (id: number, userId: string) =>
          state.snapshots.get(`${id}:${userId}`) ?? null,
        snapshotForUser: async (...args: unknown[]) => {
          state.snapshotCalls.push(args);
          const [, id, userId] = args as [number, number, string];
          state.snapshots.set(`${id}:${userId}`, {
            authType: "password",
            username: "svc",
            password: "pw",
          });
        },
      }),
    },
  };
});

const { findUsableCredential } = await import("../../hosts/usable-credential.js");

describe("findUsableCredential", () => {
  beforeEach(() => {
    state.own.clear();
    state.rows.clear();
    state.grants.clear();
    state.snapshots.clear();
    state.snapshotCalls.length = 0;
  });

  it("returns the user's own credential first", async () => {
    state.own.set("alice:1", { id: 1, userId: "alice", password: "mine" });
    expect(await findUsableCredential(1, "alice")).toMatchObject({ password: "mine" });
  });

  it("returns a shared credential from the recipient's snapshot, shaped like a row", async () => {
    state.rows.set(2, { id: 2, userId: "owner" });
    state.grants.set("2:bob", { id: 10, permissionLevel: "use" });
    state.snapshots.set("2:bob", {
      authType: "key",
      username: "deploy",
      privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
      keyType: "ssh-ed25519",
    });
    const cred = await findUsableCredential(2, "bob");
    expect(cred).toMatchObject({
      id: 2,
      userId: "owner",
      username: "deploy",
      authType: "key",
      privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----",
      key: null,
    });
  });

  it("builds the snapshot on demand when a grant exists but no copy yet", async () => {
    state.rows.set(3, { id: 3, userId: "owner" });
    state.grants.set("3:bob", { id: 11, permissionLevel: "use" });
    const cred = await findUsableCredential(3, "bob");
    expect(state.snapshotCalls).toEqual([[11, 3, "bob", "owner"]]);
    expect(cred).toMatchObject({ username: "svc", password: "pw" });
  });

  it("refuses credentials that are neither owned nor shared", async () => {
    state.rows.set(4, { id: 4, userId: "owner" });
    expect(await findUsableCredential(4, "mallory")).toBeNull();
    expect(await findUsableCredential(99, "mallory")).toBeNull();
  });
});
