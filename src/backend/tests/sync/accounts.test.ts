import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  users: [] as Array<{
    id: string;
    username: string;
    isAdmin: boolean;
    registeredAt: string;
  }>,
  saved: null as string | null,
  create: vi.fn(),
  assignRole: vi.fn(),
  registerUser: vi.fn(),
  deleteUserAndRelatedData: vi.fn(),
  set: vi.fn(),
}));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    listAll: async () => mocks.users,
    findById: async (id: string) =>
      mocks.users.find((u) => u.id === id) ?? null,
    create: mocks.create,
  }),
  createCurrentRoleRepository: () => ({
    assignRoleNameToUser: mocks.assignRole,
  }),
  createCurrentSettingsRepository: () => ({
    get: async () => mocks.saved,
    set: async (key: string, value: string) => {
      mocks.set(key, value);
      mocks.saved = value;
    },
  }),
}));
vi.mock("../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => ({ registerUser: mocks.registerUser }) },
}));
vi.mock("../../database/routes/delete-user-data.js", () => ({
  deleteUserAndRelatedData: mocks.deleteUserAndRelatedData,
}));

const {
  createAccount,
  getActiveUserId,
  listAccounts,
  removeAccount,
  setActiveUserId,
} = await import("../../sync/accounts.js");

function user(
  id: string,
  isAdmin = false,
  registeredAt = "2026-01-01T00:00:00Z",
) {
  return { id, username: id, isAdmin, registeredAt };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.saved = null;
  mocks.users = [
    user("local", true),
    user("work", false, "2026-02-01T00:00:00Z"),
  ];
});

describe("desktop accounts", () => {
  it("signs in as the usual user until one is chosen", async () => {
    expect(await getActiveUserId()).toBe("local");
    await setActiveUserId("work");
    expect(await getActiveUserId()).toBe("work");
  });

  it("will not switch to an account that does not exist", async () => {
    await expect(setActiveUserId("nope")).rejects.toThrow("No such account");
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("lists the accounts with the active one marked", async () => {
    await setActiveUserId("work");
    expect(await listAccounts()).toEqual([
      expect.objectContaining({ id: "local", active: false }),
      expect.objectContaining({ id: "work", active: true }),
    ]);
  });

  it("makes an empty admin account with its own data key", async () => {
    const id = await createAccount();
    expect(mocks.create).toHaveBeenCalledWith(
      expect.objectContaining({ id, isAdmin: true, passwordHash: "" }),
    );
    expect(mocks.assignRole).toHaveBeenCalledWith(
      expect.objectContaining({ userId: id, roleName: "admin" }),
    );
    expect(mocks.registerUser).toHaveBeenCalledWith(id, expect.any(String));
  });

  it("removes an account and its data", async () => {
    await removeAccount("work");
    expect(mocks.deleteUserAndRelatedData).toHaveBeenCalledWith("work");
  });

  it("moves to another account when the active one is removed", async () => {
    await setActiveUserId("work");
    mocks.set.mockClear();
    await removeAccount("work");
    expect(mocks.set).toHaveBeenCalledWith("desktop_active_user", "local");
  });

  it("keeps the last account", async () => {
    mocks.users = [user("local", true)];
    await expect(removeAccount("local")).rejects.toThrow("last account");
    expect(mocks.deleteUserAndRelatedData).not.toHaveBeenCalled();
  });
});
