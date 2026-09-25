import { beforeAll, describe, expect, it } from "vitest";
import {
  deserializeSyncReferences,
  orderSyncRows,
  serializeSyncReferences,
} from "../../database/routes/sync-references.js";
import { registerCoreSyncEntities } from "../../database/routes/sync-entities.js";

describe("sync references", () => {
  // References come from the registry now, not a hardcoded map, so the core
  // entities have to be registered before any of this resolves. sync.ts does
  // this at import in production.
  beforeAll(() => {
    registerCoreSyncEntities();
  });

  it("serializes database-local host IDs as stable sync IDs", async () => {
    const row = await serializeSyncReferences(
      "hosts",
      {
        id: 7,
        credentialId: 12,
        rdpCredentialId: 13,
        vncCredentialId: null,
        telnetCredentialId: null,
        parentHostId: 3,
      },
      async (entityType, id) => `${entityType}-${id}`,
    );

    expect(row).toMatchObject({
      credentialSyncId: "sshCredentials-12",
      rdpCredentialSyncId: "sshCredentials-13",
      vncCredentialSyncId: null,
      telnetCredentialSyncId: null,
      parentHostSyncId: "hosts-3",
    });
    expect(row).not.toHaveProperty("credentialId");
  });

  it("resolves stable sync IDs to IDs from the receiving database", async () => {
    const ids = new Map([
      ["sshCredentials:credential-sync", 91],
      ["hosts:parent-sync", 52],
    ]);
    const row = await deserializeSyncReferences(
      "hosts",
      {
        credentialId: 12,
        credentialSyncId: "credential-sync",
        rdpCredentialSyncId: null,
        vncCredentialSyncId: null,
        telnetCredentialSyncId: null,
        parentHostSyncId: "parent-sync",
      },
      async (entityType, syncId) => ids.get(`${entityType}:${syncId}`) ?? null,
    );

    expect(row).toMatchObject({
      credentialId: 91,
      rdpCredentialId: null,
      vncCredentialId: null,
      telnetCredentialId: null,
      parentHostId: 52,
    });
    expect(row).not.toHaveProperty("credentialSyncId");
  });

  it("orders parent hosts before children", () => {
    const parent = { syncId: "parent", parentHostSyncId: null };
    const child = { syncId: "child", parentHostSyncId: "parent" };
    const grandchild = { syncId: "grandchild", parentHostSyncId: "child" };

    expect(orderSyncRows("hosts", [grandchild, child, parent])).toEqual([
      parent,
      child,
      grandchild,
    ]);
  });

  it("leaves other entity types in their existing order", () => {
    const rows = [{ syncId: "second" }, { syncId: "first" }];
    expect(orderSyncRows("sshFolders", rows)).toBe(rows);
  });

  it("rejects a row whose referenced dependency has not synced", async () => {
    await expect(
      deserializeSyncReferences(
        "sshFolders",
        { credentialSyncId: "missing" },
        async () => null,
      ),
    ).rejects.toThrow("Missing sshCredentials dependency");
  });
});
