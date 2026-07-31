import { afterEach, describe, expect, it } from "vitest";
import { TestSqliteDatabase } from "./test-support.js";
import { SyncTombstoneRepository } from "../../../database/repositories/sync-tombstone-repository.js";
import {
  normalizeSyncTimestamp,
  timestampAtOrAfter,
} from "../../../database/sync-timestamp.js";
import { sshCredentials } from "../../../database/db/schema.js";
import type { DatabaseContext } from "../../../database/repositories/database-context.js";
import { and, eq } from "drizzle-orm";

// The desktop sync engine always sends its cursor as new Date().toISOString().
const ISO_CURSOR = "2026-07-29T09:00:00.000Z";

describe("sync cursors across timestamp layouts", () => {
  let adapter: TestSqliteDatabase | null = null;

  afterEach(async () => {
    if (adapter) {
      await adapter.close();
      adapter = null;
    }
  });

  /**
   * The harness migrates the schema itself, so the seeds below are INSERTs into
   * the real tables. Both `sync_tombstones.user_id` and `ssh_credentials.user_id`
   * are foreign keys into `users`, which the harness enforces, so the owning row
   * has to exist before either seed runs.
   */
  async function connect(): Promise<{
    db: TestSqliteDatabase;
    context: DatabaseContext;
  }> {
    const db = new TestSqliteDatabase();
    adapter = db;
    const context = await db.connect();
    await db.exec(`
      INSERT INTO users (id, username, password_hash) VALUES
        ('user-1', 'user', 'hash');
    `);
    return { db, context };
  }

  it("normalizes both layouts to one comparable form", () => {
    expect(normalizeSyncTimestamp("2026-07-29T10:11:21.123Z")).toBe(
      "2026-07-29 10:11:21",
    );
    expect(normalizeSyncTimestamp("2026-07-29 10:11:21")).toBe(
      "2026-07-29 10:11:21",
    );
  });

  it("returns tombstones recorded after an ISO cursor, whatever layout they were stored in", async () => {
    const { db, context } = await connect();
    await db.exec(`
      INSERT INTO sync_tombstones (user_id, entity_type, sync_id, deleted_at) VALUES
        ('user-1', 'sshCredentials', 'sqlite-layout', '2026-07-29 10:07:32'),
        ('user-1', 'sshCredentials', 'iso-layout',    '2026-07-29T10:07:32.500Z'),
        ('user-1', 'sshCredentials', 'too-old',       '2026-07-29 08:00:00');
    `);

    const repo = new SyncTombstoneRepository(context);
    const rows = await repo.listSince("user-1", "sshCredentials", ISO_CURSOR);

    expect(rows.map((row) => row.syncId).sort()).toEqual([
      "iso-layout",
      "sqlite-layout",
    ]);
  });

  it("returns rows written by CURRENT_TIMESTAMP against an ISO cursor", async () => {
    const { db, context } = await connect();
    await db.exec(`
      INSERT INTO ssh_credentials (user_id, name, auth_type, updated_at) VALUES
        ('user-1', 'newer-sqlite-layout', 'password', '2026-07-29 10:11:21'),
        ('user-1', 'newer-iso-layout',    'password', '2026-07-29T10:11:21.123Z'),
        ('user-1', 'older',               'password', '2026-07-29 08:59:59');
    `);

    const rows = await context.drizzle
      .select({ name: sshCredentials.name })
      .from(sshCredentials)
      .where(
        and(
          eq(sshCredentials.userId, "user-1"),
          timestampAtOrAfter(sshCredentials.updatedAt, ISO_CURSOR),
        ),
      );

    expect(rows.map((row) => row.name).sort()).toEqual([
      "newer-iso-layout",
      "newer-sqlite-layout",
    ]);
  });

  it("keeps rows written in the same second as the cursor", async () => {
    const { db, context } = await connect();
    await db.exec(`
      INSERT INTO ssh_credentials (user_id, name, auth_type, updated_at)
      VALUES ('user-1', 'same-second', 'password', '2026-07-29 09:00:00');
    `);

    const rows = await context.drizzle
      .select({ name: sshCredentials.name })
      .from(sshCredentials)
      .where(timestampAtOrAfter(sshCredentials.updatedAt, ISO_CURSOR));

    expect(rows.map((row) => row.name)).toEqual(["same-second"]);
  });
});
