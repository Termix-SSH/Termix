import { and, desc, eq, isNull } from "drizzle-orm";
import { collabRoomMembers, collabRooms, users } from "../db/schema.js";
import type { DatabaseContext } from "./database-context.js";
import { insertReturning } from "./returning.js";
import { rowsAffected } from "./mutation-result.js";

export type CollabRoomRecord = typeof collabRooms.$inferSelect;
export type CollabRoomMemberRecord = typeof collabRoomMembers.$inferSelect;

export type CollabRoomRole = "host" | "member";

export interface CollabRoomMemberWithUser {
  userId: string;
  username: string;
  roomRole: string;
  createdAt: string;
}

export interface CollabRoomStage {
  presenterUserId: string | null;
  stageProtocol: string | null;
  stageHostId: number | null;
  stageShareId: string | null;
}

export class CollabRoomRepository {
  constructor(
    private readonly context: DatabaseContext,
    private readonly onWrite?: () => void | Promise<void>,
  ) {}

  async createRoom(input: {
    id: string;
    name: string;
    ownerUserId: string;
    persistent: boolean;
  }): Promise<CollabRoomRecord> {
    const [created] = await insertReturning(this.context, collabRooms, {
      id: input.id,
      name: input.name,
      ownerUserId: input.ownerUserId,
      persistent: input.persistent,
    });
    await this.afterWrite();
    return created;
  }

  async findById(id: string): Promise<CollabRoomRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(collabRooms)
      .where(eq(collabRooms.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  /** The live room whose stage points at this share, if any. */
  async findByStageShareId(shareId: string): Promise<CollabRoomRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(collabRooms)
      .where(
        and(eq(collabRooms.stageShareId, shareId), isNull(collabRooms.endedAt)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async findByGuestToken(token: string): Promise<CollabRoomRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(collabRooms)
      .where(
        and(eq(collabRooms.guestLinkToken, token), isNull(collabRooms.endedAt)),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async setGuestToken(roomId: string, token: string | null): Promise<void> {
    await this.context.drizzle
      .update(collabRooms)
      .set({ guestLinkToken: token })
      .where(eq(collabRooms.id, roomId));
    await this.afterWrite();
  }

  async listForUser(userId: string): Promise<CollabRoomRecord[]> {
    const rows = await this.context.drizzle
      .select({ room: collabRooms })
      .from(collabRoomMembers)
      .innerJoin(collabRooms, eq(collabRoomMembers.roomId, collabRooms.id))
      .where(
        and(eq(collabRoomMembers.userId, userId), isNull(collabRooms.endedAt)),
      )
      .orderBy(desc(collabRooms.createdAt));
    return rows.map((row) => row.room);
  }

  async findMember(
    roomId: string,
    userId: string,
  ): Promise<CollabRoomMemberRecord | null> {
    const rows = await this.context.drizzle
      .select()
      .from(collabRoomMembers)
      .where(
        and(
          eq(collabRoomMembers.roomId, roomId),
          eq(collabRoomMembers.userId, userId),
        ),
      )
      .limit(1);
    return rows[0] ?? null;
  }

  async addMember(input: {
    roomId: string;
    userId: string;
    roomRole: CollabRoomRole;
    addedBy: string | null;
  }): Promise<boolean> {
    if (await this.findMember(input.roomId, input.userId)) return false;
    await this.context.drizzle.insert(collabRoomMembers).values({
      roomId: input.roomId,
      userId: input.userId,
      roomRole: input.roomRole,
      addedBy: input.addedBy,
    });
    await this.afterWrite();
    return true;
  }

  async removeMember(roomId: string, userId: string): Promise<void> {
    await this.context.drizzle
      .delete(collabRoomMembers)
      .where(
        and(
          eq(collabRoomMembers.roomId, roomId),
          eq(collabRoomMembers.userId, userId),
        ),
      );
    await this.afterWrite();
  }

  async listMembers(roomId: string): Promise<CollabRoomMemberWithUser[]> {
    return this.context.drizzle
      .select({
        userId: collabRoomMembers.userId,
        username: users.username,
        roomRole: collabRoomMembers.roomRole,
        createdAt: collabRoomMembers.createdAt,
      })
      .from(collabRoomMembers)
      .innerJoin(users, eq(collabRoomMembers.userId, users.id))
      .where(eq(collabRoomMembers.roomId, roomId))
      .orderBy(users.username);
  }

  async updateStage(roomId: string, stage: CollabRoomStage): Promise<void> {
    await this.context.drizzle
      .update(collabRooms)
      .set(stage)
      .where(eq(collabRooms.id, roomId));
    await this.afterWrite();
  }

  async replaceStage(
    roomId: string,
    expectedShareId: string | null,
    stage: CollabRoomStage,
  ): Promise<boolean> {
    const result = await this.context.drizzle
      .update(collabRooms)
      .set(stage)
      .where(
        and(
          eq(collabRooms.id, roomId),
          expectedShareId
            ? eq(collabRooms.stageShareId, expectedShareId)
            : isNull(collabRooms.stageShareId),
        ),
      );
    const changed = rowsAffected(result) > 0;
    if (changed) await this.afterWrite();
    return changed;
  }

  async clearStage(roomId: string): Promise<void> {
    return this.updateStage(roomId, {
      presenterUserId: null,
      stageProtocol: null,
      stageHostId: null,
      stageShareId: null,
    });
  }

  async endRoom(roomId: string): Promise<void> {
    await this.context.drizzle
      .update(collabRooms)
      .set({
        endedAt: new Date().toISOString(),
        presenterUserId: null,
        stageProtocol: null,
        stageHostId: null,
        stageShareId: null,
      })
      .where(eq(collabRooms.id, roomId));
    await this.afterWrite();
  }

  async deleteRoom(roomId: string): Promise<void> {
    await this.context.drizzle
      .delete(collabRooms)
      .where(eq(collabRooms.id, roomId));
    await this.afterWrite();
  }

  private async afterWrite(): Promise<void> {
    await this.onWrite?.();
  }
}
