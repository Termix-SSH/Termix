import { and, desc, eq, inArray, lt } from "drizzle-orm";
import { hosts, sessionRecordings } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { rowsAffected } from "./mutation-result.js";
import { insertReturning } from "./returning.js";

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
  protocol?: string | null;
  format?: string | null;
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
  protocol: string;
  format: string | null;
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
    const [created] = await insertReturning(
      this.context,
      sessionRecordings,
      input,
    );

    await this.afterWrite();
    return created;
  }

  async updateEnded(
    id: number,
    input: {
      endedAt: string;
      duration: number | null;
      terminatedByOwner?: boolean;
      terminationReason?: string;
    },
  ): Promise<void> {
    await this.context.drizzle
      .update(sessionRecordings)
      .set(input)
      .where(eq(sessionRecordings.id, id));
    await this.afterWrite();
  }

  async findById(id: number): Promise<SessionRecordingRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sessionRecordings)
      .where(eq(sessionRecordings.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findPathById(id: number): Promise<
    | (SessionRecordingPathRecord & {
        userId: string;
        format?: string | null;
      })
    | null
  > {
    const rows = await this.context.drizzle
      .select({
        id: sessionRecordings.id,
        recordingPath: sessionRecordings.recordingPath,
        userId: sessionRecordings.userId,
        format: sessionRecordings.format,
      })
      .from(sessionRecordings)
      .where(eq(sessionRecordings.id, id))
      .limit(1);
    return rows[0] ?? null;
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
        protocol: sessionRecordings.protocol,
        format: sessionRecordings.format,
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
    const result = await this.context.drizzle
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.id, id));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result) > 0;
  }

  async deleteForUser(userId: string, id: number): Promise<boolean> {
    const result = await this.context.drizzle
      .delete(sessionRecordings)
      .where(
        and(eq(sessionRecordings.id, id), eq(sessionRecordings.userId, userId)),
      );

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result) > 0;
  }

  /**
   * Detaches recordings from a user being deleted instead of removing them.
   * A recording is evidence about the host as much as about the person, and the
   * file stays on disk regardless — deleting only the row would orphan it.
   */
  async anonymizeByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .update(sessionRecordings)
      .set({ userId: null })
      .where(eq(sessionRecordings.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByUserId(userId: string): Promise<number> {
    const result = await this.context.drizzle
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.userId, userId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByHostId(hostId: number): Promise<number> {
    const result = await this.context.drizzle
      .delete(sessionRecordings)
      .where(eq(sessionRecordings.hostId, hostId));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  async deleteByHostIds(hostIds: number[]): Promise<number> {
    if (hostIds.length === 0) {
      return 0;
    }

    const result = await this.context.drizzle
      .delete(sessionRecordings)
      .where(inArray(sessionRecordings.hostId, hostIds));

    if (rowsAffected(result) > 0) {
      await this.afterWrite();
    }

    return rowsAffected(result);
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
