import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function roomWithBob(s: TestServer, persistent = false) {
  const created = await s.request("POST", "/rooms", {
    body: { name: "Standup", persistent },
  });
  const roomId = created.body.room.id as string;
  await s.request("POST", `/rooms/${roomId}/members`, {
    body: { userIds: ["bob"] },
  });
  return roomId;
}

async function present(s: TestServer, roomId: string, user = "alice") {
  s.live.addSession(`sess-${user}`, user);
  return s.request("POST", `/rooms/${roomId}/present`, {
    user,
    body: { protocol: "ssh", sessionId: `sess-${user}`, hostId: 1 },
  });
}

describe("collab rooms", () => {
  it("creates a room with the creator as host and hides the guest token", async () => {
    server = await startServer();
    const res = await server.request("POST", "/rooms", {
      body: { name: " Standup " },
    });
    expect(res.status).toBe(200);
    expect(res.body.room).toMatchObject({
      name: "Standup",
      ownerUserId: "alice",
      guestLinkEnabled: false,
    });
    expect(res.body.room).not.toHaveProperty("guestLinkToken");

    const detail = await server.request("GET", `/rooms/${res.body.room.id}`);
    expect(detail.body.isHost).toBe(true);
    expect(detail.body.members).toEqual([
      expect.objectContaining({ userId: "alice", roomRole: "host" }),
    ]);
    expect(detail.body.eventsWsPath).toBe("/plugin-ws/ssh-terminal/terminal");
    expect(server.mock.audits.map((entry) => entry.action)).toContain(
      "collab_room_create",
    );
  });

  it("keeps rooms private to members and invites to the host", async () => {
    server = await startServer();
    const roomId = await roomWithBob(server);

    expect(
      (await server.request("GET", `/rooms/${roomId}`, { user: "carol" }))
        .status,
    ).toBe(404);
    expect(
      (
        await server.request("POST", `/rooms/${roomId}/members`, {
          user: "bob",
          body: { userIds: ["carol"] },
        })
      ).status,
    ).toBe(403);
    expect(
      (await server.request("GET", "/rooms", { user: "bob" })).body.rooms,
    ).toHaveLength(1);
  });

  it("expands a role invite to its current members", async () => {
    server = await startServer();
    server.db.sqlite.exec(
      "INSERT INTO roles (id, name) VALUES (5, 'ops'); INSERT INTO user_roles (user_id, role_id) VALUES ('carol', 5)",
    );
    const created = await server.request("POST", "/rooms", {
      body: { name: "Ops" },
    });
    const roomId = created.body.room.id;
    await server.request("POST", `/rooms/${roomId}/members`, {
      body: { roleIds: [5] },
    });
    expect(
      (await server.request("GET", `/rooms/${roomId}`, { user: "carol" }))
        .status,
    ).toBe(200);
    expect(
      (
        await server.request("POST", `/rooms/${roomId}/members`, {
          body: { roleIds: [99] },
        })
      ).status,
    ).toBe(404);
  });

  it("puts a member's live session on stage as a read-only room share", async () => {
    server = await startServer();
    const roomId = await roomWithBob(server);
    const res = await present(server, roomId, "bob");
    expect(res.status).toBe(200);

    const stage = await server.request("GET", `/rooms/${roomId}/stage`);
    expect(stage.body.stage).toMatchObject({
      presenterUserId: "bob",
      protocol: "ssh",
      sessionId: "sess-bob",
    });
    const row = server.db.sqlite
      .prepare(
        "SELECT share_type, permission_level FROM p_session_sharing_shares",
      )
      .get();
    expect(row).toEqual({ share_type: "room", permission_level: "read-only" });
  });

  it("refuses to present someone else's session", async () => {
    server = await startServer();
    const roomId = await roomWithBob(server);
    server.live.addSession("sess-alice", "alice");
    const res = await server.request("POST", `/rooms/${roomId}/present`, {
      user: "bob",
      body: { protocol: "ssh", sessionId: "sess-alice", hostId: 1 },
    });
    expect(res.status).toBe(403);
  });

  it("clears a stage whose session died", async () => {
    server = await startServer();
    const roomId = await roomWithBob(server);
    await present(server, roomId);
    server.live.sessions.delete("sess-alice");

    const stage = await server.request("GET", `/rooms/${roomId}/stage`, {
      user: "bob",
    });
    expect(stage.body.stage).toBeNull();
    const detail = await server.request("GET", `/rooms/${roomId}`);
    expect(detail.body.stage.shareId).toBeNull();
  });

  it("hands control only from the presenter or host, and only to members", async () => {
    server = await startServer();
    const roomId = await roomWithBob(server);
    await present(server, roomId);

    expect(
      (
        await server.request("POST", `/rooms/${roomId}/control`, {
          user: "bob",
          body: { userId: "bob" },
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await server.request("POST", `/rooms/${roomId}/control`, {
          body: { userId: "carol" },
        })
      ).status,
    ).toBe(404);

    const granted = await server.request("POST", `/rooms/${roomId}/control`, {
      body: { userId: "bob" },
    });
    expect(granted.body).toEqual({ controllerUserId: "bob" });
    expect(server.live.calls).toContainEqual([
      "setRoomShareControl",
      "sess-alice",
      expect.any(String),
      "bob",
    ]);

    // The controller may give it back.
    expect(
      (
        await server.request("POST", `/rooms/${roomId}/control`, {
          user: "bob",
          body: { userId: null },
        })
      ).status,
    ).toBe(200);
  });

  it("rate limits hand raises", async () => {
    server = await startServer();
    const roomId = await roomWithBob(server);
    await present(server, roomId);

    const first = await server.request(
      "POST",
      `/rooms/${roomId}/control/request`,
      { user: "bob" },
    );
    expect(first.body.request).toMatchObject({
      userId: "bob",
      username: "bob",
    });
    expect(
      (
        await server.request("POST", `/rooms/${roomId}/control/request`, {
          user: "bob",
        })
      ).status,
    ).toBe(429);
    expect(
      (
        await server.request("GET", `/rooms/${roomId}/control/requests`, {
          user: "bob",
        })
      ).status,
    ).toBe(403);
    expect(
      (await server.request("GET", `/rooms/${roomId}/control/requests`)).body
        .requests,
    ).toHaveLength(1);
  });

  it("removes a member and drops them from the stage", async () => {
    server = await startServer();
    const roomId = await roomWithBob(server);
    await present(server, roomId);

    expect(
      (await server.request("DELETE", `/rooms/${roomId}/members/alice`)).status,
    ).toBe(400);
    expect(
      (await server.request("DELETE", `/rooms/${roomId}/members/bob`)).status,
    ).toBe(200);
    expect(server.live.calls).toContainEqual([
      "disconnectParticipants",
      "sess-alice",
      expect.any(String),
      {
        userId: "bob",
        reason: "You were removed from the collaboration room",
      },
    ]);
  });

  it("ends a one-off room for good and keeps a persistent one", async () => {
    server = await startServer();
    const oneOff = await roomWithBob(server);
    await present(server, oneOff);
    expect(
      (await server.request("POST", `/rooms/${oneOff}/end`, { user: "bob" }))
        .status,
    ).toBe(403);
    await server.request("POST", `/rooms/${oneOff}/end`);
    expect((await server.request("GET", `/rooms/${oneOff}`)).status).toBe(404);

    const persistent = await roomWithBob(server, true);
    await server.request("POST", `/rooms/${persistent}/end`);
    expect((await server.request("GET", `/rooms/${persistent}`)).status).toBe(
      200,
    );
  });

  it("deletes a room and its members", async () => {
    server = await startServer();
    const roomId = await roomWithBob(server);
    expect((await server.request("DELETE", `/rooms/${roomId}`)).status).toBe(
      200,
    );
    expect(
      server.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM p_session_sharing_room_members")
        .get(),
    ).toEqual({ n: 0 });
  });
});
