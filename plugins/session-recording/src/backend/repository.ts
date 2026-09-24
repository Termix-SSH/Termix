import { and, desc, eq, inArray, lt } from "drizzle-orm";
import type { PluginDatabase, PluginHosts } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// The table comes from ctx.db.define, which the SDK hands back untyped, and
// the drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export interface SessionRecordingRecord {
  id: number;
  hostId: number;
  userId: string | null;
  username: string | null;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  recordingPath: string | null;
  protocol: string;
  format: string | null;
  terminatedByOwner: boolean | null;
  terminationReason: string | null;
}

export interface SessionRecordingListRecord {
  id: number;
  hostId: number;
  userId: string | null;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  recordingPath: string | null;
  protocol: string;
  format: string | null;
  username: string | null;
  hostName: string | null;
  hostIp: string | null;
}

export interface SessionRecordingCreateInput {
  hostId: number;
  userId: string;
  username?: string | null;
  startedAt: string;
  endedAt?: string | null;
  duration?: number | null;
  recordingPath?: string | null;
  protocol?: string | null;
  format?: string | null;
  terminatedByOwner?: boolean | null;
  terminationReason?: string | null;
}

export type SessionRecordingRepository = ReturnType<
  typeof createSessionRecordingRepository
>;

/**
 * Written without RETURNING so it runs the same on all three engines: an
 * insert is read back by a marker key it was given, an update by its id.
 */
export function createSessionRecordingRepository(
  db: PluginDatabase,
  table: Table,
  hosts: PluginHosts,
) {
  const client = () => db.client<Drizzle>();

  async function usernameFor(userId: string): Promise<string | null> {
    const { users } = await db.refs<{ users: Table }>();
    const drizzle = await client();
    const rows = await drizzle
      .select({ username: users.username })
      .from(users)
      .where(eq(users.id, userId));
    return rows[0]?.username ?? null;
  }

  async function withHostNames(
    rows: SessionRecordingListRecord[],
  ): Promise<SessionRecordingListRecord[]> {
    const list = await hosts.list();
    const byId = new Map(list.map((host) => [host.id, host]));
    return rows.map((row) => {
      const host = byId.get(row.hostId);
      return { ...row, hostName: host?.name ?? null, hostIp: host?.ip ?? null };
    });
  }

  return {
    usernameFor,

    /**
     * Inserts a row and returns it. recordingPath is the caller's read-back
     * key: every caller sets it to something unique (the file path or a
     * session id) before insert, since MySQL has no RETURNING to read a new
     * id back with.
     */
    async create(
      input: SessionRecordingCreateInput & { recordingPath: string },
    ): Promise<SessionRecordingRecord> {
      const drizzle = await client();
      await drizzle.insert(table).values(input);
      const rows = await drizzle
        .select()
        .from(table)
        .where(eq(table.recordingPath, input.recordingPath))
        .orderBy(desc(table.id))
        .limit(1);
      await db.persist();
      return rows[0];
    },

    async updateEnded(
      id: number,
      input: {
        endedAt: string;
        duration: number | null;
        terminatedByOwner?: boolean;
        terminationReason?: string | null;
      },
    ): Promise<void> {
      const drizzle = await client();
      await drizzle.update(table).set(input).where(eq(table.id, id));
      await db.persist();
    },

    async findByIdForUser(
      userId: string,
      id: number,
    ): Promise<SessionRecordingRecord | null> {
      const drizzle = await client();
      const rows = await drizzle
        .select()
        .from(table)
        .where(and(eq(table.id, id), eq(table.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findPathByIdForUser(
      userId: string,
      id: number,
    ): Promise<{
      id: number;
      recordingPath: string | null;
      format: string | null;
    } | null> {
      const drizzle = await client();
      const rows = await drizzle
        .select({
          id: table.id,
          recordingPath: table.recordingPath,
          format: table.format,
        })
        .from(table)
        .where(and(eq(table.id, id), eq(table.userId, userId)))
        .limit(1);
      return rows[0] ?? null;
    },

    async listByUserIdWithHost(
      userId: string,
    ): Promise<SessionRecordingListRecord[]> {
      const drizzle = await client();
      const rows = (await drizzle
        .select()
        .from(table)
        .where(eq(table.userId, userId))
        .orderBy(desc(table.startedAt))) as SessionRecordingListRecord[];
      return withHostNames(rows);
    },

    async listPathsOlderThan(
      cutoff: string,
    ): Promise<Array<{ id: number; recordingPath: string | null }>> {
      const drizzle = await client();
      return drizzle
        .select({ id: table.id, recordingPath: table.recordingPath })
        .from(table)
        .where(lt(table.startedAt, cutoff));
    },

    async deleteForUser(userId: string, id: number): Promise<boolean> {
      const drizzle = await client();
      const existing = await drizzle
        .select({ id: table.id })
        .from(table)
        .where(and(eq(table.id, id), eq(table.userId, userId)))
        .limit(1);
      if (existing.length === 0) return false;
      await drizzle
        .delete(table)
        .where(and(eq(table.id, id), eq(table.userId, userId)));
      await db.persist();
      return true;
    },

    async deleteById(id: number): Promise<boolean> {
      const drizzle = await client();
      const existing = await drizzle
        .select({ id: table.id })
        .from(table)
        .where(eq(table.id, id))
        .limit(1);
      if (existing.length === 0) return false;
      await drizzle.delete(table).where(eq(table.id, id));
      await db.persist();
      return true;
    },

    async deleteByHostId(hostId: number): Promise<void> {
      const drizzle = await client();
      await drizzle.delete(table).where(eq(table.hostId, hostId));
      await db.persist();
    },

    async deleteByHostIds(hostIds: number[]): Promise<void> {
      if (hostIds.length === 0) return;
      const drizzle = await client();
      await drizzle.delete(table).where(inArray(table.hostId, hostIds));
      await db.persist();
    },

    /**
     * Detaches recordings from a user being deleted instead of removing them.
     * A recording is evidence about the host as much as about the person, and
     * the file stays on disk regardless of the row.
     */
    async anonymizeByUserId(userId: string): Promise<void> {
      const drizzle = await client();
      await drizzle
        .update(table)
        .set({ userId: null })
        .where(eq(table.userId, userId));
      await db.persist();
    },
  };
}
