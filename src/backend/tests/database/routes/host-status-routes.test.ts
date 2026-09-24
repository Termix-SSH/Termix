import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express, { type RequestHandler } from "express";

const state = vi.hoisted(() => ({
  settings: {} as Record<string, string>,
  locked: false,
  accessible: new Set<number>([1, 2]),
  statuses: new Map<number, { status: string; lastChecked: string }>(),
}));

const service = vi.hoisted(() => ({
  statusesFor: vi.fn(),
  get: vi.fn(),
  check: vi.fn(),
  refresh: vi.fn(),
  retimeAll: vi.fn(),
}));

vi.mock("../../../utils/logger.js", () => ({
  sshLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../utils/data-crypto.js", () => ({
  DataCrypto: { getUserDataKey: () => (state.locked ? null : "key") },
}));
vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      filterAccessibleHostIds: async (_user: string, ids: number[]) =>
        new Set(ids.filter((id) => state.accessible.has(id))),
      canAccessHost: async (_user: string, id: number) => ({
        hasAccess: state.accessible.has(id),
      }),
    }),
  },
}));
vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSettingsRepository: () => ({
    get: async (key: string) => state.settings[key] ?? null,
    set: async (key: string, value: string) => {
      state.settings[key] = value;
    },
  }),
}));
vi.mock("../../../hosts/status/host-status-service.js", () => ({
  DEFAULT_STATUS_INTERVAL: 60,
  GLOBAL_STATUS_INTERVAL_KEY: "global_status_check_interval",
  hostStatusService: service,
}));

const { registerHostStatusRoutes, parseStatusHostIds } =
  await import("../../../database/routes/host-status-routes.js");

let server: http.Server | null = null;
let base = "";

async function start(isAdmin = true) {
  const router = express.Router();
  const authenticateJWT: RequestHandler = (req, _res, next) => {
    (req as unknown as { userId: string }).userId = "user-1";
    next();
  };
  const requireAdmin: RequestHandler = (_req, res, next) =>
    isAdmin ? next() : void res.status(403).json({ error: "Admin only" });
  registerHostStatusRoutes(router, { authenticateJWT, requireAdmin });
  const app = express();
  app.use(express.json());
  app.use("/host", router);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

async function call(method: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

beforeEach(() => {
  state.settings = {};
  state.locked = false;
  state.accessible = new Set([1, 2]);
  state.statuses = new Map([
    [1, { status: "online", lastChecked: "t" }],
    [2, { status: "offline", lastChecked: "t" }],
    [3, { status: "reachable", lastChecked: "t" }],
  ]);
  service.statusesFor.mockImplementation(async () => state.statuses);
  service.get.mockImplementation(
    (id: number) => state.statuses.get(id) ?? null,
  );
  service.check.mockResolvedValue(null);
});

afterEach(async () => {
  if (server)
    await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = null;
  vi.clearAllMocks();
});

describe("GET /host/status", () => {
  it("only returns hosts the user can reach", async () => {
    await start();
    const { status, body } = await call("GET", "/host/status");
    expect(status).toBe(200);
    expect(Object.keys(body)).toEqual(["1", "2"]);
    expect(service.statusesFor).toHaveBeenCalledWith("user-1", null);
  });

  it("narrows to the requested hosts", async () => {
    await start();
    const { body } = await call("GET", "/host/status?hostIds=2");
    expect(Object.keys(body)).toEqual(["2"]);
    expect(service.statusesFor).toHaveBeenCalledWith("user-1", new Set([2]));
  });

  it("answers 401 while the user's data is locked", async () => {
    await start();
    state.locked = true;
    expect((await call("GET", "/host/status")).status).toBe(401);
  });
});

describe("GET /host/status/:id", () => {
  it("returns one host's status", async () => {
    await start();
    const { status, body } = await call("GET", "/host/status/1");
    expect(status).toBe(200);
    expect(body.status).toBe("online");
  });

  it("hides a host the user cannot reach", async () => {
    await start();
    expect((await call("GET", "/host/status/3")).status).toBe(404);
  });
});

describe("status settings", () => {
  it("reads the default interval", async () => {
    await start();
    expect((await call("GET", "/host/status/settings")).body).toEqual({
      statusCheckInterval: 60,
    });
  });

  it("saves a new interval and re-times the checks", async () => {
    await start();
    const { status } = await call("PUT", "/host/status/settings", {
      statusCheckInterval: 90,
    });
    expect(status).toBe(200);
    expect(state.settings.global_status_check_interval).toBe("90");
    expect(service.retimeAll).toHaveBeenCalledOnce();
  });

  it("rejects an interval out of range", async () => {
    await start();
    expect(
      (await call("PUT", "/host/status/settings", { statusCheckInterval: 1 }))
        .status,
    ).toBe(400);
  });

  it("is admin only", async () => {
    await start(false);
    expect((await call("GET", "/host/status/settings")).status).toBe(403);
    expect(
      (await call("PUT", "/host/status/settings", { statusCheckInterval: 90 }))
        .status,
    ).toBe(403);
  });
});

describe("POST /host/status/refresh", () => {
  it("restarts the user's checks", async () => {
    await start();
    expect((await call("POST", "/host/status/refresh")).status).toBe(200);
    expect(service.refresh).toHaveBeenCalledWith("user-1");
  });
});

describe("parseStatusHostIds", () => {
  it("tells an unrestricted request from an empty host set", () => {
    expect(parseStatusHostIds(undefined)).toBeNull();
    expect(parseStatusHostIds("")).toEqual(new Set());
  });

  it("keeps only valid positive host ids", () => {
    expect(parseStatusHostIds("7,2,7,-1,nope,1.5")).toEqual(new Set([7, 2]));
  });
});
