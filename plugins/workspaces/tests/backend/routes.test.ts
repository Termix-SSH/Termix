import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { layout, startServer, type TestServer } from "./helpers";

let server: TestServer;

beforeEach(async () => {
  server = await startServer();
});

afterEach(async () => {
  await server.close();
});

async function create(name = "Prod", user = "user-1") {
  const res = await server.request("POST", "/", {
    user,
    body: { name, color: "#ef4444", payload: layout() },
  });
  expect(res.status).toBe(200);
  return res.body;
}

describe("workspace routes", () => {
  it("creates and lists workspaces with a parsed payload and tab count", async () => {
    const created = await create();
    expect(created).toMatchObject({
      name: "Prod",
      color: "#ef4444",
      kind: "manual",
      isDefault: false,
      tabCount: 1,
    });
    expect(created.payload.tabs).toHaveLength(1);
    expect(created.syncId).toEqual(expect.any(String));

    const list = await server.request("GET", "/");
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(created.id);
  });

  it("rejects a missing name or payload", async () => {
    expect(
      (await server.request("POST", "/", { body: { payload: layout() } }))
        .status,
    ).toBe(400);
    expect(
      (await server.request("POST", "/", { body: { name: "x", payload: {} } }))
        .status,
    ).toBe(400);
  });

  it("keeps one last session row per user and never lists it as editable", async () => {
    expect((await server.request("GET", "/last-session")).body).toBeNull();

    await server.request("PUT", "/last-session", {
      body: { payload: layout() },
    });
    const second = await server.request("PUT", "/last-session", {
      body: { payload: layout([]) },
    });
    expect(second.body.tabCount).toBe(0);

    const list = (await server.request("GET", "/")).body;
    expect(
      list.filter(
        (w: { kind: string; isDefault: boolean; id: number }) =>
          w.kind === "last_session",
      ),
    ).toHaveLength(1);

    const id = second.body.id;
    expect(
      (await server.request("PATCH", `/${id}`, { body: { name: "x" } })).status,
    ).toBe(404);
    expect((await server.request("DELETE", `/${id}`)).status).toBe(404);
  });

  it("renames, replaces content and duplicates", async () => {
    const created = await create();

    const renamed = await server.request("PATCH", `/${created.id}`, {
      body: { name: "  Staging  ", color: "#22c55e" },
    });
    expect(renamed.body).toMatchObject({ name: "Staging", color: "#22c55e" });

    const replaced = await server.request("PUT", `/${created.id}/content`, {
      body: { payload: layout([]) },
    });
    expect(replaced.body.tabCount).toBe(0);

    const copy = await server.request("POST", `/${created.id}/duplicate`, {
      body: { name: "Staging (copy)" },
    });
    expect(copy.body).toMatchObject({
      name: "Staging (copy)",
      color: "#22c55e",
      tabCount: 0,
    });
    expect(copy.body.id).not.toBe(created.id);
  });

  it("keeps a single default", async () => {
    const a = await create("A");
    const b = await create("B");

    await server.request("POST", `/${a.id}/set-default`);
    await server.request("POST", `/${b.id}/set-default`);

    const list = (await server.request("GET", "/")).body;
    const defaults = list.filter(
      (w: { kind: string; isDefault: boolean; id: number }) => w.isDefault,
    );
    expect(
      defaults.map(
        (w: { kind: string; isDefault: boolean; id: number }) => w.id,
      ),
    ).toEqual([b.id]);

    const unset = await server.request("POST", `/${b.id}/unset-default`);
    expect(unset.body.isDefault).toBe(false);
  });

  it("marks a workspace as used when it is applied", async () => {
    const created = await create();
    expect(created.lastUsedAt).toBeNull();

    const applied = await server.request("POST", `/${created.id}/apply`);
    expect(applied.status).toBe(200);

    const list = (await server.request("GET", "/")).body;
    expect(list[0].lastUsedAt).toEqual(expect.any(String));
  });

  it("deletes a workspace", async () => {
    const created = await create();
    expect((await server.request("DELETE", `/${created.id}`)).body).toEqual({
      success: true,
    });
    expect((await server.request("GET", "/")).body).toEqual([]);
    expect((await server.request("DELETE", `/${created.id}`)).status).toBe(404);
  });

  it("rejects ids that are not numbers", async () => {
    expect((await server.request("DELETE", "/abc")).status).toBe(400);
    expect((await server.request("POST", "/abc/apply")).status).toBe(400);
  });

  it("never shows or changes another user's workspaces", async () => {
    const mine = await create("Mine", "user-1");

    expect((await server.request("GET", "/", { user: "user-2" })).body).toEqual(
      [],
    );
    for (const [method, path] of [
      ["PATCH", `/${mine.id}`],
      ["DELETE", `/${mine.id}`],
      ["POST", `/${mine.id}/apply`],
      ["POST", `/${mine.id}/set-default`],
      ["POST", `/${mine.id}/duplicate`],
    ] as const) {
      const res = await server.request(method, path, {
        user: "user-2",
        body: { name: "stolen" },
      });
      expect(res.status).toBe(404);
    }
  });

  it("flushes the database after every write", async () => {
    const before = server.db.persisted;
    const created = await create();
    await server.request("POST", `/${created.id}/set-default`);
    await server.request("DELETE", `/${created.id}`);
    expect(server.db.persisted).toBeGreaterThanOrEqual(before + 3);
  });
});

describe("workspaces.use", () => {
  it("refuses every route without it", async () => {
    await server.close();
    server = await startServer({ permissions: [] });

    for (const [method, path] of [
      ["GET", "/"],
      ["POST", "/"],
      ["GET", "/last-session"],
      ["PUT", "/last-session"],
      ["PATCH", "/1"],
      ["PUT", "/1/content"],
      ["POST", "/1/duplicate"],
      ["POST", "/1/set-default"],
      ["POST", "/1/unset-default"],
      ["POST", "/1/apply"],
      ["DELETE", "/1"],
    ] as const) {
      const res = await server.request(method, path, {
        body: { name: "x", payload: layout() },
      });
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.required).toBe("workspaces.use");
    }
  });
});
