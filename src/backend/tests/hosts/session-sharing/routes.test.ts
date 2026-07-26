import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

const state = vi.hoisted(() => ({
  currentUserId: "user-1",
  globalSharingEnabled: true,
  hosts: new Map<number, { userId: string; allowSessionSharing: boolean }>(),
  hostOwnerAccess: new Map<string, boolean>(), // `${userId}:${hostId}` -> hasAccess
  sshSessions: new Map<string, { userId: string; isConnected: boolean }>(),
  guacSessions: new Map<
    string,
    { ownerUserId: string; hostId: number; protocol: string }
  >(),
  shares: new Map<string, Record<string, unknown>>(),
  admins: new Set<string>(),
}));

vi.mock("../../../utils/logger.js", () => ({
  sshLogger: {
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
    }),
  },
}));

vi.mock("../../../utils/permission-manager.js", () => ({
  PermissionManager: {
    getInstance: () => ({
      canAccessHost: async (
        userId: string,
        hostId: number,
        _action: string,
      ) => ({
        hasAccess: state.hostOwnerAccess.get(`${userId}:${hostId}`) ?? false,
      }),
      isAdmin: async (userId: string) => state.admins.has(userId),
    }),
  },
}));

vi.mock("../../../hosts/terminal/session-manager.js", () => ({
  sessionManager: {
    getSession: (sessionId: string) => {
      const session = state.sshSessions.get(sessionId);
      if (!session) return null;
      return { ...session };
    },
    ownerEndSession: vi.fn(),
  },
}));

vi.mock("../../../hosts/guacamole/guacamole-server.js", () => ({
  getGuacSessionInfo: (guacamoleConnectionId: string) =>
    state.guacSessions.get(guacamoleConnectionId) ?? null,
}));

vi.mock("../../../hosts/guacamole/token-service.js", () => ({
  GuacamoleTokenService: {
    getInstance: () => ({
      createJoinToken: (guacamoleConnectionId: string, readOnly: boolean) =>
        `join-token:${guacamoleConnectionId}:${readOnly}`,
    }),
  },
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentSessionShareRepository: () => ({
    create: async (input: Record<string, unknown>) => {
      const row = {
        ...input,
        createdAt: "2026-07-20T00:00:00.000Z",
        revokedAt: null,
        lastJoinedAt: null,
        joinCount: 0,
      };
      state.shares.set(input.id as string, row);
      return row;
    },
    findById: async (id: string) => state.shares.get(id) ?? null,
    findByLinkToken: async (linkToken: string) => {
      for (const share of state.shares.values()) {
        if (
          share.linkToken === linkToken &&
          !share.revokedAt &&
          (share.expiresAt as string) > new Date().toISOString()
        ) {
          return share;
        }
      }
      return null;
    },
    findActiveSharesForHost: async (hostId: number, ownerUserId: string) => {
      return [...state.shares.values()].filter(
        (s) =>
          s.hostId === hostId && s.ownerUserId === ownerUserId && !s.revokedAt,
      );
    },
    revoke: async (shareId: string, requestingUserId: string) => {
      const share = state.shares.get(shareId);
      if (!share || share.ownerUserId !== requestingUserId) return false;
      share.revokedAt = "2026-07-20T01:00:00.000Z";
      return true;
    },
    revokeAsAdmin: async (shareId: string) => {
      const share = state.shares.get(shareId);
      if (!share) return false;
      share.revokedAt = "2026-07-20T01:00:00.000Z";
      return true;
    },
    touchShareUsage: async () => {},
    recordParticipantJoin: async () => ({ id: 1 }),
  }),
  createCurrentSettingsRepository: () => ({
    getBoolean: async () => state.globalSharingEnabled,
  }),
  createCurrentHostResolutionRepository: () => ({
    findHostOwnerId: async (hostId: number) =>
      state.hosts.get(hostId)?.userId ?? null,
    findHostById: async (hostId: number) => {
      const host = state.hosts.get(hostId);
      if (!host) return null;
      return { allowSessionSharing: host.allowSessionSharing };
    },
  }),
}));

const { default: router } =
  await import("../../../hosts/session-sharing/routes.js");

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: {
      handle: (req: Request, res: Response, next: () => void) => unknown;
    }[];
  };
};

function findHandlers(method: string, path: string) {
  const layers = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = layers.find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  if (!layer?.route) throw new Error(`No route for ${method} ${path}`);
  return layer.route.stack.map((s) => s.handle);
}

function makeReqRes(overrides: {
  body?: Record<string, unknown>;
  params?: Record<string, unknown>;
  ip?: string;
}) {
  const req = {
    body: overrides.body ?? {},
    params: overrides.params ?? {},
    headers: {},
    ip: overrides.ip ?? "127.0.0.1",
    socket: { remoteAddress: overrides.ip ?? "127.0.0.1" },
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
    ip?: string;
  } = {},
) {
  const handlers = findHandlers(method, path);
  const { req, res } = makeReqRes(overrides);

  for (const handler of handlers) {
    let calledNext = false;
    await handler(req, res, () => {
      calledNext = true;
    });
    if (!calledNext) break;
  }

  return res as unknown as {
    statusCode: number;
    jsonBody: Record<string, unknown> | null;
  };
}

beforeEach(() => {
  state.currentUserId = "user-1";
  state.globalSharingEnabled = true;
  state.hosts = new Map([
    [1, { userId: "user-1", allowSessionSharing: true }],
    [2, { userId: "user-1", allowSessionSharing: false }],
  ]);
  state.hostOwnerAccess = new Map([["user-2:1", true]]);
  state.sshSessions = new Map([
    ["session-1", { userId: "user-1", isConnected: true }],
  ]);
  state.guacSessions = new Map([
    ["guac-conn-1", { ownerUserId: "user-1", hostId: 1, protocol: "vnc" }],
  ]);
  state.shares = new Map();
  state.admins = new Set();
});

describe("POST /session-sharing/create", () => {
  it("rejects a caller who does not own the live session", async () => {
    state.currentUserId = "user-2";
    const res = await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "link",
        permissionLevel: "read-only",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody).toMatchObject({
      error: "You do not own this live session",
    });
  });

  it("creates a link share for the session owner", async () => {
    const res = await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "link",
        permissionLevel: "read-only",
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.jsonBody).toMatchObject({ shareId: expect.any(String) });
    expect((res.jsonBody as Record<string, unknown>).linkToken).toBeTruthy();
  });

  it("rejects a user share when the target lacks host access", async () => {
    const res = await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "user",
        targetUserId: "no-access-user",
        permissionLevel: "read-write",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody).toMatchObject({
      error: "Target user does not have access to this host",
    });
  });

  it("global kill switch overrides an enabled per-host toggle", async () => {
    state.globalSharingEnabled = false;
    const res = await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "link",
        permissionLevel: "read-only",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.jsonBody).toMatchObject({
      error: "Session sharing is disabled for this host",
    });
  });

  it("rejects when the per-host toggle is off even though global is on", async () => {
    const res = await invoke("post", "/create", {
      body: {
        hostId: 2,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "link",
        permissionLevel: "read-only",
      },
    });

    expect(res.statusCode).toBe(403);
  });
});

describe("GET /session-sharing/resolve/:linkToken", () => {
  async function createActiveLinkShare(
    overrides: Partial<Record<string, unknown>> = {},
  ) {
    await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "link",
        permissionLevel: "read-only",
        ...overrides,
      },
    });
    const [share] = [...state.shares.values()];
    return share as { linkToken: string; id: string };
  }

  it("never includes hostname, ip, username, or hostId in the response body", async () => {
    const share = await createActiveLinkShare();

    const res = await invoke("get", "/resolve/:linkToken", {
      params: { linkToken: share.linkToken },
    });

    expect(res.statusCode).toBe(200);
    const body = res.jsonBody as Record<string, unknown>;
    const serialized = JSON.stringify(body).toLowerCase();

    expect(body).not.toHaveProperty("hostname");
    expect(body).not.toHaveProperty("ip");
    expect(body).not.toHaveProperty("username");
    expect(body).not.toHaveProperty("hostId");
    expect(body).not.toHaveProperty("hostName");
    expect(serialized).not.toContain("10.0.0");
    expect(serialized).not.toContain("hostname");
    expect(serialized).not.toContain('"ip"');
    expect(serialized).not.toContain("username");
  });

  it("returns only protocol/permissionLevel/wsPath(/connectParams) for ssh", async () => {
    const share = await createActiveLinkShare();

    const res = await invoke("get", "/resolve/:linkToken", {
      params: { linkToken: share.linkToken },
    });

    expect(res.jsonBody).toEqual({
      protocol: "ssh",
      permissionLevel: "read-only",
      wsPath: `/terminal/ws?shareToken=${encodeURIComponent(share.linkToken)}`,
    });
  });

  it("mints a fresh join token for guac protocols", async () => {
    await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "guac-conn-1",
        protocol: "vnc",
        shareType: "link",
        permissionLevel: "read-only",
      },
    });
    const [share] = [...state.shares.values()] as {
      linkToken: string;
    }[];

    const res = await invoke("get", "/resolve/:linkToken", {
      params: { linkToken: share.linkToken },
    });

    expect(res.statusCode).toBe(200);
    expect((res.jsonBody as Record<string, unknown>).connectParams).toEqual({
      token: "join-token:guac-conn-1:true",
    });
  });

  it("rejects an unknown link token", async () => {
    const res = await invoke("get", "/resolve/:linkToken", {
      params: { linkToken: "does-not-exist" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects a revoked link token", async () => {
    const share = await createActiveLinkShare();
    await invoke("delete", "/:shareId", { params: { shareId: share.id } });

    const res = await invoke("get", "/resolve/:linkToken", {
      params: { linkToken: share.linkToken },
    });

    expect(res.statusCode).toBe(404);
  });

  it("rejects an expired link token", async () => {
    state.shares.set("share-expired", {
      id: "share-expired",
      hostId: 1,
      ownerUserId: "user-1",
      protocol: "ssh",
      sessionId: "session-1",
      shareType: "link",
      linkToken: "expired-token",
      permissionLevel: "read-only",
      expiresAt: "2000-01-01T00:00:00.000Z",
      revokedAt: null,
    });

    const res = await invoke("get", "/resolve/:linkToken", {
      params: { linkToken: "expired-token" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("re-checks the global kill switch at resolve time, not just at creation time", async () => {
    const share = await createActiveLinkShare();

    state.globalSharingEnabled = false;

    const res = await invoke("get", "/resolve/:linkToken", {
      params: { linkToken: share.linkToken },
    });

    expect(res.statusCode).toBe(404);
  });
});

describe("DELETE /session-sharing/:shareId", () => {
  it("allows the owner to revoke their own share", async () => {
    await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "link",
        permissionLevel: "read-only",
      },
    });
    const [share] = [...state.shares.values()] as { id: string }[];

    const res = await invoke("delete", "/:shareId", {
      params: { shareId: share.id },
    });

    expect(res.statusCode).toBe(200);
  });

  it("rejects a non-owner, non-admin caller", async () => {
    await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "link",
        permissionLevel: "read-only",
      },
    });
    const [share] = [...state.shares.values()] as { id: string }[];

    state.currentUserId = "user-2";
    const res = await invoke("delete", "/:shareId", {
      params: { shareId: share.id },
    });

    expect(res.statusCode).toBe(403);
  });

  it("allows an admin to revoke someone else's share", async () => {
    await invoke("post", "/create", {
      body: {
        hostId: 1,
        sessionId: "session-1",
        protocol: "ssh",
        shareType: "link",
        permissionLevel: "read-only",
      },
    });
    const [share] = [...state.shares.values()] as { id: string }[];

    state.currentUserId = "admin-1";
    state.admins.add("admin-1");
    const res = await invoke("delete", "/:shareId", {
      params: { shareId: share.id },
    });

    expect(res.statusCode).toBe(200);
  });
});
