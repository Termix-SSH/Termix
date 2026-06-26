import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { hosts, sessionRecordings } from "../db/schema.js";
import type { DatabaseContext } from "../runtime/adapter.js";

export type SessionRecordingRecord = typeof sessionRecordings.$inferSelect;

export interface SessionRecordingCreateInput {
  hostId: number;
  userId: string;
  startedAt: string;
  endedAt?: string | null;
  duration?: number | null;
  commands?: string | null;
  dangerousActions?: string | null;
  recordingPath?: string | null;
  terminatedByOwner?: boolean | null;
  terminationReason?: string | null;
}

export interface SessionRecordingListRecord {
  id: number;
  hostId: number;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  duration: number | null;
  recordingPath: string | null;
  hostName: string | null;
  hostIp: string | null;
}

export interface SessionRecordingPathRecord {
  id: number;
  recordingPath: string | null;
}

export class SessionRecordingRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(
    input: SessionRecordingCreateInput,
  ): Promise<SessionRecordingRecord> {
    const [created] = await this.context.drizzle
      .insert(sessionRecordings)
      .values(input)
      .returning();

    await this.afterWrite();
    return created;
  }

  async listByUserIdWithHost(
    userId: string,
  ): Promise<SessionRecordingListRecord[]> {
    return this.context.drizzle
      .select({
        id: sessionRecordings.id,
        hostId: sessionRecordings.hostId,
        userId: sessionRecordings.userId,
        startedAt: sessionRecordings.startedAt,
        endedAt: sessionRecordings.endedAt,
        duration: sessionRecordings.duration,
        recordingPath: sessionRecordings.recordingPath,
        hostName: hosts.name,
        hostIp: hosts.ip,
      })
      .from(sessionRecordings)
      .leftJoin(hosts, eq(sessionRecordings.hostId, hosts.id))
      .where(eq(sessionRecordings.userId, userId))
      .orderBy(desc(sessionRecordings.startedAt));
  }

  async findByIdForUser(
    userId: string,
    id: number,
  ): Promise<SessionRecordingRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sessionRecordings)
      .where(
        and(eq(sessionRecordings.id, id), eq(sessionRecordings.userId, userId)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async findPathByIdForUser(
    userId: string,
    id: number,
  ): Promise<SessionRecordingPathRecord | null> {
    const rows = await this.context.drizzle
      .select({
        id: sessionRecordings.id,
        recordingPath: sessionRecordings.recordingPath,
      })
      .from(sessionRecordings)
      .where(
        and(eq(sessionRecordings.id, id), eq(sessionRecordings.userId, userId)),
      )
      .limit(1);

    return rows[0] ?? null;
  }

  async listPathsOlderThan(
    cutoff: string,
  ): Promise<SessionRecordingPathRecord[]> {
    return this.context.drizzle
      .select({
        id: sessionRecordings.id,
        recordingPath: sessionRecordings.recordingPath,
      })
      .from(sessionRecordings)
      .where(lt(sessionRecordings.startedAt, cutoff));
  }

  async deleteById(id: number): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.id, id))
      .returning({ id: sessionRecordings.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async deleteForUser(userId: string, id: number): Promise<boolean> {
    const rows = await this.context.drizzle
      .delete(sessionRecordings)
      .where(
        and(eq(sessionRecordings.id, id), eq(sessionRecordings.userId, userId)),
      )
      .returning({ id: sessionRecordings.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length > 0;
  }

  async deleteByUserId(userId: string): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.userId, userId))
      .returning({ id: sessionRecordings.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByHostId(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.hostId, hostId))
      .returning({ id: sessionRecordings.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  async deleteByHostIds(hostIds: number[]): Promise<number> {
    if (hostIds.length === 0) {
      return 0;
    }

    const rows = await this.context.drizzle
      .delete(sessionRecordings)
      .where(inArray(sessionRecordings.hostId, hostIds))
      .returning({ id: sessionRecordings.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }

    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
