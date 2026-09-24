/**
 * Guest tokens, participant permissions and expiry. These are what keep a
 * share link from becoming a way into someone else's session, so each rule
 * the old core code enforced has a test here.
 */

import { afterEach, describe, expect, it } from "vitest";
import { asUser, expireShare, startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

async function createShare(
  s: TestServer,
  body: Record<string, unknown> = {},
): Promise<{ shareId: string; linkToken: string | null }> {
  if (!s.live.sessions.has("sess-1")) s.live.addSession("sess-1", "alice");
  const res = await s.request("POST", "/create", {
    body: {
      hostId: 1,
      sessionId: "sess-1",
      protocol: "ssh",
      shareType: "link",
      permissionLevel: "read-only",
      ...body,
    },
  });
  expect(res.status).toBe(200);
  return res.body;
}

async function roomOnStage(s: TestServer) {
  const created = await s.request("POST", "/rooms", { body: { name: "R" } });
  const roomId = created.body.room.id as string;
  await s.request("POST", `/rooms/${roomId}/members`, {
    body: { userIds: ["bob"] },
  });
  s.live.addSession("sess-stage", "alice");
  await s.request("POST", `/rooms/${roomId}/present`, {
    body: { protocol: "ssh", sessionId: "sess-stage", hostId: 1 },
  });
  const link = await s.request("POST", `/rooms/${roomId}/guest-link`, {
    body: { enabled: true },
  });
  return { roomId, token: link.body.guestLinkToken as string };
}

describe("share link guests", () => {
  it("resolves a live link without any host details", async () => {
    server = await startServer();
    const { linkToken } = await createShare(server, {
      permissionLevel: "read-write",
    });

    const res = await server.request("GET", `/resolve/${linkToken}`, {
      user: null,
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      protocol: "ssh",
      permissionLevel: "read-write",
      wsPath: `/plugin-ws/ssh-terminal/terminal?shareToken=${linkToken}`,
    });

    const joined = await server.guests.resolve({
      shareToken: linkToken!,
      clientIp: "1.1.1.1",
    });
    expect(joined).toEqual({
      ok: true,
      share: expect.objectContaining({
        sessionId: "sess-1",
        permissionLevel: "read-write",
      }),
    });
  });

  it("keeps a read-only link read-only", async () => {
    server = await startServer();
    const { linkToken } = await createShare(server);
    const joined = await server.guests.resolve({
      shareToken: linkToken!,
      clientIp: "1.1.1.1",
    });
    expect(joined).toMatchObject({ share: { permissionLevel: "read-only" } });
  });

  it("refuses an unknown or guessed token", async () => {
    server = await startServer();
    await createShare(server);
    for (const token of ["nope", "", "%00"]) {
      const res = await server.request("GET", `/resolve/${token || "x"}`, {
        user: null,
      });
      expect(res.status).toBe(404);
      expect(
        await server.guests.resolve({ shareToken: token, clientIp: "1.1.1.1" }),
      ).toMatchObject({ ok: false });
    }
  });

  it("refuses a revoked link", async () => {
    server = await startServer();
    const { shareId, linkToken } = await createShare(server);
    await server.request("DELETE", `/${shareId}`);

    expect(
      (await server.request("GET", `/resolve/${linkToken}`, { user: null }))
        .status,
    ).toBe(404);
    expect(
      await server.guests.resolve({
        shareToken: linkToken!,
        clientIp: "1.1.1.1",
      }),
    ).toEqual({ ok: false, reason: "Invalid or expired share link" });
  });

  it("refuses a link once sharing is switched off", async () => {
    server = await startServer();
    const { linkToken } = await createShare(server);
    await server.mock.ctx.settings.set("globallyEnabled", false);

    expect(
      (await server.request("GET", `/resolve/${linkToken}`, { user: null }))
        .status,
    ).toBe(404);
    expect(
      await server.guests.resolve({
        shareToken: linkToken!,
        clientIp: "1.1.1.1",
      }),
    ).toMatchObject({ ok: false });
  });

  it("answers 404 once the session is gone", async () => {
    server = await startServer();
    const { linkToken } = await createShare(server);
    server.live.sessions.delete("sess-1");
    const res = await server.request("GET", `/resolve/${linkToken}`, {
      user: null,
    });
    expect(res.status).toBe(404);
  });

  it("rate limits resolves per IP", async () => {
    server = await startServer();
    let last = 0;
    for (let i = 0; i < 31; i++) {
      last = (await server.request("GET", "/resolve/guess", { user: null }))
        .status;
    }
    expect(last).toBe(429);
  });

  it("records a guest join against the share", async () => {
    server = await startServer();
    const { shareId } = await createShare(server);
    await server.guests.recordJoin(shareId);
    expect(
      server.db.sqlite
        .prepare(
          "SELECT join_count, (SELECT guest_label FROM p_session_sharing_share_participants) AS label FROM p_session_sharing_shares",
        )
        .get(),
    ).toEqual({ join_count: 1, label: "Guest" });
  });
});

describe("expired shares", () => {
  it("stops resolving a link once it expires", async () => {
    server = await startServer();
    const { shareId, linkToken } = await createShare(server);
    expireShare(server, shareId);

    expect(
      (await server.request("GET", `/resolve/${linkToken}`, { user: null }))
        .status,
    ).toBe(404);
    expect(
      await server.guests.resolve({
        shareToken: linkToken!,
        clientIp: "1.1.1.1",
      }),
    ).toMatchObject({ ok: false });
    expect((await server.request("GET", "/host/1/active")).body.shares).toEqual(
      [],
    );
  });

  it("refuses a member join on an expired user share", async () => {
    server = await startServer();
    const { shareId } = await createShare(server, {
      shareType: "user",
      targetUserId: "bob",
    });
    expireShare(server, shareId);
    expect(
      await asUser(server, "bob", () => server!.sharing.authorizeJoin(shareId)),
    ).toBeNull();
  });

  it("clears a room stage whose share expired and stops guests", async () => {
    server = await startServer();
    const { roomId, token } = await roomOnStage(server);
    const shareId = (await server.request("GET", `/rooms/${roomId}`)).body.stage
      .shareId;
    expireShare(server, shareId);

    const guest = await server.request("GET", `/guest/${token}`, {
      user: null,
    });
    expect(guest.body).toEqual({ roomName: "R", stage: null });
    expect(
      await server.guests.resolve({
        roomGuestToken: token,
        clientIp: "1.1.1.1",
      }),
    ).toEqual({ ok: false, reason: "Nothing is being presented" });
    expect(
      (await server.request("GET", `/rooms/${roomId}/stage`)).body.stage,
    ).toBeNull();
  });
});

describe("member joins", () => {
  it("lets only the target of a user share join", async () => {
    server = await startServer();
    const { shareId } = await createShare(server, {
      shareType: "user",
      targetUserId: "bob",
      permissionLevel: "read-write",
    });

    expect(
      await asUser(server, "bob", () => server!.sharing.authorizeJoin(shareId)),
    ).toEqual({
      share: {
        id: shareId,
        sessionId: "sess-1",
        permissionLevel: "read-write",
      },
      displayName: "bob",
    });
    expect(
      await asUser(server, "carol", () =>
        server!.sharing.authorizeJoin(shareId),
      ),
    ).toBeNull();
  });

  it("refuses the target once they lose access to the host", async () => {
    server = await startServer({ accessibleHostIds: [2] });
    server.live.addSession("sess-1", "alice", 1);
    // Inserted directly: bob could reach host 1 when it was shared with him.
    server.db.sqlite
      .prepare(
        "INSERT INTO p_session_sharing_shares (id, host_id, owner_user_id, protocol, session_id, share_type, target_user_id, expires_at) VALUES ('s', 1, 'alice', 'ssh', 'sess-1', 'user', 'bob', ?)",
      )
      .run(new Date(Date.now() + 60_000).toISOString());

    expect(
      await asUser(server, "bob", () => server!.sharing.authorizeJoin("s")),
    ).toBeNull();
  });

  it("refuses a link share joined as a member, and no user at all", async () => {
    server = await startServer();
    const { shareId } = await createShare(server);
    expect(
      await asUser(server, "bob", () => server!.sharing.authorizeJoin(shareId)),
    ).toBeNull();
    expect(await server.sharing.authorizeJoin(shareId)).toBeNull();
  });

  it("lets room members, and only them, join a room stage read-only", async () => {
    server = await startServer();
    const { roomId } = await roomOnStage(server);
    const shareId = (await server.request("GET", `/rooms/${roomId}`)).body.stage
      .shareId;

    expect(
      await asUser(server, "bob", () => server!.sharing.authorizeJoin(shareId)),
    ).toMatchObject({ share: { permissionLevel: "read-only" } });
    expect(
      await asUser(server, "carol", () =>
        server!.sharing.authorizeJoin(shareId),
      ),
    ).toBeNull();
  });

  it("subscribes only members to room events", async () => {
    server = await startServer();
    const { roomId } = await roomOnStage(server);
    const socket = { readyState: 1, OPEN: 1, send: () => {} };
    expect(
      await asUser(server, "carol", () =>
        server!.sharing.subscribeRoom(roomId, socket),
      ),
    ).toBe(false);
    expect(
      await asUser(server, "bob", () =>
        server!.sharing.subscribeRoom(roomId, socket),
      ),
    ).toBe(true);
    await server.sharing.unsubscribeRoom(socket);
  });
});

describe("room guest links", () => {
  it("resolves the stage for a guest without host details", async () => {
    server = await startServer();
    const { token } = await roomOnStage(server);

    const res = await server.request("GET", `/guest/${token}`, { user: null });
    expect(res.body).toEqual({
      roomName: "R",
      stage: {
        protocol: "ssh",
        shareId: expect.any(String),
        wsPath: `/plugin-ws/ssh-terminal/terminal?roomGuestToken=${token}`,
      },
    });
    expect(
      await server.guests.resolve({
        roomGuestToken: token,
        clientIp: "1.1.1.1",
      }),
    ).toMatchObject({ ok: true, share: { permissionLevel: "read-only" } });
  });

  it("refuses the old token after a rotate and any token after disable", async () => {
    server = await startServer();
    const { roomId, token } = await roomOnStage(server);

    const rotated = await server.request(
      "POST",
      `/rooms/${roomId}/guest-link`,
      {
        body: { enabled: true },
      },
    );
    expect(
      (await server.request("GET", `/guest/${token}`, { user: null })).status,
    ).toBe(404);
    expect(
      await server.guests.resolve({
        roomGuestToken: token,
        clientIp: "1.1.1.1",
      }),
    ).toMatchObject({ ok: false });
    expect(server.live.calls).toContainEqual([
      "disconnectParticipants",
      "sess-stage",
      expect.any(String),
      { userId: null, reason: "The guest link was rotated" },
    ]);

    await server.request("POST", `/rooms/${roomId}/guest-link`, {
      body: { enabled: false },
    });
    expect(
      (
        await server.request("GET", `/guest/${rotated.body.guestLinkToken}`, {
          user: null,
        })
      ).status,
    ).toBe(404);
  });

  it("refuses a guest link after the room ends", async () => {
    server = await startServer();
    const { roomId, token } = await roomOnStage(server);
    await server.request("POST", `/rooms/${roomId}/end`);
    expect(
      (await server.request("GET", `/guest/${token}`, { user: null })).status,
    ).toBe(404);
  });

  it("does not accept a room guest token as a share link, or the reverse", async () => {
    server = await startServer();
    const { token } = await roomOnStage(server);
    const { linkToken } = await createShare(server);

    expect(
      await server.guests.resolve({ shareToken: token, clientIp: "1.1.1.1" }),
    ).toMatchObject({ ok: false });
    expect(
      (await server.request("GET", `/guest/${linkToken}`, { user: null }))
        .status,
    ).toBe(404);
  });

  it("only lets the host manage the guest link", async () => {
    server = await startServer();
    const { roomId } = await roomOnStage(server);
    expect(
      (
        await server.request("POST", `/rooms/${roomId}/guest-link`, {
          user: "bob",
          body: { enabled: true },
        })
      ).status,
    ).toBe(403);
  });

  it("rate limits room guests per IP", async () => {
    server = await startServer();
    let refused = false;
    for (let i = 0; i < 61; i++) {
      const result = await server.guests.resolve({
        roomGuestToken: "guess",
        clientIp: "9.9.9.9",
      });
      if (!result.ok && result.reason === "Too many requests") refused = true;
    }
    expect(refused).toBe(true);
  });
});
