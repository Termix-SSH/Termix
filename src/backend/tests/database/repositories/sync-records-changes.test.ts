import { afterEach, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { TestSqliteDatabase } from "./test-support.js";
import type { DatabaseContext } from "../../../database/repositories/database-context.js";

const state = vi.hoisted(() => ({
  context: null as DatabaseContext | null,
}));

vi.mock("../../../database/repositories/factory.js", () => ({
  createCurrentRepositoryContext: () => state.context,
}));
vi.mock("../../../utils/database-save-trigger.js", () => ({
  DatabaseSaveTrigger: { triggerSave: vi.fn() },
}));

const { listChanges } = await import("../../../sync/records.js");

// Runs against Postgres and MySQL too in the database-dialects CI job, where
// sync_records.seq is a 32-bit integer.
describe("listChanges", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
    state.context = null;
  });

  async function seed(): Promise<void> {
    adapter = new TestSqliteDatabase();
    state.context = await adapter.connect();
    await adapter.run(
      sql`INSERT INTO users (id, username, password_hash) VALUES ('user-1', 'user-1', '')`,
    );
    await adapter.run(
      sql`INSERT INTO sync_records (user_id, entity_type, sync_id, revision, seq) VALUES ('user-1', 'hosts', 'a', 1, 1), ('user-1', 'hosts', 'b', 1, 2)`,
    );
  }

  it("lists records after the cursor in seq order", async () => {
    await seed();
    const records = await listChanges("user-1", 1, 10);
    expect(records.map((record) => record.syncId)).toEqual(["b"]);
  });

  it("answers no records for a cursor past what seq can hold", async () => {
    await seed();
    expect(await listChanges("user-1", Number.MAX_SAFE_INTEGER, 10)).toEqual(
      [],
    );
  });
});
