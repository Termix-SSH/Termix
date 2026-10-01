import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@termix/plugin-sdk/testing";
import {
  snippetAccess,
  snippetFolders,
  snippets,
} from "../../src/backend/tables.js";
import {
  createSnippetRepository,
  type SnippetRepository,
} from "../../src/backend/repository.js";
import { pluginDir } from "./helpers";

let db: TestDb;
let repo: SnippetRepository;

beforeEach(async () => {
  db = await createTestDb(pluginDir, {
    before: (sqlite) => {
      sqlite.exec("INSERT INTO users (id) VALUES ('user-1'), ('user-2')");
      sqlite.exec(
        "INSERT INTO roles (id, name, display_name) VALUES (7, 'ops', 'Operations')",
      );
    },
  });
  repo = createSnippetRepository(
    db.database,
    await db.database.define(snippets),
    await db.database.define(snippetFolders),
    await db.database.define(snippetAccess),
  );
});

afterEach(() => db.close());

describe("snippet repository", () => {
  it("reads a new row back by its own sync id", async () => {
    const a = await repo.createSnippet("user-1", {
      name: "A",
      content: "echo a",
    });
    const b = await repo.createSnippet("user-1", {
      name: "B",
      content: "echo b",
    });
    expect(a.name).toBe("A");
    expect(b.name).toBe("B");
    expect(a.syncId).not.toBe(b.syncId);
  });

  it("auto-assigns the next order within a folder", async () => {
    await repo.createSnippet("user-1", {
      name: "A",
      content: "a",
      folder: "prod",
    });
    const second = await repo.createSnippet("user-1", {
      name: "B",
      content: "b",
      folder: "prod",
    });
    const rootLevel = await repo.createSnippet("user-1", {
      name: "C",
      content: "c",
    });
    expect(second.order).toBe(1);
    expect(rootLevel.order).toBe(0);
  });

  it("renames a folder and re-points its snippets, refusing a name collision", async () => {
    await repo.createFolder("user-1", "prod", null, null);
    await repo.createFolder("user-1", "staging", null, null);
    const snippet = await repo.createSnippet("user-1", {
      name: "A",
      content: "a",
      folder: "prod",
    });

    const conflict = await repo.renameFolder("user-1", "prod", "staging");
    expect(conflict.status).toBe("conflict");

    const missing = await repo.renameFolder("user-1", "ghost", "new");
    expect(missing.status).toBe("missing");

    const renamed = await repo.renameFolder("user-1", "prod", "production");
    expect(renamed.status).toBe("renamed");

    const updated = await repo.findOwnedById("user-1", snippet.id);
    expect(updated?.folder).toBe("production");
  });

  it("moves snippets to the root when their folder is deleted", async () => {
    await repo.createFolder("user-1", "prod", null, null);
    const snippet = await repo.createSnippet("user-1", {
      name: "A",
      content: "a",
      folder: "prod",
    });

    const result = await repo.deleteFolder("user-1", "prod");
    expect(result).not.toBeNull();

    const updated = await repo.findOwnedById("user-1", snippet.id);
    expect(updated?.folder).toBeNull();
  });

  it("bulk imports, skipping existing snippets unless overwrite is set", async () => {
    await repo.createSnippet("user-1", { name: "A", content: "old" });

    const skipped = await repo.bulkImport(
      "user-1",
      [{ name: "A", content: "new" }],
      [],
      false,
    );
    expect(skipped.snippetsSkipped).toBe(1);
    expect(skipped.snippetsImported).toBe(0);

    const overwritten = await repo.bulkImport(
      "user-1",
      [{ name: "A", content: "new" }],
      [],
      true,
    );
    expect(overwritten.snippetsUpdated).toBe(1);

    const list = await repo.listOwnedSnippets("user-1");
    expect(list).toHaveLength(1);
    expect(list[0].content).toBe("new");
  });

  it("shares a snippet and lists it for the recipient, then revokes it", async () => {
    const snippet = await repo.createSnippet("user-1", {
      name: "A",
      content: "a",
    });

    const created = await repo.upsertSnippetAccess({
      snippetId: snippet.id,
      targetType: "user",
      targetUserId: "user-2",
      grantedBy: "user-1",
      expiresAt: null,
    });
    expect(created.created).toBe(true);

    const again = await repo.upsertSnippetAccess({
      snippetId: snippet.id,
      targetType: "user",
      targetUserId: "user-2",
      grantedBy: "user-1",
      expiresAt: "2099-01-01T00:00:00.000Z",
    });
    expect(again.created).toBe(false);
    expect(again.id).toBe(created.id);

    const roleIds = await repo.listUserRoleIds("user-2");
    const shared = await repo.listSharedSnippets("user-2", roleIds);
    expect(shared).toEqual([
      expect.objectContaining({ id: snippet.id, name: "A" }),
    ]);

    const accessible = await repo.findAccessibleSharedSnippet(
      snippet.id,
      "user-2",
      roleIds,
    );
    expect(accessible?.id).toBe(snippet.id);

    await repo.revokeSnippetAccess(created.id, snippet.id);
    const afterRevoke = await repo.listSharedSnippets("user-2", roleIds);
    expect(afterRevoke).toEqual([]);
  });

  it("wipes a user's snippets and folders on deleteByUserId", async () => {
    await repo.createSnippet("user-1", { name: "A", content: "a" });
    await repo.createFolder("user-1", "prod", null, null);
    await repo.createSnippet("user-2", { name: "B", content: "b" });

    await repo.deleteByUserId("user-1");

    expect(await repo.listOwnedSnippets("user-1")).toEqual([]);
    expect(await repo.listFolders("user-1")).toEqual([]);
    expect(await repo.listOwnedSnippets("user-2")).toHaveLength(1);
  });
});
