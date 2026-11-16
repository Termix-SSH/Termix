import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { TestSqliteDatabase } from "../database/repositories/test-support.js";
import type { DatabaseContext } from "../../database/repositories/database-context.js";

const h = vi.hoisted(() => ({ context: null as unknown }));

vi.mock("../../database/repositories/factory.js", () => ({
  createCurrentRepositoryContext: () => h.context,
}));
vi.mock("../../database/db/dialect.js", () => ({
  needsExplicitPersist: () => false,
}));
vi.mock("../../utils/data-crypto.js", () => ({
  DataCrypto: {
    validateUserAccess: () => Buffer.alloc(32),
    decryptRecord: (_table: string, row: unknown) => row,
    encryptRecord: (_table: string, row: unknown) => row,
  },
}));
vi.mock("../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { forceSave: async () => {} },
}));
vi.mock("../../utils/logger.js", () => ({
  databaseLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("../../utils/shared-host-secrets-manager.js", () => ({
  SharedHostSecretsManager: {
    getInstance: () => ({ resyncHost: async () => {} }),
  },
}));
vi.mock("../../utils/shared-credential-secrets-manager.js", () => ({
  SharedCredentialSecretsManager: {
    getInstance: () => ({ resyncCredential: async () => {} }),
  },
}));

const { transferOwnership } = await import("../../utils/transfer-ownership.js");

describe("transferOwnership", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    await adapter?.close();
    adapter = null;
  });

  it("moves folder shares to the successor and drops ones made to them", async () => {
    adapter = new TestSqliteDatabase();
    h.context = (await adapter.connect()) as DatabaseContext;
    await adapter.exec(`
      INSERT INTO users (id, username, password_hash, is_admin)
      VALUES ('leaver', 'leaver', 'h', 0), ('heir', 'heir', 'h', 1),
             ('alice', 'alice', 'h', 0);
      INSERT INTO folder_access (owner_user_id, folder, user_id, granted_by, permission_level)
      VALUES ('leaver', 'Prod', 'alice', 'leaver', 'connect'),
             ('leaver', 'Prod', 'heir', 'leaver', 'view');
    `);

    await transferOwnership("leaver", "heir");

    const rows = await adapter.query<Record<string, string>>(
      sql`SELECT owner_user_id, user_id, granted_by FROM folder_access`,
    );
    expect(rows).toEqual([
      { owner_user_id: "heir", user_id: "alice", granted_by: "heir" },
    ]);
  });
});
