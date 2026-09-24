import { afterEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer | null = null;

afterEach(async () => {
  await server?.close();
  server = null;
});

const linkShare = (overrides: Record<string, unknown> = {}) => ({
  hostId: 1,
  sessionId: "sess-1",
  protocol: "ssh",
  shareType: "link",
  permissionLevel: "read-only",
  ...overrides,
});

describe("share routes", () => {
  it("creates a link share for a session the caller owns", async () => {
    server = await startServer();
    server.live.addSession("sess-1", "alice");

    const res = await server.request("POST", "/create", { body: linkShare() });

    expect(res.status).toBe(200);
    expect(res.body.linkToken).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const active = await server.request("GET", "/host/1/active");
    expect(active.body.shares).toHaveLength(1);
    expect(active.body.shares[0]).toMatchObject({
      ownerUserId: "alice",
      shareType: "link",
      permissionLevel: "read-only",
    });
  });

  it("refuses a session someone else owns", async () => {
    server = await startServer();
    server.live.addSession("sess-1", "bob");

    const res = await server.request("POST", "/create", { body: linkShare() });
    expect(res.status).toBe(403);
  });

  it("refuses when sharing is off for the host or everywhere", async () => {
    server = await startServer({ settings: { globallyEnabled: false } });
    server.live.addSession("sess-1", "alice");
    expect(
      (await server.request("POST", "/create", { body: linkShare() })).status,
    ).toBe(403);
    await server.close();

    server = await startServer();
    server.live.addSession("sess-1", "alice");
    await server.mock.ctx.settings.setHost(1, "allowSessionSharing", false);
    expect(
      (await server.request("POST", "/create", { body: linkShare() })).status,
    ).toBe(403);
  });

  it("validates the request", async () => {
    server = await startServer();
    for (const body of [
      {},
      linkShare({ protocol: "ftp" }),
      linkShare({ shareType: "room" }),
      linkShare({ permissionLevel: "owner" }),
      linkShare({ shareType: "user" }),
    ]) {
      expect((await server.request("POST", "/create", { body })).status).toBe(
        400,
      );
    }
  });

  it("shares with a user only when they can reach the host", async () => {
    server = await startServer({ accessibleHostIds: [1] });
    server.live.addSession("sess-1", "alice", 1);
    server.live.addSession("sess-2", "alice", 2);

    const ok = await server.request("POST", "/create", {
      body: linkShare({ shareType: "user", targetUserId: "bob" }),
    });
    expect(ok.status).toBe(200);
    expect(ok.body.linkToken).toBeNull();

    const noAccess = await server.request("POST", "/create", {
      body: linkShare({
        hostId: 2,
        sessionId: "sess-2",
        shareType: "user",
        targetUserId: "bob",
      }),
    });
    expect(noAccess.status).toBe(403);

    const unknownUser = await server.request("POST", "/create", {
      body: linkShare({ shareType: "user", targetUserId: "nobody" }),
    });
    expect(unknownUser.status).toBe(403);
  });

  it("lets the owner or an admin revoke, and kicks SSH guests", async () => {
    server = await startServer({ admins: ["carol"] });
    server.live.addSession("sess-1", "alice");
    const { body } = await server.request("POST", "/create", {
      body: linkShare(),
    });

    expect(
      (await server.request("DELETE", `/${body.shareId}`, { user: "bob" }))
        .status,
    ).toBe(403);
    expect(
      (await server.request("DELETE", `/${body.shareId}`, { user: "carol" }))
        .status,
    ).toBe(200);
    expect(server.live.calls[0]).toEqual([
      "ownerEndSession",
      "sess-1",
      "Session share revoked by owner",
    ]);
    expect(
      (
        await server.request("GET", `/resolve/${body.linkToken}`, {
          user: null,
        })
      ).status,
    ).toBe(404);
    expect((await server.request("DELETE", "/missing")).status).toBe(404);
  });

  it("ends a shared session for its owner only", async () => {
    server = await startServer();
    server.live.addSession("sess-1", "alice");
    const { body } = await server.request("POST", "/create", {
      body: linkShare(),
    });

    expect(
      (await server.request("POST", `/${body.shareId}/end`, { user: "bob" }))
        .status,
    ).toBe(403);
    expect((await server.request("POST", `/${body.shareId}/end`)).status).toBe(
      200,
    );
    expect(server.live.calls).toContainEqual([
      "ownerEndSession",
      "sess-1",
      "Session ended by owner",
    ]);
  });

  it("lists live sessions shared with the caller", async () => {
    server = await startServer();
    server.live.addSession("sess-1", "alice");
    const { body } = await server.request("POST", "/create", {
      body: linkShare({ shareType: "user", targetUserId: "bob" }),
    });

    const res = await server.request("GET", "/shared-with-me", { user: "bob" });
    expect(res.body).toEqual([
      expect.objectContaining({
        sessionId: "sess-1",
        hostName: "host-1",
        isOwnSession: false,
        sharedByUsername: "alice",
        shareId: body.shareId,
        permissionLevel: "read-only",
      }),
    ]);

    server.live.sessions.delete("sess-1");
    expect(
      (await server.request("GET", "/shared-with-me", { user: "bob" })).body,
    ).toEqual([]);
  });

  it("lists users and roles for the pickers", async () => {
    server = await startServer();
    server.db.sqlite
      .prepare("INSERT INTO roles (id, name, display_name) VALUES (?, ?, ?)")
      .run(3, "ops", "Operations");
    const res = await server.request("GET", "/directory");
    expect(res.body.users.map((u: { id: string }) => u.id)).toEqual([
      "alice",
      "bob",
      "carol",
    ]);
    expect(res.body.roles).toEqual([
      { id: 3, name: "ops", displayName: "Operations" },
    ]);
  });

  it("denies every signed-in route without the use permission", async () => {
    server = await startServer({ permissions: [] });
    for (const [method, path] of [
      ["POST", "/create"],
      ["GET", "/host/1/active"],
      ["GET", "/shared-with-me"],
      ["GET", "/directory"],
      ["DELETE", "/share-1"],
      ["POST", "/share-1/end"],
      ["POST", "/rooms"],
      ["GET", "/rooms"],
      ["GET", "/rooms/r"],
      ["POST", "/rooms/r/members"],
      ["DELETE", "/rooms/r/members/bob"],
      ["POST", "/rooms/r/present"],
      ["POST", "/rooms/r/stop"],
      ["GET", "/rooms/r/stage"],
      ["POST", "/rooms/r/control"],
      ["POST", "/rooms/r/control/request"],
      ["GET", "/rooms/r/control/requests"],
      ["DELETE", "/rooms/r/control/requests/bob"],
      ["POST", "/rooms/r/guest-link"],
      ["POST", "/rooms/r/end"],
      ["DELETE", "/rooms/r"],
    ]) {
      const res = await server.request(method, path, { body: {} });
      expect([method, path, res.status]).toEqual([method, path, 403]);
    }
  });
});
