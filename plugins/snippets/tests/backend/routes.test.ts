import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { startServer, type TestServer } from "./helpers";

let server: TestServer;

beforeEach(async () => {
  server = await startServer();
});

afterEach(async () => {
  await server.close();
});

async function create(
  overrides: Record<string, unknown> = {},
  user = "user-1",
) {
  const res = await server.request("POST", "/", {
    user,
    body: { name: "Deploy", content: "echo deploy", ...overrides },
  });
  expect(res.status).toBe(201);
  return res.body;
}

describe("snippet routes", () => {
  it("creates and lists snippets, tagging owned ones as not shared", async () => {
    const created = await create();
    expect(created).toMatchObject({ name: "Deploy", content: "echo deploy" });
    expect(created.syncId).toEqual(expect.any(String));

    const list = await server.request("GET", "/");
    expect(list.body).toEqual([
      expect.objectContaining({ id: created.id, isShared: false }),
    ]);
  });

  it("rejects a missing name or content", async () => {
    expect(
      (await server.request("POST", "/", { body: { content: "x" } })).status,
    ).toBe(400);
    expect(
      (await server.request("POST", "/", { body: { name: "x" } })).status,
    ).toBe(400);
  });

  it("gets, updates and deletes a snippet", async () => {
    const created = await create();

    const got = await server.request("GET", `/${created.id}`);
    expect(got.status).toBe(200);
    expect(got.body.id).toBe(created.id);

    const updated = await server.request("PUT", `/${created.id}`, {
      body: { content: "echo updated" },
    });
    expect(updated.status).toBe(200);
    expect(updated.body.content).toBe("echo updated");

    const deleted = await server.request("DELETE", `/${created.id}`);
    expect(deleted.status).toBe(200);
    expect((await server.request("GET", `/${created.id}`)).status).toBe(404);
  });

  it("keeps snippets isolated per user", async () => {
    await create({ name: "Owner snippet" }, "user-1");
    const list = await server.request("GET", "/", { user: "user-2" });
    expect(list.body).toEqual([]);
  });

  it("creates, renames and deletes a folder, moving its snippets to the root", async () => {
    const folder = await server.request("POST", "/folders", {
      body: { name: "prod", color: "#fff", icon: "server" },
    });
    expect(folder.status).toBe(201);

    const conflict = await server.request("POST", "/folders", {
      body: { name: "prod" },
    });
    expect(conflict.status).toBe(409);

    const rename = await server.request("PUT", "/folders/rename", {
      body: { oldName: "prod", newName: "production" },
    });
    expect(rename.status).toBe(200);

    const snippet = await create({ folder: "production" });
    expect(snippet.folder).toBe("production");

    const deleteFolder = await server.request("DELETE", "/folders/production");
    expect(deleteFolder.status).toBe(200);

    const afterDelete = await server.request("GET", `/${snippet.id}`);
    expect(afterDelete.body.folder).toBeNull();
  });

  it("reorders snippets, accepting both the snippets and legacy updates keys", async () => {
    const a = await create({ name: "a" });
    const b = await create({ name: "b" });

    const reordered = await server.request("PUT", "/reorder", {
      body: {
        snippets: [
          { id: a.id, order: 2 },
          { id: b.id, order: 1 },
        ],
      },
    });
    expect(reordered.status).toBe(200);

    const legacy = await server.request("PUT", "/reorder", {
      body: { updates: [{ id: a.id, order: 5 }] },
    });
    expect(legacy.status).toBe(200);

    expect((await server.request("PUT", "/reorder", { body: {} })).status).toBe(
      400,
    );
  });

  it("exports and bulk-imports snippets and folders", async () => {
    await create({ name: "Exportable" });
    const exported = await server.request("GET", "/export");
    expect(exported.status).toBe(200);
    expect(exported.body.snippets).toHaveLength(1);

    const imported = await server.request("POST", "/bulk-import", {
      body: {
        snippets: [{ name: "Imported", content: "echo hi" }],
        folders: [],
        overwrite: false,
      },
    });
    expect(imported.status).toBe(200);
    expect(imported.body.snippetsImported).toBe(1);
  });

  it("shares a snippet with another user, who can then read it as shared", async () => {
    const snippet = await create();

    const share = await server.request("POST", `/${snippet.id}/share`, {
      body: { targetType: "user", targetUserId: "user-2" },
    });
    expect(share.status).toBe(200);

    const sharedList = await server.request("GET", "/shared", {
      user: "user-2",
    });
    expect(sharedList.body.sharedSnippets).toEqual([
      expect.objectContaining({ id: snippet.id, name: snippet.name }),
    ]);

    const visibleToOwner = await server.request("GET", `/${snippet.id}/access`);
    expect(visibleToOwner.status).toBe(200);
    expect(visibleToOwner.body).toHaveLength(1);

    const revoke = await server.request(
      "DELETE",
      `/${snippet.id}/access/${visibleToOwner.body[0].id}`,
    );
    expect(revoke.status).toBe(200);

    const afterRevoke = await server.request("GET", "/shared", {
      user: "user-2",
    });
    expect(afterRevoke.body.sharedSnippets).toEqual([]);
  });

  it("refuses sharing a snippet the caller does not own", async () => {
    const snippet = await create({}, "user-1");
    const attempt = await server.request("POST", `/${snippet.id}/share`, {
      user: "user-2",
      body: { targetType: "user", targetUserId: "user-1" },
    });
    expect(attempt.status).toBe(403);
  });

  it("shares every snippet in a folder at once", async () => {
    await create({ name: "s1", folder: "team" });
    await create({ name: "s2", folder: "team" });

    const share = await server.request("PUT", "/folder/share", {
      body: { folder: "team", targetType: "user", targetUserId: "user-2" },
    });
    expect(share.status).toBe(200);
    expect(share.body.snippetsShared).toBe(2);
  });

  it("denies every route without its permission", async () => {
    const denied = await startServer({ permissions: [] });
    try {
      expect((await denied.request("GET", "/")).status).toBe(403);
      expect((await denied.request("POST", "/", { body: {} })).status).toBe(
        403,
      );
      expect((await denied.request("GET", "/folders")).status).toBe(403);
      expect(
        (await denied.request("POST", "/folders", { body: { name: "x" } }))
          .status,
      ).toBe(403);
    } finally {
      await denied.close();
    }
  });

  it("lets execute run without any snippets.* permission", async () => {
    const noPerms = await startServer({ permissions: [] });
    try {
      const res = await noPerms.request("POST", "/execute", {
        body: { snippetId: 999, hostId: 1 },
      });
      // 404 (no accessible snippet), not 403: execute needs no grant.
      expect(res.status).toBe(404);
    } finally {
      await noPerms.close();
    }
  });

  it("rejects executing a note", async () => {
    const note = await server.request("POST", "/", {
      body: { name: "Note", content: "remember this", isNote: true },
    });
    const res = await server.request("POST", "/execute", {
      body: { snippetId: note.body.id, hostId: 1 },
    });
    expect(res.status).toBe(400);
  });

  it("404s executing a snippet the caller cannot see", async () => {
    const res = await server.request("POST", "/execute", {
      body: { snippetId: 999, hostId: 1 },
    });
    expect(res.status).toBe(404);
  });
});
