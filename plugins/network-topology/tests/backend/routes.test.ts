import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, Router } from "express";

const state = vi.hoisted(() => ({
  currentUserId: "user-1" as string | undefined,
  records: new Map<string, { userId: string; topology: string | null }>(),
}));

vi.mock("../../../../src/backend/database/db/index.js", () => ({ db: {} }));

vi.mock("../../../../src/backend/utils/logger.js", () => ({
  databaseLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
}));

vi.mock("../../../../src/backend/utils/auth-manager.js", () => ({
  AuthManager: {
    getInstance: () => ({
      createAuthMiddleware:
        () =>
        (req: Record<string, unknown>, _res: unknown, next: () => void) => {
          req.userId = state.currentUserId;
          next();
        },
    }),
  },
}));

vi.mock("../../../../src/backend/database/repositories/factory.js", () => ({
  createCurrentNetworkTopologyRepository: () => ({
    findByUserId: async (userId: string) => state.records.get(userId) ?? null,
    upsertForUser: async (userId: string, topology: string) => {
      state.records.set(userId, { userId, topology });
    },
  }),
}));

vi.mock(
  "../../../../src/backend/database/routes/network-topology-dispatch.js",
  () => ({
    registerNetworkTopologyRouter: vi.fn(),
    unregisterNetworkTopologyRouter: vi.fn(),
  }),
);

const { router } = await import("../../src/backend/routes.js");

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

function makeReqRes(overrides: { body?: Record<string, unknown> }) {
  const req = {
    userId: state.currentUserId,
    body: overrides.body ?? {},
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
  overrides: { body?: Record<string, unknown> } = {},
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
  state.records = new Map();
});

describe("GET /network-topology", () => {
  it("returns null when the user has no saved topology", async () => {
    const res = await invoke("get", "/");
    expect(res.jsonBody).toBeNull();
  });

  it("returns the parsed topology when one exists", async () => {
    state.records.set("user-1", {
      userId: "user-1",
      topology: JSON.stringify({ nodes: [{ id: "host-1" }], edges: [] }),
    });

    const res = await invoke("get", "/");
    expect(res.jsonBody).toEqual({ nodes: [{ id: "host-1" }], edges: [] });
  });

  it("rejects an unauthenticated request", async () => {
    state.currentUserId = undefined;
    const res = await invoke("get", "/");
    expect(res.statusCode).toBe(401);
  });
});

describe("POST /network-topology", () => {
  it("saves the topology and returns success", async () => {
    const res = await invoke("post", "/", {
      body: { topology: { nodes: [], edges: [] } },
    });

    expect(res.jsonBody).toEqual({ success: true });
    expect(state.records.get("user-1")?.topology).toBe(
      JSON.stringify({ nodes: [], edges: [] }),
    );
  });

  it("rejects a request with no topology", async () => {
    const res = await invoke("post", "/", { body: {} });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an unauthenticated request", async () => {
    state.currentUserId = undefined;
    const res = await invoke("post", "/", { body: { topology: {} } });
    expect(res.statusCode).toBe(401);
  });
});
