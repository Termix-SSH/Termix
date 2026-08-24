import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

type Room = {
  id: string;
  name: string;
  ownerUserId: string;
  persistent: boolean;
  presenterUserId: string | null;
  stageProtocol: string | null;
  stageHostId: number | null;
  stageShareId: string | null;
  guestLinkToken: string | null;
  createdAt: string;
  endedAt: string | null;
};

const state = vi.hoisted(() => ({
  currentUserId: "host-1",
  rooms: new Map<string, Room>(),
  members: new Map<
    string,
    { roomId: string; userId: string; roomRole: string }
  >(),
  shares: new Map<string, Record<string, unknown>>(),
  users: new Set<string>(["host-1", "alice", "bob"]),
  roles: new Map<number, string[]>([[7, ["alice", "carol"]]]),
  sharingEnabled: true,
  liveOwned: new Map<string, string>(), // sessionId -> owner
  broadcasts: [] as Array<Record<string, unknown>>,
  control: [] as Array<unknown[]>,
}));

vi.mock("../../../utils/logger.js", () => ({
  sshLogger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), success: vi.fn() },
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
vi.mock("../../../utils/audit-logger.js", () => ({
  logAudit: vi.fn(async () => undefined),
  getAuditUsername: vi.fn(async (id: string) => id.toUpperCase()),
  getRequestMeta: () => ({ ipAddress: "127.0.0.1", userAgent: "test" }),
}));
vi.mock("../../../hosts/guacamole/token-service.js", () => ({
  GuacamoleTokenService: {
    getInstance: () => ({
      createJoinToken: (id: string, readOnly: boolean) =>
        `join:${id}:${readOnly}`,
    }),
  },
}));
vi.mock("../../../hosts/collab/room-hub.js", () => ({
  collabRoomHub: {
    broadcast: (roomId: string, message: Record<string, unknown>) => {
      state.broadcasts.push({ roomId, ...message });
    },
    onlineUsers: () => [],
  },
}));
vi.mock("../../../hosts/terminal/session-manager.js", () => ({
  sessionManager: {
    setRoomShareControl: (...args: unknown[]) => {
      state.control.push(args);
    },
  },
}));
vi.mock("../../../hosts/session-sharing/live-sessions.js", () => ({
  isSharingEnabledForHost: async () => ({
    enabled: state.sharingEnabled,
    hostOwnerId: "host-1",
  }),
  isLiveSessionOwnedBy: (_p: string, sessionId: string, userId: string) =>
    state.liveOwned.get(sessionId) === userId,
  isLiveSession: (_p: string, sessionId: string) =>
    state.liveOwned.has(sessionId),
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentCollabRoomRepository: () => ({
    createRoom: async (
      input: Omit<
        Room,
        | "presenterUserId"
        | "stageProtocol"
        | "stageHostId"
        | "stageShareId"
        | "guestLinkToken"
        | "createdAt"
        | "endedAt"
      >,
    ) => {
      const room: Room = {
        ...input,
        presenterUserId: null,
        stageProtocol: null,
        stageHostId: null,
        stageShareId: null,
        guestLinkToken: null,
        createdAt: "2026-08-25T00:00:00.000Z",
        endedAt: null,
      };
      state.rooms.set(room.id, room);
      return room;
    },
    findById: async (id: string) => state.rooms.get(id) ?? null,
    findByGuestToken: async (token: string) =>
      [...state.rooms.values()].find(
        (r) => r.guestLinkToken === token && !r.endedAt,
      ) ?? null,
    setGuestToken: async (roomId: string, token: string | null) => {
      state.rooms.get(roomId)!.guestLinkToken = token;
    },
    listForUser: async (userId: string) =>
      [...state.members.values()]
        .filter((m) => m.userId === userId)
        .map((m) => state.rooms.get(m.roomId)!)
        .filter((r) => !r.endedAt),
    findMember: async (roomId: string, userId: string) =>
      state.members.get(`${roomId}:${userId}`) ?? null,
    addMember: async (input: {
      roomId: string;
      userId: string;
      roomRole: string;
    }) => {
      const key = `${input.roomId}:${input.userId}`;
      if (state.members.has(key)) return false;
      state.members.set(key, input);
      return true;
    },
    removeMember: async (roomId: string, userId: string) => {
      state.members.delete(`${roomId}:${userId}`);
    },
    listMembers: async (roomId: string) =>
      [...state.members.values()]
        .filter((m) => m.roomId === roomId)
        .map((m) => ({ ...m, username: m.userId, createdAt: "" })),
    updateStage: async (roomId: string, stage: Partial<Room>) => {
      Object.assign(state.rooms.get(roomId)!, stage);
    },
    clearStage: async (roomId: string) => {
      Object.assign(state.rooms.get(roomId)!, {
        presenterUserId: null,
        stageProtocol: null,
        stageHostId: null,
        stageShareId: null,
      });
    },
    endRoom: async (roomId: string) => {
      Object.assign(state.rooms.get(roomId)!, {
        endedAt: "2026-08-25T01:00:00.000Z",
        presenterUserId: null,
        stageProtocol: null,
        stageHostId: null,
        stageShareId: null,
      });
    },
  }),
  createCurrentSessionShareRepository: () => ({
    create: async (input: Record<string, unknown>) => {
      const row = { ...input, revokedAt: null };
      state.shares.set(input.id as string, row);
      return row;
    },
    findActiveById: async (id: string) => {
      const share = state.shares.get(id);
      return share && !share.revokedAt ? share : null;
    },
    revokeAsAdmin: async (id: string) => {
      const share = state.shares.get(id);
      if (!share) return false;
      share.revokedAt = "now";
      return true;
    },
  }),
  createCurrentUserRepository: () => ({
    findById: async (id: string) => (state.users.has(id) ? { id } : null),
  }),
  createCurrentRoleRepository: () => ({
    findRoleById: async (id: number) => (state.roles.has(id) ? { id } : null),
    listRoleUserIds: async (id: number) => state.roles.get(id) ?? [],
  }),
}));

const { default: router } = await import("../../../hosts/collab/routes.js");
const { getStageController } =
  await import("../../../hosts/collab/stage-control.js");

type RouteLayer = {
  route?: {
    path: string;
    methods: Record<string, boolean>;
    stack: {
      handle: (req: Request, res: Response, next: () => void) => unknown;
    }[];
  };
};

async function invoke(
  method: string,
  path: string,
  overrides: {
    body?: Record<string, unknown>;
    params?: Record<string, unknown>;
    ip?: string;
  } = {},
) {
  const layers = (router as unknown as { stack: RouteLayer[] }).stack;
  const layer = layers.find(
    (l) => l.route?.path === path && l.route.methods[method],
  );
  if (!layer?.route) throw new Error(`No route for ${method} ${path}`);
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
      this.statusCode = code;
      return this;
    },
    json(payload: unknown) {
      this.jsonBody = payload;
      return this;
    },
  };
  for (const handler of layer.route.stack) {
    let calledNext = false;
    await handler.handle(req, res as unknown as Response, () => {
      calledNext = true;
    });
    if (!calledNext) break;
  }
  return res as {
    statusCode: number;
    jsonBody: Record<string, unknown> | null;
  };
}

async function as(userId: string, run: () => Promise<unknown>) {
  const previous = state.currentUserId;
  state.currentUserId = userId;
  try {
    return await run();
  } finally {
    state.currentUserId = previous;
  }
}

async function createRoom(persistent = false): Promise<string> {
  const response = await invoke("post", "/rooms", {
    body: { name: "Standup", persistent },
  });
  return (response.jsonBody!.room as Room).id;
}

async function invite(roomId: string, userIds: string[]) {
  return invoke("post", "/rooms/:id/members", {
    params: { id: roomId },
    body: { userIds },
  });
}

async function present(roomId: string, sessionId: string, protocol = "ssh") {
  return invoke("post", "/rooms/:id/present", {
    params: { id: roomId },
    body: { protocol, sessionId, hostId: 1 },
  });
}

describe("collab room routes", () => {
  beforeEach(() => {
    state.currentUserId = "host-1";
    state.rooms.clear();
    state.members.clear();
    state.shares.clear();
    state.liveOwned.clear();
    state.broadcasts.length = 0;
    state.control.length = 0;
    state.sharingEnabled = true;
  });

  it("creating a room makes the creator its host and lists it for them only", async () => {
    const roomId = await createRoom();
    expect(state.members.get(`${roomId}:host-1`)?.roomRole).toBe("host");

    const mine = await invoke("get", "/rooms");
    expect((mine.jsonBody!.rooms as Room[]).map((r) => r.id)).toEqual([roomId]);

    const other = await as("alice", () =>
      invoke("get", "/rooms/:id", { params: { id: roomId } }),
    );
    expect((other as { statusCode: number }).statusCode).toBe(404);
  });

  it("rejects an empty or oversized room name", async () => {
    expect(
      (await invoke("post", "/rooms", { body: { name: "  " } })).statusCode,
    ).toBe(400);
    expect(
      (await invoke("post", "/rooms", { body: { name: "x".repeat(121) } }))
        .statusCode,
    ).toBe(400);
  });

  it("only the host invites; roles expand to their members; unknown users 404", async () => {
    const roomId = await createRoom();
    await invite(roomId, ["alice"]);
    const byMember = await as("alice", () => invite(roomId, ["bob"]));
    expect((byMember as { statusCode: number }).statusCode).toBe(403);

    expect((await invite(roomId, ["nobody"])).statusCode).toBe(404);
    expect(
      (
        await invoke("post", "/rooms/:id/members", {
          params: { id: roomId },
          body: {},
        })
      ).statusCode,
    ).toBe(400);

    const byRole = await invoke("post", "/rooms/:id/members", {
      params: { id: roomId },
      body: { roleIds: [7] },
    });
    expect(byRole.statusCode).toBe(200);
    expect(state.members.has(`${roomId}:carol`)).toBe(true);
    expect(state.broadcasts.at(-1)).toMatchObject({
      type: "collab_members_changed",
    });
  });

  it("members may leave, only the host removes others, the owner is never removed", async () => {
    const roomId = await createRoom();
    await invite(roomId, ["alice", "bob"]);

    const aliceRemovesBob = await as("alice", () =>
      invoke("delete", "/rooms/:id/members/:userId", {
        params: { id: roomId, userId: "bob" },
      }),
    );
    expect((aliceRemovesBob as { statusCode: number }).statusCode).toBe(403);

    await as("alice", () =>
      invoke("delete", "/rooms/:id/members/:userId", {
        params: { id: roomId, userId: "alice" },
      }),
    );
    expect(state.members.has(`${roomId}:alice`)).toBe(false);

    const removeOwner = await invoke("delete", "/rooms/:id/members/:userId", {
      params: { id: roomId, userId: "host-1" },
    });
    expect(removeOwner.statusCode).toBe(400);
  });

  it("presenting validates the protocol, the sharing toggle and live-session ownership", async () => {
    const roomId = await createRoom();
    expect((await present(roomId, "s1", "ftp")).statusCode).toBe(400);
    expect((await present(roomId, "s1")).statusCode).toBe(403); // not live

    state.liveOwned.set("s1", "host-1");
    state.sharingEnabled = false;
    expect((await present(roomId, "s1")).statusCode).toBe(403);
    state.sharingEnabled = true;

    const ok = await present(roomId, "s1");
    expect(ok.statusCode).toBe(200);
    const room = state.rooms.get(roomId)!;
    expect(room.presenterUserId).toBe("host-1");
    expect(state.shares.get(room.stageShareId!)).toMatchObject({
      shareType: "room",
      permissionLevel: "read-only",
      sessionId: "s1",
    });
    expect(state.broadcasts.at(-1)).toMatchObject({
      type: "collab_stage_changed",
    });
  });

  it("a takeover revokes the previous stage share and clears control", async () => {
    const roomId = await createRoom();
    await invite(roomId, ["alice"]);
    state.liveOwned.set("s1", "host-1");
    state.liveOwned.set("s2", "alice");
    await present(roomId, "s1");
    const firstShare = state.rooms.get(roomId)!.stageShareId!;
    await invoke("post", "/rooms/:id/control", {
      params: { id: roomId },
      body: { userId: "alice" },
    });
    expect(getStageController(roomId)).toBe("alice");

    await as("alice", () => present(roomId, "s2"));
    const room = state.rooms.get(roomId)!;
    expect(room.presenterUserId).toBe("alice");
    expect(state.shares.get(firstShare)!.revokedAt).toBeTruthy();
    expect(getStageController(roomId)).toBeNull();
  });

  it("stop is for the presenter or host", async () => {
    const roomId = await createRoom();
    await invite(roomId, ["alice", "bob"]);
    state.liveOwned.set("s2", "alice");
    await as("alice", () => present(roomId, "s2"));

    const bob = await as("bob", () =>
      invoke("post", "/rooms/:id/stop", { params: { id: roomId } }),
    );
    expect((bob as { statusCode: number }).statusCode).toBe(403);
    await invoke("post", "/rooms/:id/stop", { params: { id: roomId } }); // host
    expect(state.rooms.get(roomId)!.stageShareId).toBeNull();
  });

  it("resolves the stage per protocol and mints a writable guac token only for the controller", async () => {
    const roomId = await createRoom();
    await invite(roomId, ["alice"]);
    const stageOf = (user: string) =>
      as(user, () =>
        invoke("get", "/rooms/:id/stage", { params: { id: roomId } }),
      ) as Promise<{
        jsonBody: { stage: Record<string, unknown> | null };
      }>;

    expect((await stageOf("alice")).jsonBody.stage).toBeNull();

    state.liveOwned.set("s1", "host-1");
    await present(roomId, "s1");
    const ssh = (await stageOf("alice")).jsonBody.stage!;
    expect(ssh).toMatchObject({ protocol: "ssh", sessionId: "s1" });
    expect(ssh.connectParams).toBeUndefined();

    state.liveOwned.set("g1", "host-1");
    await present(roomId, "g1", "rdp");
    expect((await stageOf("alice")).jsonBody.stage!.connectParams).toEqual({
      token: "join:g1:true",
    });
    await invoke("post", "/rooms/:id/control", {
      params: { id: roomId },
      body: { userId: "alice" },
    });
    expect((await stageOf("alice")).jsonBody.stage!.connectParams).toEqual({
      token: "join:g1:false",
    });
  });

  it("a dead presenter session clears the stale stage on resolve", async () => {
    const roomId = await createRoom();
    await invite(roomId, ["alice"]);
    state.liveOwned.set("s1", "host-1");
    await present(roomId, "s1");
    state.liveOwned.delete("s1");

    const resolved = await as("alice", () =>
      invoke("get", "/rooms/:id/stage", { params: { id: roomId } }),
    );
    expect(
      (resolved as { jsonBody: { stage: unknown } }).jsonBody.stage,
    ).toBeNull();
    expect(state.rooms.get(roomId)!.stageShareId).toBeNull();
    expect(state.broadcasts.at(-1)).toMatchObject({
      type: "collab_stage_changed",
      stage: null,
    });
  });

  it("control: presenter/host grant, controller releases, members may only ask", async () => {
    const roomId = await createRoom();
    await invite(roomId, ["alice", "bob"]);
    const control = (user: string, target: string | null) =>
      as(user, () =>
        invoke("post", "/rooms/:id/control", {
          params: { id: roomId },
          body: { userId: target },
        }),
      ) as Promise<{ statusCode: number }>;

    expect((await control("host-1", "alice")).statusCode).toBe(400); // nothing presented

    state.liveOwned.set("s1", "host-1");
    await present(roomId, "s1");
    expect((await control("bob", "bob")).statusCode).toBe(403);
    expect((await control("host-1", "nobody")).statusCode).toBe(404);
    expect((await control("host-1", "alice")).statusCode).toBe(200);
    expect(state.control.at(-1)).toEqual([
      "s1",
      state.rooms.get(roomId)!.stageShareId,
      "alice",
    ]);
    expect(state.broadcasts.at(-1)).toMatchObject({
      type: "collab_control_changed",
      controllerUserId: "alice",
    });

    expect((await control("bob", null)).statusCode).toBe(403);
    expect((await control("alice", null)).statusCode).toBe(200);
    expect(getStageController(roomId)).toBeNull();

    const asked = await as("bob", () =>
      invoke("post", "/rooms/:id/control/request", { params: { id: roomId } }),
    );
    expect((asked as { statusCode: number }).statusCode).toBe(200);
    expect(state.broadcasts.at(-1)).toMatchObject({
      type: "collab_control_requested",
      userId: "bob",
      username: "BOB",
    });
  });

  it("guest link: host-only toggle, anonymous resolve follows the stage, rate limited", async () => {
    const roomId = await createRoom();
    await invite(roomId, ["alice"]);
    const toggle = (user: string, enabled: boolean) =>
      as(user, () =>
        invoke("post", "/rooms/:id/guest-link", {
          params: { id: roomId },
          body: { enabled },
        }),
      ) as Promise<{
        statusCode: number;
        jsonBody: { guestLinkToken: string | null };
      }>;

    expect((await toggle("alice", true)).statusCode).toBe(403);
    const { guestLinkToken } = (await toggle("host-1", true)).jsonBody;
    expect(guestLinkToken).toBeTruthy();

    const resolve = (token: string, ip = "9.9.9.9") =>
      invoke("get", "/guest/:token", { params: { token }, ip });
    expect((await resolve("nope")).statusCode).toBe(404);
    expect((await resolve(guestLinkToken!)).jsonBody).toEqual({
      roomName: "Standup",
      stage: null,
    });

    state.liveOwned.set("s1", "host-1");
    await present(roomId, "s1");
    expect((await resolve(guestLinkToken!)).jsonBody!.stage).toMatchObject({
      protocol: "ssh",
      wsPath: `/terminal/ws?roomGuestToken=${encodeURIComponent(guestLinkToken!)}`,
    });
    state.liveOwned.set("g1", "host-1");
    await present(roomId, "g1", "vnc");
    expect((await resolve(guestLinkToken!)).jsonBody!.stage).toMatchObject({
      protocol: "vnc",
      connectParams: { token: "join:g1:true" },
    });

    await toggle("host-1", false);
    expect((await resolve(guestLinkToken!)).statusCode).toBe(404);

    let last = 200;
    for (let i = 0; i < 61; i++) {
      last = (await resolve("x", "1.2.3.4")).statusCode;
    }
    expect(last).toBe(429);
  });

  it("ending a one-off room ends it; ending a persistent room only clears the stage", async () => {
    const oneOff = await createRoom(false);
    await invite(oneOff, ["alice"]);
    const byMember = await as("alice", () =>
      invoke("post", "/rooms/:id/end", { params: { id: oneOff } }),
    );
    expect((byMember as { statusCode: number }).statusCode).toBe(403);
    await invoke("post", "/rooms/:id/end", { params: { id: oneOff } });
    expect(state.rooms.get(oneOff)!.endedAt).toBeTruthy();
    expect(state.broadcasts.at(-1)).toMatchObject({
      type: "collab_room_ended",
    });

    const persistent = await createRoom(true);
    state.liveOwned.set("s1", "host-1");
    await present(persistent, "s1");
    await invoke("post", "/rooms/:id/end", { params: { id: persistent } });
    const room = state.rooms.get(persistent)!;
    expect(room.endedAt).toBeNull();
    expect(room.stageShareId).toBeNull();
  });
});
