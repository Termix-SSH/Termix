import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import type { PluginDatabase } from "@termix/plugin-sdk/backend";

/* eslint-disable @typescript-eslint/no-explicit-any */
// Tables come from ctx.db.define, which the SDK hands back untyped, and the
// drizzle handle is the server's own. Typed at this module's edge instead.
type Table = any;
type Drizzle = any;
/* eslint-enable @typescript-eslint/no-explicit-any */

export type ShareType = "link" | "user" | "room";
export type PermissionLevel = "read-only" | "read-write";
export type LiveProtocol = "ssh" | "rdp" | "vnc" | "telnet";

export interface ShareRecord {
  id: string;
  hostId: number;
  ownerUserId: string;
  protocol: string;
  sessionId: string;
  tabInstanceId: string | null;
  shareType: string;
  targetUserId: string | null;
  linkToken: string | null;
  permissionLevel: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastJoinedAt: string | null;
  joinCount: number;
}

export interface ShareCreateInput {
  id: string;
  hostId: number;
  ownerUserId: string;
  protocol: string;
  sessionId: string;
  tabInstanceId?: string | null;
  shareType: ShareType;
  targetUserId?: string | null;
  linkToken?: string | null;
  permissionLevel: PermissionLevel;
  expiresAt: string;
}

export interface RoomRecord {
  id: string;
  name: string;
  ownerUserId: string;
  persistent: boolean;
  presenterUserId: string | null;
  stageProtocol: string | null;
  stageHostId: number | null;
  stageShareId: string | null;
  guestLinkToken: string | null;
  createdAt: string;
  endedAt: string | null;
}

export interface RoomMemberRecord {
  id: number;
  roomId: string;
  userId: string;
  roomRole: string;
  addedBy: string | null;
  createdAt: string;
}

export interface RoomMemberWithUser {
  userId: string;
  username: string;
  roomRole: string;
  createdAt: string;
}

export interface RoomStage {
  presenterUserId: string | null;
  stageProtocol: string | null;
  stageHostId: number | null;
  stageShareId: string | null;
}

export interface Tables {
  shares: Table;
  participants: Table;
  rooms: Table;
  members: Table;
}

export interface CoreRefs {
  users: Table;
  hosts: Table;
  roles: Table;
  userRoles: Table;
}

const nowIso = () => new Date().toISOString();

/** Not revoked and not expired. Expiry is compared as ISO text, as before. */
function activeShare(shares: Table, now: string) {
  return and(isNull(shares.revokedAt), gt(shares.expiresAt, now));
}

export type ShareRepository = ReturnType<typeof createShareRepository>;

export function createShareRepository(db: PluginDatabase, tables: Tables) {
  const client = () => db.client<Drizzle>();
  const { shares, participants } = tables;

  async function findById(id: string): Promise<ShareRecord | null> {
    const rows = await (
      await client()
    )
      .select()
      .from(shares)
      .where(eq(shares.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  return {
    findById,

    async create(input: ShareCreateInput): Promise<ShareRecord> {
      await (await client()).insert(shares).values({
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
      });
      await db.persist();
      return (await findById(input.id))!;
    },

    async findActiveById(
      id: string,
      now = nowIso(),
    ): Promise<ShareRecord | null> {
      const rows = await (
        await client()
      )
        .select()
        .from(shares)
        .where(and(eq(shares.id, id), activeShare(shares, now)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByLinkToken(
      linkToken: string,
      now = nowIso(),
    ): Promise<ShareRecord | null> {
      const rows = await (
        await client()
      )
        .select()
        .from(shares)
        .where(and(eq(shares.linkToken, linkToken), activeShare(shares, now)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findActiveSharesForHost(
      hostId: number,
      ownerUserId: string,
      now = nowIso(),
    ): Promise<ShareRecord[]> {
      return (await client())
        .select()
        .from(shares)
        .where(
          and(
            eq(shares.hostId, hostId),
            eq(shares.ownerUserId, ownerUserId),
            activeShare(shares, now),
          ),
        );
    },

    /** Active user shares aimed at this user. */
    async findSharesTargetingUser(
      userId: string,
      now = nowIso(),
    ): Promise<ShareRecord[]> {
      return (await client())
        .select()
        .from(shares)
        .where(
          and(
            eq(shares.shareType, "user"),
            eq(shares.targetUserId, userId),
            activeShare(shares, now),
          ),
        );
    },

    /** Revokes a share the given user owns. False when it is not theirs. */
    async revoke(shareId: string, ownerUserId: string): Promise<boolean> {
      const share = await findById(shareId);
      if (!share || share.ownerUserId !== ownerUserId) return false;
      await (
        await client()
      )
        .update(shares)
        .set({ revokedAt: nowIso() })
        .where(eq(shares.id, shareId));
      await db.persist();
      return true;
    },

    async revokeAny(shareId: string): Promise<boolean> {
      if (!(await findById(shareId))) return false;
      await (
        await client()
      )
        .update(shares)
        .set({ revokedAt: nowIso() })
        .where(eq(shares.id, shareId));
      await db.persist();
      return true;
    },

    async touchUsage(shareId: string): Promise<void> {
      const current = await findById(shareId);
      if (!current) return;
      await (
        await client()
      )
        .update(shares)
        .set({
          lastJoinedAt: nowIso(),
          joinCount: (current.joinCount ?? 0) + 1,
        })
        .where(eq(shares.id, shareId));
      await db.persist();
    },

    async recordParticipantJoin(
      shareId: string,
      userId: string | null,
      guestLabel: string | null,
    ): Promise<void> {
      await (
        await client()
      )
        .insert(participants)
        .values({ shareId, userId, guestLabel });
      await db.persist();
    },
  };
}

export type RoomRepository = ReturnType<typeof createRoomRepository>;

export function createRoomRepository(
  db: PluginDatabase,
  tables: Tables,
  refs: () => Promise<CoreRefs>,
) {
  const client = () => db.client<Drizzle>();
  const { rooms, members } = tables;

  async function findById(id: string): Promise<RoomRecord | null> {
    const rows = await (
      await client()
    )
      .select()
      .from(rooms)
      .where(eq(rooms.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async function findMember(
    roomId: string,
    userId: string,
  ): Promise<RoomMemberRecord | null> {
    const rows = await (
      await client()
    )
      .select()
      .from(members)
      .where(and(eq(members.roomId, roomId), eq(members.userId, userId)))
      .limit(1);
    return rows[0] ?? null;
  }

  async function updateStage(roomId: string, stage: RoomStage): Promise<void> {
    await (await client()).update(rooms).set(stage).where(eq(rooms.id, roomId));
    await db.persist();
  }

  return {
    findById,
    findMember,
    updateStage,

    async createRoom(input: {
      id: string;
      name: string;
      ownerUserId: string;
      persistent: boolean;
    }): Promise<RoomRecord> {
      await (await client()).insert(rooms).values(input);
      await db.persist();
      return (await findById(input.id))!;
    },

    /** The live room whose stage points at this share, if any. */
    async findByStageShareId(shareId: string): Promise<RoomRecord | null> {
      const rows = await (
        await client()
      )
        .select()
        .from(rooms)
        .where(and(eq(rooms.stageShareId, shareId), isNull(rooms.endedAt)))
        .limit(1);
      return rows[0] ?? null;
    },

    async findByGuestToken(token: string): Promise<RoomRecord | null> {
      const rows = await (
        await client()
      )
        .select()
        .from(rooms)
        .where(and(eq(rooms.guestLinkToken, token), isNull(rooms.endedAt)))
        .limit(1);
      return rows[0] ?? null;
    },

    async setGuestToken(roomId: string, token: string | null): Promise<void> {
      await (
        await client()
      )
        .update(rooms)
        .set({ guestLinkToken: token })
        .where(eq(rooms.id, roomId));
      await db.persist();
    },

    async listForUser(userId: string): Promise<RoomRecord[]> {
      const rows = await (
        await client()
      )
        .select({ room: rooms })
        .from(members)
        .innerJoin(rooms, eq(members.roomId, rooms.id))
        .where(and(eq(members.userId, userId), isNull(rooms.endedAt)))
        .orderBy(desc(rooms.createdAt));
      return rows.map((row: { room: RoomRecord }) => row.room);
    },

    async addMember(input: {
      roomId: string;
      userId: string;
      roomRole: "host" | "member";
      addedBy: string | null;
    }): Promise<boolean> {
      if (await findMember(input.roomId, input.userId)) return false;
      await (await client()).insert(members).values(input);
      await db.persist();
      return true;
    },

    async removeMember(roomId: string, userId: string): Promise<void> {
      await (
        await client()
      )
        .delete(members)
        .where(and(eq(members.roomId, roomId), eq(members.userId, userId)));
      await db.persist();
    },

    async listMembers(roomId: string): Promise<RoomMemberWithUser[]> {
      const rows: RoomMemberRecord[] = await (
        await client()
      )
        .select()
        .from(members)
        .where(eq(members.roomId, roomId));
      const names = await usernames(rows.map((row) => row.userId));
      return rows
        .filter((row) => names.has(row.userId))
        .map((row) => ({
          userId: row.userId,
          username: names.get(row.userId)!,
          roomRole: row.roomRole,
          createdAt: row.createdAt,
        }))
        .sort((a, b) => a.username.localeCompare(b.username));
    },

    /**
     * Sets the stage only if it still points at `expectedShareId`, so two
     * members taking the stage at once cannot both win.
     */
    async replaceStage(
      roomId: string,
      expectedShareId: string | null,
      stage: RoomStage,
    ): Promise<boolean> {
      await (
        await client()
      )
        .update(rooms)
        .set(stage)
        .where(
          and(
            eq(rooms.id, roomId),
            expectedShareId
              ? eq(rooms.stageShareId, expectedShareId)
              : isNull(rooms.stageShareId),
          ),
        );
      const after = await findById(roomId);
      const changed = !!after && after.stageShareId === stage.stageShareId;
      if (changed) await db.persist();
      return changed;
    },

    async clearStage(roomId: string): Promise<void> {
      await updateStage(roomId, {
        presenterUserId: null,
        stageProtocol: null,
        stageHostId: null,
        stageShareId: null,
      });
    },

    async endRoom(roomId: string): Promise<void> {
      await (
        await client()
      )
        .update(rooms)
        .set({
          endedAt: nowIso(),
          presenterUserId: null,
          stageProtocol: null,
          stageHostId: null,
          stageShareId: null,
        })
        .where(eq(rooms.id, roomId));
      await db.persist();
    },

    async deleteRoom(roomId: string): Promise<void> {
      const drizzle = await client();
      // Not left to the foreign key: SQLite only cascades with foreign_keys on.
      await drizzle.delete(members).where(eq(members.roomId, roomId));
      await drizzle.delete(rooms).where(eq(rooms.id, roomId));
      await db.persist();
    },
  };

  async function usernames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const { users } = await refs();
    const rows: Array<{ id: string; username: string }> = await (
      await client()
    )
      .select({ id: users.id, username: users.username })
      .from(users)
      .where(inArray(users.id, ids));
    return new Map(rows.map((row) => [row.id, row.username]));
  }
}

export type Directory = ReturnType<typeof createDirectory>;

/** Users and roles, read through ctx.db.refs, for names and invites. */
export function createDirectory(
  db: PluginDatabase,
  refs: () => Promise<CoreRefs>,
) {
  const client = () => db.client<Drizzle>();

  return {
    async username(userId: string): Promise<string> {
      const { users } = await refs();
      const rows = await (
        await client()
      )
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows[0]?.username ?? userId;
    },

    async userExists(userId: string): Promise<boolean> {
      const { users } = await refs();
      const rows = await (
        await client()
      )
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return rows.length > 0;
    },

    async isAdmin(userId: string): Promise<boolean> {
      const { users } = await refs();
      const rows = await (
        await client()
      )
        .select({ isAdmin: users.isAdmin })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return !!rows[0]?.isAdmin;
    },

    async hostExists(hostId: number): Promise<boolean> {
      const { hosts } = await refs();
      const rows = await (
        await client()
      )
        .select({ id: hosts.id })
        .from(hosts)
        .where(eq(hosts.id, hostId))
        .limit(1);
      return rows.length > 0;
    },

    async roleExists(roleId: number): Promise<boolean> {
      const { roles } = await refs();
      const rows = await (
        await client()
      )
        .select({ id: roles.id })
        .from(roles)
        .where(eq(roles.id, roleId))
        .limit(1);
      return rows.length > 0;
    },

    async roleUserIds(roleId: number): Promise<string[]> {
      const { userRoles } = await refs();
      const rows: Array<{ userId: string }> = await (
        await client()
      )
        .select({ userId: userRoles.userId })
        .from(userRoles)
        .where(eq(userRoles.roleId, roleId));
      return rows.map((row) => row.userId);
    },

    async listUsers(): Promise<Array<{ id: string; username: string }>> {
      const { users } = await refs();
      return (await client())
        .select({ id: users.id, username: users.username })
        .from(users)
        .orderBy(users.username);
    },

    async listRoles(): Promise<
      Array<{ id: number; name: string; displayName: string | null }>
    > {
      const { roles } = await refs();
      return (await client())
        .select({
          id: roles.id,
          name: roles.name,
          displayName: roles.displayName,
        })
        .from(roles)
        .orderBy(roles.name);
    },
  };
}
