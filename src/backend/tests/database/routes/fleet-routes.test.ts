import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response, Router } from "express";

const state = vi.hoisted(() => ({
  currentUserId: "user-1",
  fleets: new Map<number, { id: number; userId: string; name: string }>(),
  members: new Map<number, { id: number; name: string }[]>(),
  hostAccess: new Map<string, { hasAccess: boolean; isOwner: boolean }>(),
  hosts: new Map<number, Record<string, unknown>>(),
}));

vi.mock("../../../database/db/index.js", () => ({ db: {} }));

vi.mock("../../../utils/logger.js", () => ({
  authLogger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
  },
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

vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async (userId: string, hostId: number, level: string) => {
        const key = `${userId}:${hostId}:${level}`;
        const found = state.hostAccess.get(key);
        if (found) return found;
        // default: full access unless a test explicitly denies it
        return { hasAccess: true, isOwner: true, permissionLevel: "manage" };
      },
    }),
  },
}));

vi.mock("../../../hosts/host-resolver.js", () => ({
  resolveHostById: async (hostId: number) => state.hosts.get(hostId) ?? null,
}));

vi.mock("../../../hosts/ssh-client-factory.js", () => ({
  getFleetPoolKey: () => "pool-key",
  createFleetSshFactory: () => async () => ({}),
}));

vi.mock("../../../hosts/ssh-connection-pool.js", () => ({
  withConnection: async (
    _key: string,
    _factory: unknown,
    fn: (client: unknown) => unknown,
  ) => fn({}),
}));

vi.mock("../../../hosts/metrics/widgets/common-utils.js", () => ({
  execCommand: vi.fn(async () => ({ stdout: "ok", stderr: "", code: 0 })),
}));

vi.mock("../../../hosts/metrics/managers/platform.js", () => ({
  detectPlatform: vi.fn(async () => ({ pkg: "apt", osPrettyName: "Debian" })),
}));

vi.mock("../../../hosts/metrics/managers/exec-elevated.js", async () => {
  class ElevationError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    execElevated: vi.fn(),
    ElevationError,
  };
});

vi.mock("../../../hosts/metrics/managers/packages.js", () => ({
  buildPackageActionCommand: vi.fn(() => "apt-get install -y foo"),
}));

vi.mock("../../../hosts/metrics/managers/validation.js", () => ({
  isValidPackageName: (v: unknown) => typeof v === "string" && v.length > 0,
}));

vi.mock("../../../database/routes/snippets-execution.js", () => ({
  resolveSnippetCommand: (command: string) => command,
}));

vi.mock("../../../database/routes/rbac.js", () => ({
  isSharePermissionLevel: (v: unknown) =>
    ["connect", "view", "edit", "manage"].includes(v as string),
  expiryFromDuration: () => null,
  parseShareTargets: () => null,
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentFleetRepository: () => ({
    findById: async (userId: string, fleetId: number) => {
      const fleet = state.fleets.get(fleetId);
      return fleet && fleet.userId === userId ? fleet : null;
    },
    listEffectiveMembers: async (_userId: string, fleetId: number) =>
      state.members.get(fleetId) ?? [],
    listStaticMemberIds: async () => [],
    listByUser: async (userId: string) =>
      [...state.fleets.values()].filter((f) => f.userId === userId),
  }),
  createCurrentFleetInventoryRepository: () => ({
    listForHosts: async () => [],
    upsert: async () => ({}),
  }),
  createCurrentRbacAccessRepository: () => ({}),
  createCurrentRoleRepository: () => ({}),
  createCurrentUserRepository: () => ({}),
}));

const {
  default: router,
  parseInventoryProbe,
  buildRemoveCommand,
} = await import("../../../database/routes/fleet-routes.js");

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
  state.fleets = new Map([[1, { id: 1, userId: "user-1", name: "web fleet" }]]);
  state.members = new Map([
    [
      1,
      [
        { id: 10, name: "host-a" },
        { id: 11, name: "host-b" },
      ],
    ],
  ]);
  state.hostAccess = new Map();
  state.hosts = new Map([
    [
      10,
      {
        id: 10,
        userId: "user-1",
        name: "host-a",
        ip: "10.0.0.1",
        port: 22,
        username: "root",
        sudoPassword: "secret",
      },
    ],
    [
      11,
      {
        id: 11,
        userId: "user-1",
        name: "host-b",
        ip: "10.0.0.2",
        port: 22,
        username: "root",
        sudoPassword: "secret",
      },
    ],
  ]);
});

describe("GET /:id/members", () => {
  it("404s for a fleet the caller does not own", async () => {
    const res = await invoke("get", "/:id/members", {
      params: { id: "999" },
    });
    expect(res.statusCode).toBe(404);
  });

  it("400s on a non-numeric fleet id", async () => {
    const res = await invoke("get", "/:id/members", {
      params: { id: "not-a-number" },
    });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /:id/execute", () => {
  it("400s when command is missing", async () => {
    const res = await invoke("post", "/:id/execute", {
      params: { id: "1" },
      body: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it("reports per-host success with the {hostId, hostName, success} shape", async () => {
    const res = await invoke("post", "/:id/execute", {
      params: { id: "1" },
      body: { command: "uptime" },
    });
    expect(res.statusCode).toBe(200);
    const results = res.jsonBody?.results as Array<Record<string, unknown>>;
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      hostId: 10,
      hostName: "host-a",
      success: true,
    });
  });

  it("isolates one host's access denial - the other host still succeeds", async () => {
    state.hostAccess.set("user-1:10:edit", {
      hasAccess: false,
      isOwner: false,
    });

    const res = await invoke("post", "/:id/execute", {
      params: { id: "1" },
      body: { command: "uptime" },
    });

    const results = res.jsonBody?.results as Array<Record<string, unknown>>;
    const denied = results.find((r) => r.hostId === 10);
    const allowed = results.find((r) => r.hostId === 11);
    expect(denied).toMatchObject({ success: false });
    expect(String(denied?.error)).toMatch(/edit/);
    expect(allowed).toMatchObject({ success: true });
  });

  it("404s for a fleet the caller does not own", async () => {
    const res = await invoke("post", "/:id/execute", {
      params: { id: "999" },
      body: { command: "uptime" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("POST /:id/packages", () => {
  it("400s on an invalid action", async () => {
    const res = await invoke("post", "/:id/packages", {
      params: { id: "1" },
      body: { action: "reformat-disk" },
    });
    expect(res.statusCode).toBe(400);
  });

  it("surfaces an ElevationError as a per-host error, not a request failure", async () => {
    const { execElevated, ElevationError } =
      await import("../../../hosts/metrics/managers/exec-elevated.js");
    (execElevated as ReturnType<typeof vi.fn>).mockRejectedValue(
      new ElevationError("SUDO_REQUIRED", "sudo password required"),
    );

    const res = await invoke("post", "/:id/packages", {
      params: { id: "1" },
      body: { action: "install", package: "curl" },
    });

    expect(res.statusCode).toBe(200);
    const results = res.jsonBody?.results as Array<Record<string, unknown>>;
    expect(results.every((r) => r.success === false)).toBe(true);
    expect(results[0].error).toMatch(/sudo password required/);
  });

  it("requires manage-level access, not just edit", async () => {
    state.hostAccess.set("user-1:10:manage", {
      hasAccess: false,
      isOwner: false,
    });
    state.hostAccess.set("user-1:11:manage", {
      hasAccess: false,
      isOwner: false,
    });

    const { execElevated } =
      await import("../../../hosts/metrics/managers/exec-elevated.js");
    (execElevated as ReturnType<typeof vi.fn>).mockResolvedValue({
      code: 0,
      stdout: "done",
      stderr: "",
    });

    const res = await invoke("post", "/:id/packages", {
      params: { id: "1" },
      body: { action: "upgrade-all" },
    });

    const results = res.jsonBody?.results as Array<Record<string, unknown>>;
    expect(results.every((r) => r.success === false)).toBe(true);
    expect(String(results[0].error)).toMatch(/manage/);
  });
});

describe("POST /:id/members", () => {
  it("404s when the caller cannot access the target host", async () => {
    state.hostAccess.set("user-1:99:connect", {
      hasAccess: false,
      isOwner: false,
    });

    const res = await invoke("post", "/:id/members", {
      params: { id: "1" },
      body: { hostId: 99 },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("parseInventoryProbe", () => {
  it("extracts kernel, arch, hostname, and uptime from key=value lines", () => {
    const out = [
      "kernel=6.1.0-generic",
      "arch=x86_64",
      "hostname=web-1",
      "uptime_seconds=123456",
    ].join("\n");

    expect(parseInventoryProbe(out)).toEqual({
      kernel: "6.1.0-generic",
      architecture: "x86_64",
      hostname: "web-1",
      uptimeSeconds: 123456,
    });
  });

  it("nulls out fields missing from the probe output", () => {
    expect(parseInventoryProbe("kernel=6.1.0")).toEqual({
      kernel: "6.1.0",
      architecture: null,
      hostname: null,
      uptimeSeconds: null,
    });
  });

  it("nulls uptimeSeconds when the value is not a bare integer", () => {
    const out = "uptime_seconds=";
    expect(parseInventoryProbe(out).uptimeSeconds).toBeNull();
  });

  it("ignores lines with no '=' separator", () => {
    const out = ["garbage line", "kernel=6.1.0"].join("\n");
    expect(parseInventoryProbe(out).kernel).toBe("6.1.0");
  });
});

describe("buildRemoveCommand", () => {
  it("builds the correct remove command per package manager", () => {
    expect(buildRemoveCommand("apt", "curl")).toContain(
      "apt-get -y remove curl",
    );
    expect(buildRemoveCommand("dnf", "curl")).toBe("dnf -y remove curl");
    expect(buildRemoveCommand("yum", "curl")).toBe("yum -y remove curl");
    expect(buildRemoveCommand("pacman", "curl")).toBe(
      "pacman -R --noconfirm curl",
    );
  });

  it("returns null when no package manager was detected", () => {
    expect(buildRemoveCommand(null, "curl")).toBeNull();
  });
});
