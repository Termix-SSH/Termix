import { and, eq, gt, isNull, lt } from "drizzle-orm";
import {
  hosts,
  sessionShareParticipants,
  sessionShares,
  users,
} from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";

export type SessionShareRecord = typeof sessionShares.$inferSelect;
export type SessionShareParticipantRecord =
  typeof sessionShareParticipants.$inferSelect;

export type SessionShareType = "link" | "user";
export type SessionSharePermissionLevel = "read-only" | "read-write";

export interface SessionShareCreateInput {
  id: string;
  hostId: number;
  ownerUserId: string;
  protocol: string;
  sessionId: string;
  tabInstanceId?: string | null;
  shareType: SessionShareType;
  targetUserId?: string | null;
  linkToken?: string | null;
  permissionLevel: SessionSharePermissionLevel;
  expiresAt: string;
}

export interface SessionShareWithHost extends SessionShareRecord {
  hostName: string | null;
  ownerUsername: string | null;
}

export interface SharedWithMeRecord extends SessionShareRecord {
  hostName: string | null;
  ownerUsername: string | null;
}

function activeShareFilter(now: string) {
  return and(isNull(sessionShares.revokedAt), gt(sessionShares.expiresAt, now));
}

export class SessionShareRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async create(input: SessionShareCreateInput): Promise<SessionShareRecord> {
    const [created] = await this.context.drizzle
      .insert(sessionShares)
      .values({
        id: input.id,
        hostId: input.hostId,
        ownerUserId: input.ownerUserId,
        protocol: input.protocol,
        sessionId: input.sessionId,
        tabInstanceId: input.tabInstanceId ?? null,
        shareType: input.shareType,
        targetUserId: input.targetUserId ?? null,
        linkToken: input.linkToken ?? null,
        permissionLevel: input.permissionLevel,
        expiresAt: input.expiresAt,
      })
      .returning();

    await this.afterWrite();
    return created;
  }

  async findById(id: string): Promise<SessionShareRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sessionShares)
      .where(eq(sessionShares.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveById(
    id: string,
    now = new Date().toISOString(),
  ): Promise<SessionShareRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sessionShares)
      .where(and(eq(sessionShares.id, id), activeShareFilter(now)))
      .limit(1);
    return rows[0] ?? null;
  }

  async findByLinkToken(
    linkToken: string,
    now = new Date().toISOString(),
  ): Promise<SessionShareRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(sessionShares)
      .where(
        and(eq(sessionShares.linkToken, linkToken), activeShareFilter(now)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findActiveSharesForHost(
    hostId: number,
    ownerUserId: string,
    now = new Date().toISOString(),
  ): Promise<SessionShareRecord[]> {
    return this.context.drizzle
      .select()
      .from(sessionShares)
      .where(
        and(
          eq(sessionShares.hostId, hostId),
          eq(sessionShares.ownerUserId, ownerUserId),
          activeShareFilter(now),
        ),
      );
  }

  async findSharesTargetingUser(
    userId: string,
    now = new Date().toISOString(),
  ): Promise<SharedWithMeRecord[]> {
    const rows = await this.context.drizzle
      .select({
        share: sessionShares,
        hostName: hosts.name,
        ownerUsername: users.username,
      })
      .from(sessionShares)
      .leftJoin(hosts, eq(sessionShares.hostId, hosts.id))
      .leftJoin(users, eq(sessionShares.ownerUserId, users.id))
      .where(
        and(
          eq(sessionShares.shareType, "user"),
          eq(sessionShares.targetUserId, userId),
          activeShareFilter(now),
        ),
      );

    return rows.map((row) => ({
      ...row.share,
      hostName: row.hostName,
      ownerUsername: row.ownerUsername,
    }));
  }

  async revoke(shareId: string, requestingUserId: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .update(sessionShares)
      .set({ revokedAt: new Date().toISOString() })
      .where(
        and(
          eq(sessionShares.id, shareId),
          eq(sessionShares.ownerUserId, requestingUserId),
        ),
      )
      .returning({ id: sessionShares.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }
    return rows.length > 0;
  }

  async revokeAsAdmin(shareId: string): Promise<boolean> {
    const rows = await this.context.drizzle
      .update(sessionShares)
      .set({ revokedAt: new Date().toISOString() })
      .where(eq(sessionShares.id, shareId))
      .returning({ id: sessionShares.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }
    return rows.length > 0;
  }

  async deleteExpiredShares(now = new Date().toISOString()): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sessionShares)
      .where(lt(sessionShares.expiresAt, now))
      .returning({ id: sessionShares.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }
    return rows.length;
  }

  async touchShareUsage(
    shareId: string,
    lastJoinedAt = new Date().toISOString(),
  ): Promise<void> {
    const current = await this.findById(shareId);
    await this.context.drizzle
      .update(sessionShares)
      .set({
        lastJoinedAt,
        joinCount: (current?.joinCount ?? 0) + 1,
      })
      .where(eq(sessionShares.id, shareId));
    await this.afterWrite();
  }

  async recordParticipantJoin(
    shareId: string,
    userId: string | null,
    guestLabel: string | null,
  ): Promise<SessionShareParticipantRecord> {
    const [created] = await this.context.drizzle
      .insert(sessionShareParticipants)
      .values({ shareId, userId, guestLabel })
      .returning();
    await this.afterWrite();
    return created;
  }

  async recordParticipantLeave(participantId: number): Promise<void> {
    await this.context.drizzle
      .update(sessionShareParticipants)
      .set({ leftAt: new Date().toISOString() })
      .where(eq(sessionShareParticipants.id, participantId));
    await this.afterWrite();
  }

  async deleteSharesForHost(hostId: number): Promise<number> {
    const rows = await this.context.drizzle
      .delete(sessionShares)
      .where(eq(sessionShares.hostId, hostId))
      .returning({ id: sessionShares.id });

    if (rows.length > 0) {
      await this.afterWrite();
    }
    return rows.length;
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
