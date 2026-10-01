import {
  adoptLegacyTable,
  boolean,
  defineTable,
  id,
  integer,
  refHost,
  refUser,
  text,
  timestamp,
  varchar,
} from "@termix/plugin-sdk/db";

/*
 * Adopted from core's session_shares, session_share_participants,
 * collab_rooms and collab_room_members, so column and index names are the
 * legacy ones and the rename carries every row across.
 *
 * Columns that point at a user or host but may be null or set null on delete,
 * and the links between these four tables, are plain columns here: the SDK
 * only references users and ssh_data, cascading. The adoption migrations keep
 * the legacy FOREIGN KEY clauses by hand, as fleets does.
 */

/**
 * A grant to join one live session: a link for anonymous guests, a user, or
 * a collab room's stage ("room").
 */
export const shares = adoptLegacyTable(
  "session_shares",
  defineTable(
    "shares",
    {
      id: varchar().primaryKey(),
      hostId: refHost(),
      ownerUserId: refUser(),
      protocol: text().notNull(),
      // The terminal's session id for SSH, guacd's connection id otherwise.
      // Neither is a row, so there is no foreign key.
      sessionId: varchar().notNull(),
      tabInstanceId: text(),
      shareType: text().notNull(),
      targetUserId: varchar(),
      linkToken: varchar().unique(),
      permissionLevel: text().notNull().default("read-only"),
      createdAt: timestamp().notNull().defaultNow(),
      expiresAt: text().notNull(),
      revokedAt: text(),
      lastJoinedAt: text(),
      joinCount: integer().notNull().default(0),
    },
    {
      indexes: [
        { name: "idx_session_shares_session_id", columns: ["sessionId"] },
        { name: "idx_session_shares_host_id", columns: ["hostId"] },
      ],
    },
  ),
);

/** Who joined through a share, for the owner's record. */
export const shareParticipants = adoptLegacyTable(
  "session_share_participants",
  defineTable("share_participants", {
    id: id(),
    shareId: varchar().notNull(),
    userId: varchar(),
    guestLabel: text(),
    joinedAt: timestamp().notNull().defaultNow(),
    leftAt: text(),
  }),
);

/**
 * A collaboration room: members watching one stage, the live session the
 * current presenter shows through a "room" share.
 */
export const rooms = adoptLegacyTable(
  "collab_rooms",
  defineTable(
    "rooms",
    {
      id: varchar().primaryKey(),
      name: text().notNull(),
      ownerUserId: refUser(),
      persistent: boolean().notNull().default(false),
      presenterUserId: varchar(),
      stageProtocol: text(),
      stageHostId: integer(),
      stageShareId: varchar(),
      guestLinkToken: varchar(),
      createdAt: timestamp().notNull().defaultNow(),
      endedAt: text(),
    },
    {
      indexes: [{ name: "idx_collab_rooms_owner", columns: ["ownerUserId"] }],
      uniques: [
        { name: "idx_collab_rooms_guest_token", columns: ["guestLinkToken"] },
      ],
    },
  ),
);

export const roomMembers = adoptLegacyTable(
  "collab_room_members",
  defineTable(
    "room_members",
    {
      id: id(),
      roomId: varchar().notNull(),
      userId: refUser(),
      roomRole: text().notNull().default("member"),
      addedBy: varchar(),
      createdAt: timestamp().notNull().defaultNow(),
    },
    {
      uniques: [
        {
          name: "idx_collab_room_members_room_user",
          columns: ["roomId", "userId"],
        },
      ],
      indexes: [{ name: "idx_collab_room_members_user", columns: ["userId"] }],
    },
  ),
);

export const tables = [shares, shareParticipants, rooms, roomMembers];
