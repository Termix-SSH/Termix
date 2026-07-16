import crypto from "crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ownerDEK = crypto.randomBytes(32);
const targetDEK = crypto.randomBytes(32);

const state = vi.hoisted(() => ({
  sharedRows: [] as Array<Record<string, unknown>>,
  ownerCredential: null as Record<string, unknown> | null,
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentCredentialRepository: () => ({
    findByIdForUser: async (_userId: string, _id: number) =>
      state.ownerCredential,
  }),
  createCurrentSharedCredentialRepository: () => ({
    existsForHostAccessAndTargetUser: async () => state.sharedRows.length > 0,
    create: async (row: Record<string, unknown>) => {
      const created = { id: state.sharedRows.length + 1, ...row };
      state.sharedRows.push(created);
      return created;
    },
    listByOriginalCredentialId: async () => state.sharedRows,
    updateById: async (id: number, update: Record<string, unknown>) => {
      const row = state.sharedRows.find((r) => r.id === id);
      if (row) Object.assign(row, update);
      return row ?? null;
    },
    deleteByOriginalCredentialId: async () => 0,
  }),
  createCurrentRbacAccessRepository: () => ({
    findSharedCredentialForHostAndUser: async () => state.sharedRows[0] ?? null,
  }),
  createCurrentRoleRepository: () => ({
    listRoleUserIds: async () => [],
    listUserRoleIds: async () => [],
  }),
}));

vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    validateUserAccess: (userId: string) => {
      if (userId === "owner") return ownerDEK;
      if (userId === "target") return targetDEK;
      throw new Error(`User ${userId} has no data encryption key`);
    },
    getUserDataKey: (userId: string) =>
      userId === "owner" ? ownerDEK : userId === "target" ? targetDEK : null,
    canUserAccessData: () => true,
  },
}));

import { FieldCrypto } from "../../utils/field-crypto.js";
import { SharedCredentialManager } from "../../utils/shared-credential-manager.js";

const manager = SharedCredentialManager.getInstance();

beforeEach(() => {
  state.sharedRows = [];
  state.ownerCredential = {
    id: 42,
    userId: "owner",
    username: "root",
    authType: "password",
    password: FieldCrypto.encryptField("hunter2", ownerDEK, "42", "password"),
    key: null,
    keyPassword: null,
    keyType: null,
  };
});

describe("SharedCredentialManager", () => {
  it("shares a credential and the target can decrypt it", async () => {
    await manager.createSharedCredentialForUser(7, 42, "target", "owner");

    expect(state.sharedRows).toHaveLength(1);
    const row = state.sharedRows[0];
    expect(row.encryptedPassword).not.toBe("hunter2");
    expect(row.targetUserId).toBe("target");

    const resolved = await manager.getSharedCredentialForUser(1, "target");
    expect(resolved).toMatchObject({
      username: "root",
      authType: "password",
      password: "hunter2",
    });
  });

  it("fails the share when a participant has no key instead of queueing", async () => {
    await expect(
      manager.createSharedCredentialForUser(7, 42, "locked-user", "owner"),
    ).rejects.toThrow(/no data encryption key/);
    expect(state.sharedRows).toHaveLength(0);
  });

  it("re-encrypts existing share copies when the original changes", async () => {
    await manager.createSharedCredentialForUser(7, 42, "target", "owner");
    state.ownerCredential!.password = FieldCrypto.encryptField(
      "new-password",
      ownerDEK,
      "42",
      "password",
    );

    await manager.updateSharedCredentialsForOriginal(42, "owner");

    const resolved = await manager.getSharedCredentialForUser(1, "target");
    expect(resolved?.password).toBe("new-password");
  });
});
