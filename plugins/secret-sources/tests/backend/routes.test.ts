import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { startServer, type TestServer } from "./helpers.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

let server: TestServer;

afterEach(async () => {
  await server?.close();
});

describe("secret-sources routes", () => {
  beforeEach(async () => {
    server = await startServer();
  });

  it("refuses a request without the matching core permission", async () => {
    await server.close();
    server = await startServer({ permissions: [] });
    const res = await server.request("GET", "/");
    expect(res.status).toBe(403);
  });

  it("creates, lists and hides the token from the owner's own list", async () => {
    const create = await server.request("POST", "/", {
      body: {
        name: "Team 1Password",
        baseUrl: "https://connect.internal",
        token: "s3cret-token",
      },
    });
    expect(create.status).toBe(200);
    expect(create.body.source).toMatchObject({
      name: "Team 1Password",
      baseUrl: "https://connect.internal",
      owned: true,
      shared: false,
    });
    expect(create.body.source.token).toBeUndefined();

    const list = await server.request("GET", "/");
    expect(list.body.sources).toHaveLength(1);
    expect(list.body.sources[0].owned).toBe(true);
  });

  it("rejects a create missing a required field", async () => {
    const res = await server.request("POST", "/", {
      body: { name: "", baseUrl: "https://x", token: "t" },
    });
    expect(res.status).toBe(400);
  });

  it("rejects an http(s)-only baseUrl", async () => {
    const res = await server.request("POST", "/", {
      body: { name: "n", baseUrl: "ftp://x", token: "t" },
    });
    expect(res.status).toBe(400);
  });

  it("refuses shared: true for a non-admin", async () => {
    const res = await server.request("POST", "/", {
      body: {
        name: "n",
        baseUrl: "https://connect.internal",
        token: "t",
        shared: true,
      },
    });
    expect(res.status).toBe(403);
  });

  it("allows shared: true for an admin", async () => {
    await server.close();
    server = await startServer({
      permissions: [
        "credentials.view",
        "credentials.create",
        "credentials.edit",
        "credentials.delete",
        "admin.plugins.manage",
      ],
    });
    const res = await server.request("POST", "/", {
      body: {
        name: "n",
        baseUrl: "https://connect.internal",
        token: "t",
        shared: true,
      },
    });
    expect(res.status).toBe(200);
    expect(res.body.source.shared).toBe(true);
  });

  it("shows a shared source to another user, unowned", async () => {
    await server.close();
    server = await startServer({
      permissions: [
        "credentials.view",
        "credentials.create",
        "credentials.edit",
        "credentials.delete",
        "admin.plugins.manage",
      ],
    });
    await server.request("POST", "/", {
      body: { name: "n", baseUrl: "https://x", token: "t", shared: true },
    });
    const list = await server.request("GET", "/", { user: "user-2" });
    expect(list.body.sources).toHaveLength(1);
    expect(list.body.sources[0].owned).toBe(false);
  });

  it("refuses an update or delete from a non-owner", async () => {
    const created = await server.request("POST", "/", {
      body: { name: "n", baseUrl: "https://x", token: "t" },
    });
    const id = created.body.source.id;

    const update = await server.request("PUT", `/${id}`, {
      user: "user-2",
      body: { name: "hijacked" },
    });
    expect(update.status).toBe(403);

    const del = await server.request("DELETE", `/${id}`, { user: "user-2" });
    expect(del.status).toBe(403);
  });

  it("updates without a token keeping the existing one, and deletes cleanly", async () => {
    const created = await server.request("POST", "/", {
      body: { name: "n", baseUrl: "https://x", token: "orig-token" },
    });
    const id = created.body.source.id;

    const update = await server.request("PUT", `/${id}`, {
      body: { name: "renamed" },
    });
    expect(update.status).toBe(200);

    const test = await server.request("POST", `/${id}/test`);
    // Reaches out through ctx.fetch, unstubbed here, so it fails softly.
    expect(test.status).toBe(200);
    expect(test.body.ok).toBe(false);

    const del = await server.request("DELETE", `/${id}`);
    expect(del.status).toBe(200);

    const list = await server.request("GET", "/");
    expect(list.body.sources).toHaveLength(0);
  });

  it("tests a source through ctx.fetch and reports the vault count", async () => {
    await server.close();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse([{ id: "v1", name: "Infra" }]));
    server = await startServer({ fetch: fetchMock });

    const created = await server.request("POST", "/", {
      body: { name: "n", baseUrl: "https://connect.internal", token: "tok" },
    });
    const id = created.body.source.id;

    const test = await server.request("POST", `/${id}/test`);
    expect(test.status).toBe(200);
    expect(test.body).toEqual({ ok: true, vaults: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://connect.internal/v1/vaults",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok" },
      }),
    );
  });
});
