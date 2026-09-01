import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, Router } from "express";

type WorkspaceRow = {
  id: number;
  userId: string;
  name: string;
  color: string | null;
  icon: string | null;
  kind: "manual" | "last_session";
  isDefault: boolean;
  payload: string;
  syncId: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt: string | null;
};

const state = vi.hoisted(() => ({
  currentUserId: "user-1",
  workspaces: new Map<number, WorkspaceRow>(),
  nextId: 1,
}));

vi.mock("../../../database/db/index.js", () => ({ db: {} }));

vi.mock("../../../utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../../utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (req: Record<string, unknown>, _res: unknown, next: () => void) => {
          req.userId = state.currentUserId;
          next();
        },
      createDataAccessMiddleware:
        () => (_req: unknown, _res: unknown, next: () => void) =>
          next(),
    }),
  },
}));

function findByIdForUser(userId: string, id: number): WorkspaceRow | null {
  const row = state.workspaces.get(id);
  return row && row.userId === userId ? row : null;
}

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentWorkspaceRepository: () => ({
    listByUser: async (userId: string) =>
      [...state.workspaces.values()].filter((w) => w.userId === userId),
    findById: async (userId: string, id: number) => findByIdForUser(userId, id),
    findLastSession: async (userId: string) =>
      [...state.workspaces.values()].find(
        (w) => w.userId === userId && w.kind === "last_session",
      ) ?? null,
    upsertLastSession: async (userId: string, payload: string) => {
      const existing = [...state.workspaces.values()].find(
        (w) => w.userId === userId && w.kind === "last_session",
      );
      if (existing) {
        existing.payload = payload;
        existing.updatedAt = new Date().toISOString();
        return existing;
      }
      const row: WorkspaceRow = {
        id: state.nextId++,
        userId,
        name: "Last Session",
        color: null,
        icon: null,
        kind: "last_session",
        isDefault: false,
        payload,
        syncId: `sync-${state.nextId}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsedAt: null,
      };
      state.workspaces.set(row.id, row);
      return row;
    },
    create: async (
      userId: string,
      input: {
        name: string;
        color?: string | null;
        icon?: string | null;
        payload: string;
      },
    ) => {
      const row: WorkspaceRow = {
        id: state.nextId++,
        userId,
        name: input.name,
        color: input.color ?? null,
        icon: input.icon ?? null,
        kind: "manual",
        isDefault: false,
        payload: input.payload,
        syncId: `sync-${state.nextId}`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastUsedAt: null,
      };
      state.workspaces.set(row.id, row);
      return row;
    },
    update: async (
      userId: string,
      id: number,
      input: { name?: string; color?: string | null; icon?: string | null },
    ) => {
      const row = findByIdForUser(userId, id);
      if (!row || row.kind !== "manual") return null;
      if (input.name !== undefined) row.name = input.name;
      if (input.color !== undefined) row.color = input.color;
      if (input.icon !== undefined) row.icon = input.icon;
      return row;
    },
    updateContent: async (userId: string, id: number, payload: string) => {
      const row = findByIdForUser(userId, id);
      if (!row || row.kind !== "manual") return null;
      row.payload = payload;
      return row;
    },
    setDefault: async (userId: string, id: number) => {
      const row = findByIdForUser(userId, id);
      if (!row || row.kind !== "manual") return null;
      for (const w of state.workspaces.values()) {
        if (w.userId === userId && w.kind === "manual") w.isDefault = false;
      }
      row.isDefault = true;
      return row;
    },
    unsetDefault: async (userId: string, id: number) => {
      const row = findByIdForUser(userId, id);
      if (!row || row.kind !== "manual") return null;
      row.isDefault = false;
      return row;
    },
    touchLastUsed: async (userId: string, id: number) => {
      const row = findByIdForUser(userId, id);
      if (row) row.lastUsedAt = new Date().toISOString();
    },
    delete: async (userId: string, id: number) => {
      const row = findByIdForUser(userId, id);
      if (!row || row.kind !== "manual") return false;
      state.workspaces.delete(id);
      return true;
    },
  }),
}));

const { default: router } =
  await import("../../../database/routes/workspaces.js");

function findLayer(method: string, path: string) {
  const stack = (router as unknown as Router).stack as Array<{
    route?: {
      path: string;
      methods: Record<string, boolean>;
      stack: Array<{ handle: (req: Request, res: Response) => unknown }>;
    };
  }>;
  const layer = stack.find(
    (l) => l.route?.path === path && l.route?.methods[method],
  );
  if (!layer?.route) throw new Error(`No route for ${method} ${path}`);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}

function makeReqRes(overrides: {
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
}) {
  const req = {
    userId: state.currentUserId,
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    headers: {},
  } as unknown as Request;

  const res = {
    statusCode: 200,
    jsonBody: null as unknown,
    status(code: number) {
      (this as unknown as { statusCode: number }).statusCode = code;
      return this;
    },
    json(payload: unknown) {
      (this as unknown as { jsonBody: unknown }).jsonBody = payload;
      return this;
    },
  } as unknown as Response & { statusCode: number; jsonBody: unknown };

  return { req, res };
}

async function invoke(
  method: string,
  path: string,
  overrides: {
    body?: Record<string, unknown>;
    params?: Record<string, unknown>;
  } = {},
) {
  const handler = findLayer(method, path);
  const { req, res } = makeReqRes(overrides);
  await handler(req, res);
  return res as unknown as {
    statusCode: number;
    jsonBody: Record<string, unknown> | null;
  };
}

beforeEach(() => {
  state.currentUserId = "user-1";
  state.workspaces = new Map();
  state.nextId = 1;
});

describe("GET /", () => {
  it("returns the list with a computed tabCount", async () => {
    await invoke("post", "/", {
      body: {
        name: "Test A",
        payload: { version: 1, tabs: [{ slotId: "a" }, { slotId: "b" }] },
      },
    });

    const res = await invoke("get", "/");
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toHaveLength(1);
    expect(
      (res.jsonBody as unknown as { tabCount: number }[])[0].tabCount,
    ).toBe(2);
  });
});

describe("POST /", () => {
  it("400s when name is missing", async () => {
    const res = await invoke("post", "/", {
      body: { payload: { version: 1, tabs: [] } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("400s when payload has no tabs array", async () => {
    const res = await invoke("post", "/", {
      body: { name: "Test A", payload: { version: 1 } },
    });
    expect(res.statusCode).toBe(400);
  });

  it("200s and creates a manual workspace", async () => {
    const res = await invoke("post", "/", {
      body: { name: "Test A", payload: { version: 1, tabs: [] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({ name: "Test A", kind: "manual" });
  });
});

describe("PATCH /:id", () => {
  it("rejects renaming the last_session row", async () => {
    const created = await invoke("put", "/last-session", {
      body: { payload: { version: 1, tabs: [] } },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    const res = await invoke("patch", "/:id", {
      params: { id: String(id) },
      body: { name: "Nope" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("renames a manual workspace", async () => {
    const created = await invoke("post", "/", {
      body: { name: "Old", payload: { version: 1, tabs: [] } },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    const res = await invoke("patch", "/:id", {
      params: { id: String(id) },
      body: { name: "New" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({ name: "New" });
  });

  it("404s for a nonexistent id", async () => {
    const res = await invoke("patch", "/:id", {
      params: { id: "999" },
      body: { name: "New" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("PUT /:id/content", () => {
  it("updates payload for a manual workspace", async () => {
    const created = await invoke("post", "/", {
      body: { name: "A", payload: { version: 1, tabs: [] } },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    const res = await invoke("put", "/:id/content", {
      params: { id: String(id) },
      body: { payload: { version: 1, tabs: [{ slotId: "x" }] } },
    });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({ tabCount: 1 });
  });

  it("404s on wrong owner", async () => {
    const created = await invoke("post", "/", {
      body: { name: "A", payload: { version: 1, tabs: [] } },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    state.currentUserId = "user-2";
    const res = await invoke("put", "/:id/content", {
      params: { id: String(id) },
      body: { payload: { version: 1, tabs: [] } },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /:id", () => {
  it("rejects deleting the last_session row", async () => {
    const created = await invoke("put", "/last-session", {
      body: { payload: { version: 1, tabs: [] } },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    const res = await invoke("delete", "/:id", { params: { id: String(id) } });
    expect(res.statusCode).toBe(404);
  });

  it("404s for a nonexistent id", async () => {
    const res = await invoke("delete", "/:id", { params: { id: "999" } });
    expect(res.statusCode).toBe(404);
  });

  it("deletes a manual workspace", async () => {
    const created = await invoke("post", "/", {
      body: { name: "A", payload: { version: 1, tabs: [] } },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    const res = await invoke("delete", "/:id", { params: { id: String(id) } });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toEqual({ success: true });
  });
});

describe("POST /:id/duplicate", () => {
  it("produces a second independent row", async () => {
    const created = await invoke("post", "/", {
      body: {
        name: "A",
        payload: { version: 1, tabs: [{ slotId: "a" }] },
      },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    const dup = await invoke("post", "/:id/duplicate", {
      params: { id: String(id) },
      body: { name: "A (copy)" },
    });
    expect(dup.statusCode).toBe(200);
    expect(dup.jsonBody).toMatchObject({ name: "A (copy)", tabCount: 1 });

    const updateOriginal = await invoke("put", "/:id/content", {
      params: { id: String(id) },
      body: { payload: { version: 1, tabs: [] } },
    });
    expect(updateOriginal.jsonBody).toMatchObject({ tabCount: 0 });

    const dupId = (dup.jsonBody as unknown as { id: number }).id;
    const refetched = await invoke("get", "/");
    const dupRow = (
      refetched.jsonBody as unknown as { id: number; tabCount: number }[]
    ).find((w) => w.id === dupId);
    expect(dupRow?.tabCount).toBe(1);
  });
});

describe("POST /:id/set-default", () => {
  it("clears a previous default and sets the new one", async () => {
    const a = await invoke("post", "/", {
      body: { name: "A", payload: { version: 1, tabs: [] } },
    });
    const b = await invoke("post", "/", {
      body: { name: "B", payload: { version: 1, tabs: [] } },
    });
    const aId = (a.jsonBody as unknown as { id: number }).id;
    const bId = (b.jsonBody as unknown as { id: number }).id;

    await invoke("post", "/:id/set-default", { params: { id: String(aId) } });
    const second = await invoke("post", "/:id/set-default", {
      params: { id: String(bId) },
    });
    expect(second.jsonBody).toMatchObject({ isDefault: true });

    const list = await invoke("get", "/");
    const aRow = (
      list.jsonBody as unknown as { id: number; isDefault: boolean }[]
    ).find((w) => w.id === aId);
    expect(aRow?.isDefault).toBe(false);
  });

  it("is idempotent when re-called on an already-default row", async () => {
    const a = await invoke("post", "/", {
      body: { name: "A", payload: { version: 1, tabs: [] } },
    });
    const aId = (a.jsonBody as unknown as { id: number }).id;

    await invoke("post", "/:id/set-default", { params: { id: String(aId) } });
    const again = await invoke("post", "/:id/set-default", {
      params: { id: String(aId) },
    });
    expect(again.statusCode).toBe(200);
    expect(again.jsonBody).toMatchObject({ isDefault: true });
  });
});

describe("POST /:id/unset-default", () => {
  it("clears isDefault on a manual workspace", async () => {
    const a = await invoke("post", "/", {
      body: { name: "A", payload: { version: 1, tabs: [] } },
    });
    const aId = (a.jsonBody as unknown as { id: number }).id;

    await invoke("post", "/:id/set-default", { params: { id: String(aId) } });
    const res = await invoke("post", "/:id/unset-default", {
      params: { id: String(aId) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({ isDefault: false });
  });

  it("rejects unsetting the last_session row", async () => {
    const created = await invoke("put", "/last-session", {
      body: { payload: { version: 1, tabs: [] } },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    const res = await invoke("post", "/:id/unset-default", {
      params: { id: String(id) },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /:id/apply", () => {
  it("touches lastUsedAt and returns the parsed payload", async () => {
    const created = await invoke("post", "/", {
      body: { name: "A", payload: { version: 1, tabs: [{ slotId: "a" }] } },
    });
    const id = (created.jsonBody as unknown as { id: number }).id;

    const res = await invoke("post", "/:id/apply", {
      params: { id: String(id) },
    });
    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({
      payload: { version: 1, tabs: [{ slotId: "a" }] },
    });
    expect(
      (res.jsonBody as unknown as { lastUsedAt: string | null }).lastUsedAt,
    ).toBeTruthy();
  });
});

describe("PUT /last-session and GET /last-session", () => {
  it("returns null before any save", async () => {
    const res = await invoke("get", "/last-session");
    expect(res.jsonBody).toBeNull();
  });

  it("upserts idempotently - two calls produce one row", async () => {
    await invoke("put", "/last-session", {
      body: { payload: { version: 1, tabs: [] } },
    });
    await invoke("put", "/last-session", {
      body: { payload: { version: 1, tabs: [{ slotId: "a" }] } },
    });

    const list = await invoke("get", "/");
    const lastSessionRows = (
      list.jsonBody as unknown as { kind: string }[]
    ).filter((w) => w.kind === "last_session");
    expect(lastSessionRows).toHaveLength(1);

    const res = await invoke("get", "/last-session");
    expect(res.jsonBody).toMatchObject({ tabCount: 1 });
  });
});
