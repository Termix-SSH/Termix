import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, RequestHandler, Response } from "express";

type FakeUser = {
  id: string;
  username: string;
  isAdmin: boolean;
  disabledAt: string | null;
  disabledReason: string | null;
  displayName: string | null;
  email: string | null;
};

type FakeInvite = {
  id: string;
  tokenHash: string;
  note: string | null;
  roleIds: string | null;
  makeAdmin: boolean;
  maxUses: number;
  uses: number;
  createdBy: string | null;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
};

const state = vi.hoisted(() => ({
  currentUserId: "admin1",
  users: new Map<string, FakeUser>(),
  rolePermissions: new Map<string, string[]>(),
  roles: new Map<
    number,
    { id: number; name: string; isSystem: boolean; permissions: string }
  >(),
  assigned: [] as { userId: string; roleId: number }[],
  invites: new Map<string, FakeInvite>(),
  settings: new Map<string, string>(),
  revoked: [] as string[],
  audits: [] as Record<string, unknown>[],
  promoted: [] as string[],
}));

vi.mock("../../../database/db/index.js", () => ({ db: {} }));
vi.mock("../../../utils/logger.js", () => {
  const log = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    debug: vi.fn(),
  };
  return { authLogger: log, databaseLogger: log };
});
vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
}));
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (entry: Record<string, unknown>) => {
    state.audits.push(entry);
  },
  auditSettingChange: async () => {},
  getAuditUsername: async (id: string) => id,
  getRequestMeta: () => ({ ipAddress: "", userAgent: "" }),
}));
vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      revokeAllUserSessions: async (id: string) => {
        state.revoked.push(id);
        return 1;
      },
      registerUser: async () => {},
    }),
  },
}));
vi.mock("../../../auth/admin-holds.js", () => ({
  holdIfNeeded: async () => false,
  registerHoldKind: () => {},
  getHoldSettings: async () => ({ active: false, minutes: 0 }),
  createHold: async () => ({}),
}));
vi.mock("../../../database/routes/user-admin-routes.js", () => ({
  promoteToAdmin: async (_actor: string, id: string) => {
    state.promoted.push(id);
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  getCurrentSettingValue: (key: string) => state.settings.get(key) ?? null,
  createCurrentSettingsRepository: () => ({
    set: async (key: string, value: string) => {
      state.settings.set(key, value);
    },
  }),
  createCurrentUserRepository: () => ({
    findById: async (id: string) => state.users.get(id) ?? null,
    findByUsername: async (name: string) =>
      [...state.users.values()].find((u) => u.username === name) ?? null,
    findByEmail: async (email: string) =>
      [...state.users.values()].find((u) => u.email === email) ?? null,
    countAdmins: async () =>
      [...state.users.values()].filter((u) => u.isAdmin && !u.disabledAt)
        .length,
    update: async (id: string, changes: Partial<FakeUser>) => {
      const user = state.users.get(id);
      if (!user) return null;
      Object.assign(user, changes);
      return user;
    },
    create: async (user: {
      id: string;
      username: string;
      isAdmin: boolean;
    }) => {
      const created: FakeUser = {
        ...user,
        disabledAt: null,
        disabledReason: null,
        displayName: null,
        email: null,
      };
      state.users.set(user.id, created);
      return created;
    },
    delete: async (id: string) => state.users.delete(id),
  }),
  createCurrentRoleRepository: () => ({
    listUserRolePermissions: async (userId: string) => [
      {
        roleName: "custom",
        permissions: JSON.stringify(state.rolePermissions.get(userId) ?? []),
      },
    ],
    findRoleById: async (id: number) => state.roles.get(id) ?? null,
    assignRoleNameToUser: async () => true,
    assignRoleToUser: async (input: { userId: string; roleId: number }) => {
      state.assigned.push({ userId: input.userId, roleId: input.roleId });
    },
  }),
  createCurrentUserInviteRepository: () => ({
    create: async (invite: FakeInvite) => {
      state.invites.set(invite.id, { ...invite, revokedAt: null });
      return state.invites.get(invite.id);
    },
    list: async () =>
      [...state.invites.values()].map((invite) => ({
        ...invite,
        createdByUsername: invite.createdBy,
      })),
    findById: async (id: string) => state.invites.get(id) ?? null,
    findByTokenHash: async (hash: string) =>
      [...state.invites.values()].find((i) => i.tokenHash === hash) ?? null,
    revoke: async (id: string) => {
      const invite = state.invites.get(id);
      if (invite) invite.revokedAt = new Date().toISOString();
      return true;
    },
    claimUse: async (id: string) => {
      const invite = state.invites.get(id);
      if (!invite || invite.revokedAt || invite.uses >= invite.maxUses) {
        return false;
      }
      invite.uses += 1;
      return true;
    },
    releaseUse: async () => {},
  }),
}));
vi.mock("../../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ snapshotForRoleMember: async () => {} }),
  },
}));
vi.mock("../../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ snapshotForRoleMember: async () => {} }),
  },
}));

const { registerUserLifecycleRoutes, readProfileInput } =
  await import("../../../database/routes/user-lifecycle-routes.js");
const { PermissionManager } =
  await import("../../../utils/permission-manager.js");

type Registered = { method: string; path: string; handler: RequestHandler };
const registered: Registered[] = [];
const record =
  (method: string) =>
  (path: string, ...handlers: RequestHandler[]) => {
    registered.push({ method, path, handler: handlers[handlers.length - 1] });
  };
registerUserLifecycleRoutes(
  {
    get: record("get"),
    post: record("post"),
    patch: record("patch"),
    delete: record("delete"),
  } as unknown as import("express").Router,
  (_req, _res, next) => next(),
);

async function invoke(
  method: string,
  path: string,
  input: { body?: unknown; params?: Record<string, string> } = {},
) {
  const match = registered.find((r) => r.method === method && r.path === path);
  if (!match) throw new Error(`No handler for ${method} ${path}`);
  const req = {
    userId: state.currentUserId,
    body: input.body ?? {},
    params: input.params ?? {},
    query: {},
    headers: {},
  } as unknown as Request;
  const res = {
    statusCode: 200,
    body: null as Record<string, unknown> | null,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(payload: Record<string, unknown>) {
      this.body = payload;
      return this;
    },
  };
  await match.handler(req, res as unknown as Response, () => {});
  return res;
}

function user(id: string, isAdmin = false): FakeUser {
  return {
    id,
    username: id,
    isAdmin,
    disabledAt: null,
    disabledReason: null,
    displayName: null,
    email: null,
  };
}

function asHelpdesk() {
  state.currentUserId = "help1";
  state.rolePermissions.set("help1", [
    "admin.users.view",
    "admin.users.manage",
  ]);
  PermissionManager.getInstance().invalidateUserPermissionCache("help1");
}

beforeEach(() => {
  state.currentUserId = "admin1";
  state.users = new Map([
    ["admin1", user("admin1", true)],
    ["help1", user("help1")],
    ["target1", user("target1")],
  ]);
  state.rolePermissions = new Map();
  state.roles = new Map([
    [1, { id: 1, name: "ops", isSystem: false, permissions: '["hosts.*"]' }],
    [2, { id: 2, name: "admin", isSystem: true, permissions: '["*"]' }],
  ]);
  state.assigned = [];
  state.invites = new Map();
  state.settings = new Map();
  state.revoked = [];
  state.audits = [];
  state.promoted = [];
  for (const id of ["admin1", "help1", "target1"]) {
    PermissionManager.getInstance().invalidateUserPermissionCache(id);
  }
});

describe("readProfileInput", () => {
  it("trims and lowercases", () => {
    expect(
      readProfileInput({ displayName: "  Sam ", email: " Sam@Example.COM " }),
    ).toEqual({
      ok: true,
      update: { displayName: "Sam", email: "sam@example.com" },
    });
  });

  it("clears with an empty value and refuses a bad email", () => {
    expect(readProfileInput({ email: "" })).toEqual({
      ok: true,
      update: { email: null },
    });
    expect(readProfileInput({ email: "nope" })).toMatchObject({ ok: false });
    expect(readProfileInput({})).toMatchObject({ ok: false });
  });
});

describe("disable and enable", () => {
  it("turns an account off, ends its sessions and audits", async () => {
    const res = await invoke("post", "/admin/:userId/disable", {
      params: { userId: "target1" },
    });
    expect(res.statusCode).toBe(200);
    expect(state.users.get("target1")?.disabledAt).toBeTruthy();
    expect(state.revoked).toEqual(["target1"]);
    expect(state.audits[0]).toMatchObject({ action: "disable_user" });
  });

  it("refuses your own account and the last admin", async () => {
    let res = await invoke("post", "/admin/:userId/disable", {
      params: { userId: "admin1" },
    });
    expect(res.statusCode).toBe(400);
    state.users.set("admin2", user("admin2", true));
    state.currentUserId = "admin2";
    state.users.get("admin1")!.disabledAt = null;
    res = await invoke("post", "/admin/:userId/disable", {
      params: { userId: "admin1" },
    });
    expect(res.statusCode).toBe(200);
    state.users.set("admin3", user("admin3", true));
    state.currentUserId = "admin3";
    state.users.get("admin2")!.isAdmin = true;
    res = await invoke("post", "/admin/:userId/disable", {
      params: { userId: "admin2" },
    });
    expect(res.statusCode).toBe(200);
    expect(
      (
        await invoke("post", "/admin/:userId/disable", {
          params: { userId: "admin3" },
        })
      ).statusCode,
    ).toBe(400);
  });

  it("lets a helpdesk role turn off a normal user but not an admin", async () => {
    asHelpdesk();
    expect(
      (
        await invoke("post", "/admin/:userId/disable", {
          params: { userId: "target1" },
        })
      ).statusCode,
    ).toBe(200);
    expect(
      (
        await invoke("post", "/admin/:userId/disable", {
          params: { userId: "admin1" },
        })
      ).statusCode,
    ).toBe(403);
  });

  it("refuses a plain user", async () => {
    state.currentUserId = "target1";
    const res = await invoke("post", "/admin/:userId/disable", {
      params: { userId: "help1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("approves a waiting account", async () => {
    Object.assign(state.users.get("target1")!, {
      disabledAt: "2026-11-16T00:00:00.000Z",
      disabledReason: "pending_approval",
    });
    const res = await invoke("post", "/admin/:userId/enable", {
      params: { userId: "target1" },
    });
    expect(res.statusCode).toBe(200);
    expect(state.users.get("target1")?.disabledAt).toBeNull();
    expect(state.audits[0]).toMatchObject({ action: "approve_user" });
  });
});

describe("profiles", () => {
  it("saves your own display name and email", async () => {
    state.currentUserId = "target1";
    const res = await invoke("patch", "/me/profile", {
      body: { displayName: "Tara", email: "tara@example.com" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      display_name: "Tara",
      email: "tara@example.com",
    });
  });

  it("refuses an email someone else has", async () => {
    state.users.get("help1")!.email = "taken@example.com";
    state.currentUserId = "target1";
    const res = await invoke("patch", "/me/profile", {
      body: { email: "taken@example.com" },
    });
    expect(res.statusCode).toBe(409);
  });
});

describe("admin settings", () => {
  it("only admins change admin host access", async () => {
    asHelpdesk();
    let res = await invoke("patch", "/admin-host-bypass", {
      body: { enabled: false },
    });
    expect(res.statusCode).toBe(403);
    state.currentUserId = "admin1";
    res = await invoke("patch", "/admin-host-bypass", {
      body: { enabled: false },
    });
    expect(res.statusCode).toBe(200);
    expect(state.settings.get("admin_host_bypass")).toBe("false");
    res = await invoke("get", "/admin-host-bypass");
    expect(res.body).toEqual({ enabled: false });
  });
});

describe("invites", () => {
  it("makes a link that creates an account with its roles", async () => {
    const created = await invoke("post", "/invites", {
      body: { roleIds: [1], maxUses: 1 },
    });
    expect(created.statusCode).toBe(200);
    const token = String(created.body?.token);
    expect(token.startsWith("tmi_")).toBe(true);

    const check = await invoke("get", "/invites/redeem/:token", {
      params: { token },
    });
    expect(check.body).toEqual({ valid: true, state: "active" });

    const accepted = await invoke("post", "/invites/redeem/:token/accept", {
      params: { token },
      body: { username: "newbie", password: "Long-pass-123!" },
    });
    expect(accepted.statusCode).toBe(200);
    const newId = String(accepted.body?.userId);
    expect(state.users.get(newId)?.username).toBe("newbie");
    expect(state.assigned).toEqual([{ userId: newId, roleId: 1 }]);

    const again = await invoke("post", "/invites/redeem/:token/accept", {
      params: { token },
      body: { username: "second", password: "Long-pass-123!" },
    });
    expect(again.statusCode).toBe(404);
  });

  it("refuses a bad token and system roles", async () => {
    const bad = await invoke("post", "/invites/redeem/:token/accept", {
      params: { token: "tmi_nope" },
      body: { username: "x1", password: "Long-pass-123!" },
    });
    expect(bad.statusCode).toBe(404);
    const system = await invoke("post", "/invites", { body: { roleIds: [2] } });
    expect(system.statusCode).toBe(400);
  });

  it("keeps a helpdesk role from inviting admins or above its own rights", async () => {
    asHelpdesk();
    expect(
      (await invoke("post", "/invites", { body: { makeAdmin: true } }))
        .statusCode,
    ).toBe(403);
    expect(
      (await invoke("post", "/invites", { body: { roleIds: [1] } })).statusCode,
    ).toBe(403);
    expect((await invoke("post", "/invites", { body: {} })).statusCode).toBe(
      200,
    );
  });

  it("promotes an admin invite once it is accepted", async () => {
    const created = await invoke("post", "/invites", {
      body: { makeAdmin: true },
    });
    const token = String(created.body?.token);
    const accepted = await invoke("post", "/invites/redeem/:token/accept", {
      params: { token },
      body: { username: "boss", password: "Long-pass-123!" },
    });
    expect(state.promoted).toEqual([accepted.body?.userId]);
  });

  it("stops a revoked invite", async () => {
    const created = await invoke("post", "/invites", { body: {} });
    await invoke("delete", "/invites/:id", {
      params: { id: String(created.body?.id) },
    });
    const check = await invoke("get", "/invites/redeem/:token", {
      params: { token: String(created.body?.token) },
    });
    expect(check.body).toEqual({ valid: false, state: "revoked" });
  });
});
