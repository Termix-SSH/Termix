import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, RequestHandler, Response } from "express";

const state = vi.hoisted(() => ({
  currentUserId: "admin1",
  users: new Map<
    string,
    {
      id: string;
      username: string;
      isAdmin: boolean;
      isOidc: boolean;
      passwordHash: string | null;
      totpEnabled: boolean;
    }
  >(),
  unlockedUsers: new Set<string>(),
  updates: [] as { id: string; changes: Record<string, unknown> }[],
  auditCalls: [] as Record<string, unknown>[],
}));

vi.mock("../../../database/db/index.js", () => ({ db: {} }));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: vi.fn(async () => {}) },
}));

vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: async (params: Record<string, unknown>) => {
    state.auditCalls.push(params);
  },
  getRequestMeta: () => ({ ipAddress: "", userAgent: "" }),
}));

vi.mock("../../../utils/data-crypto.js", () => ({
  DataCrypto: {
    canUserAccessData: (userId: string) => state.unlockedUsers.has(userId),
  },
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: { getInstance: () => ({}) },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentUserRepository: () => ({
    listAll: async () => [...state.users.values()],
    listPage: async ({
      search,
      limit,
      offset,
    }: {
      search?: string;
      limit: number;
      offset: number;
    }) => {
      const term = search?.trim().toLowerCase();
      const matched = [...state.users.values()]
        .filter((u) => !term || u.username?.toLowerCase().includes(term))
        .sort((a, b) =>
          (a.username ?? "").localeCompare(b.username ?? "", undefined, {
            sensitivity: "base",
          }),
        );
      return {
        users: matched.slice(offset, offset + limit),
        total: matched.length,
      };
    },
    findById: async (id: string) => state.users.get(id) ?? null,
    findByUsername: async (username: string) =>
      [...state.users.values()].find((u) => u.username === username) ?? null,
    update: async (id: string, changes: Record<string, unknown>) => {
      state.updates.push({ id, changes });
      const user = state.users.get(id);
      if (user) Object.assign(user, changes);
    },
  }),
  createCurrentRoleRepository: () => ({
    switchUserRoleName: async () => {},
    assignRoleNameToUser: async () => {},
  }),
}));

const { registerUserAdminRoutes } =
  await import("../../../database/routes/user-admin-routes.js");

// Capture the handlers registered on the router so we can invoke them directly
// without spinning up an HTTP server.
type Registered = { method: string; path: string; handler: RequestHandler };
const registered: Registered[] = [];

function fakeRouter() {
  const record =
    (method: string) =>
    (path: string, ...handlers: RequestHandler[]) => {
      registered.push({ method, path, handler: handlers[handlers.length - 1] });
    };
  return {
    get: record("get"),
    post: record("post"),
    put: record("put"),
    delete: record("delete"),
  } as unknown as import("express").Router;
}

registerUserAdminRoutes(fakeRouter(), (_req, _res, next) => next());

function findHandler(method: string, path: string): RequestHandler {
  const match = registered.find((r) => r.method === method && r.path === path);
  if (!match) throw new Error(`No handler for ${method} ${path}`);
  return match.handler;
}

function makeReqRes(overrides: {
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  query?: Record<string, unknown>;
}) {
  const req = {
    userId: state.currentUserId,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    query: overrides.query ?? {},
    headers: {},
  } as unknown as Request;

  const res = {
    statusCode: 200,
    jsonBody: null as unknown,
    headers: {} as Record<string, string>,
    status(code: number) {
      (this as unknown as { statusCode: number }).statusCode = code;
      return this;
    },
    json(payload: unknown) {
      (this as unknown as { jsonBody: unknown }).jsonBody = payload;
      return this;
    },
    setHeader(key: string, value: string) {
      (this as unknown as { headers: Record<string, string> }).headers[key] =
        value;
      return this;
    },
  } as unknown as Response & {
    statusCode: number;
    jsonBody: unknown;
    headers: Record<string, string>;
  };

  return { req, res };
}

async function invoke(
  method: string,
  path: string,
  overrides: {
    body?: Record<string, unknown>;
    params?: Record<string, unknown>;
    query?: Record<string, unknown>;
  } = {},
) {
  const handler = findHandler(method, path);
  const { req, res } = makeReqRes(overrides);
  await handler(req, res as unknown as Response, () => {});
  return res as unknown as {
    statusCode: number;
    jsonBody: Record<string, unknown> | null;
  };
}

beforeEach(() => {
  state.currentUserId = "admin1";
  state.users = new Map([
    [
      "admin1",
      {
        id: "admin1",
        username: "admin",
        isAdmin: true,
        isOidc: false,
        passwordHash: "hash",
        totpEnabled: false,
      },
    ],
    [
      "target1",
      {
        id: "target1",
        username: "target",
        isAdmin: false,
        isOidc: false,
        passwordHash: "hash",
        totpEnabled: true,
      },
    ],
    [
      "locked1",
      {
        id: "locked1",
        username: "locked",
        isAdmin: false,
        isOidc: false,
        passwordHash: "hash",
        totpEnabled: false,
      },
    ],
  ]);
  state.unlockedUsers = new Set(["admin1", "target1"]);
  state.updates = [];
  state.auditCalls = [];
});

describe("GET /list", () => {
  it("includes data_unlocked and totp_enabled for admin callers", async () => {
    const res = await invoke("get", "/list");
    expect(res.statusCode).toBe(200);
    const users = (res.jsonBody as { users: Record<string, unknown>[] }).users;
    const target = users.find((u) => u.userId === "target1")!;
    expect(target.data_unlocked).toBe(true);
    expect(target.totp_enabled).toBe(true);
    const locked = users.find((u) => u.userId === "locked1")!;
    expect(locked.data_unlocked).toBe(false);
  });

  it("omits management fields for non-admin callers", async () => {
    state.currentUserId = "target1";
    const res = await invoke("get", "/list");
    const users = (res.jsonBody as { users: Record<string, unknown>[] }).users;
    expect(users[0].data_unlocked).toBeUndefined();
    expect(users[0].totp_enabled).toBeUndefined();
  });

  it("returns every user when no limit is given", async () => {
    // The share pickers depend on this: they fetch once and filter locally.
    const res = await invoke("get", "/list");
    const body = res.jsonBody as {
      users: unknown[];
      limit?: number;
      total: number;
    };
    expect(body.users).toHaveLength(3);
    expect(body.total).toBe(3);
    expect(body.limit).toBeUndefined();
  });

  it("returns one page and the full total when a limit is given", async () => {
    const res = await invoke("get", "/list", { query: { limit: "2" } });
    const body = res.jsonBody as {
      users: unknown[];
      total: number;
      limit: number;
      offset: number;
    };
    expect(body.users).toHaveLength(2);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(2);
    expect(body.offset).toBe(0);
  });

  it("pages with an offset", async () => {
    const res = await invoke("get", "/list", {
      query: { limit: "2", offset: "2" },
    });
    const body = res.jsonBody as { users: unknown[]; total: number };
    expect(body.users).toHaveLength(1);
    expect(body.total).toBe(3);
  });

  it("filters by search term without a limit", async () => {
    const res = await invoke("get", "/list", { query: { search: "lock" } });
    const body = res.jsonBody as {
      users: { username: string }[];
      total: number;
    };
    expect(body.users.map((u) => u.username)).toEqual(["locked"]);
    expect(body.total).toBe(1);
  });

  it("caps an oversized page size", async () => {
    const res = await invoke("get", "/list", { query: { limit: "100000" } });
    expect((res.jsonBody as { limit: number }).limit).toBe(500);
  });

  it("ignores a non-numeric limit and returns the full list", async () => {
    const res = await invoke("get", "/list", { query: { limit: "abc" } });
    const body = res.jsonBody as { users: unknown[]; limit?: number };
    expect(body.users).toHaveLength(3);
    expect(body.limit).toBeUndefined();
  });
});

describe("POST /admin/totp/disable", () => {
  it("clears TOTP fields for the target and audits", async () => {
    const res = await invoke("post", "/admin/totp/disable", {
      body: { userId: "target1" },
    });
    expect(res.statusCode).toBe(200);
    const update = state.updates.find((u) => u.id === "target1");
    expect(update?.changes).toMatchObject({
      totpSecret: null,
      totpEnabled: false,
      totpBackupCodes: null,
    });
    expect(
      state.auditCalls.some((c) => c.action === "admin_disable_totp"),
    ).toBe(true);
  });

  it("403s when the caller is not an admin", async () => {
    state.currentUserId = "target1";
    const res = await invoke("post", "/admin/totp/disable", {
      body: { userId: "locked1" },
    });
    expect(res.statusCode).toBe(403);
  });

  it("400s when TOTP is not enabled for the target", async () => {
    const res = await invoke("post", "/admin/totp/disable", {
      body: { userId: "locked1" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("404s for an unknown target", async () => {
    const res = await invoke("post", "/admin/totp/disable", {
      body: { userId: "ghost" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /admin/export/:userId", () => {
  it("423s when the target's data is locked", async () => {
    const res = await invoke("get", "/admin/export/:userId", {
      params: { userId: "locked1" },
    });
    expect(res.statusCode).toBe(423);
    expect((res.jsonBody as { code?: string }).code).toBe("TARGET_DATA_LOCKED");
  });

  it("403s when the caller is not an admin", async () => {
    state.currentUserId = "target1";
    const res = await invoke("get", "/admin/export/:userId", {
      params: { userId: "admin1" },
    });
    expect(res.statusCode).toBe(403);
  });
});
