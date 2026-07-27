import { describe, expect, it } from "vitest";
import {
  deserializeSyncReferences,
  serializeSyncReferences,
} from "../../database/routes/sync-references.js";

describe("sync references", () => {
  it("serializes database-local host IDs as stable sync IDs", async () => {
    const row = await serializeSyncReferences(
      "hosts",
      {
        id: 7,
        credentialId: 12,
        rdpCredentialId: 13,
        vncCredentialId: null,
        telnetCredentialId: null,
        vaultProfileId: 4,
      },
      async (entityType, id) => `${entityType}-${id}`,
    );

    expect(row).toMatchObject({
      credentialSyncId: "sshCredentials-12",
      rdpCredentialSyncId: "sshCredentials-13",
      vncCredentialSyncId: null,
      telnetCredentialSyncId: null,
      vaultProfileSyncId: "vaultProfiles-4",
    });
    expect(row).not.toHaveProperty("credentialId");
    expect(row).not.toHaveProperty("vaultProfileId");
  });

  it("resolves stable sync IDs to IDs from the receiving database", async () => {
    const ids = new Map([
      ["sshCredentials:credential-sync", 91],
      ["vaultProfiles:vault-sync", 37],
    ]);
    const row = await deserializeSyncReferences(
      "hosts",
      {
        credentialId: 12,
        credentialSyncId: "credential-sync",
        rdpCredentialSyncId: null,
        vncCredentialSyncId: null,
        telnetCredentialSyncId: null,
        vaultProfileSyncId: "vault-sync",
      },
      async (entityType, syncId) => ids.get(`${entityType}:${syncId}`) ?? null,
    );

    expect(row).toMatchObject({
      credentialId: 91,
      rdpCredentialId: null,
      vncCredentialId: null,
      telnetCredentialId: null,
      vaultProfileId: 37,
    });
    expect(row).not.toHaveProperty("credentialSyncId");
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
