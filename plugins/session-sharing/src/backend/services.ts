import type { WebSocket } from "ws";
import type { SharingDeps } from "./deps.js";
import type { ShareRecord } from "./repositories.js";

/**
 * What the terminal consumes. The shapes match
 * plugins/ssh-terminal/src/backend/services.ts, which is the consumer's copy.
 */
export interface SharedSessionRef {
  id: string;
  sessionId: string;
  permissionLevel: "read-write" | "read-only";
}

/** sessions.sharing v1: signed-in joins. Every call runs as the acting user. */
export interface SessionSharingV1 {
  authorizeJoin: (
    shareId: string,
  ) => Promise<{ share: SharedSessionRef; displayName: string } | null>;
  recordJoin: (shareId: string) => Promise<void>;
  subscribeRoom: (roomId: string, socket: unknown) => Promise<boolean>;
  unsubscribeRoom: (socket: unknown, roomId?: string) => Promise<void>;
}

/**
 * Guest joins through a share link or a room guest link, on ctx.registry as
 * SESSION_GUESTS_KEY. A guest has no user, so a service's per-call
 * permission check cannot apply: the token is the authority.
 */
export interface SessionGuestsV1 {
  resolve: (request: {
    shareToken?: string;
    roomGuestToken?: string;
    clientIp: string;
  }) => Promise<
    { ok: true; share: SharedSessionRef } | { ok: false; reason: string }
  >;
  recordJoin: (shareId: string) => Promise<void>;
}

export const SESSION_GUESTS_KEY = "sessions.sharing.guests";

function toRef(share: ShareRecord): SharedSessionRef {
  return {
    id: share.id,
    sessionId: share.sessionId,
    permissionLevel:
      share.permissionLevel === "read-write" ? "read-write" : "read-only",
  };
}

export function createSessionSharingService(
  deps: SharingDeps,
): SessionSharingV1 {
  const { ctx, shares, rooms, directory, hub } = deps;

  return {
    async authorizeJoin(shareId) {
      const userId = ctx.currentActor();
      if (!userId) return null;
      const share = await shares.findActiveById(shareId);
      if (!share || share.protocol !== "ssh") return null;

      if (share.shareType === "user") {
        // A user share needs its target, who can still reach the host.
        if (share.targetUserId !== userId) return null;
        const access = await ctx.hosts.checkAccess(share.hostId, "connect");
        if (!access.hasAccess) return null;
      } else if (share.shareType === "room") {
        // Room membership is the authorization for a room stage: it is
        // read-only and never exposes host credentials or config.
        const room = await rooms.findByStageShareId(share.id);
        if (!room || !(await rooms.findMember(room.id, userId))) return null;
      } else {
        return null;
      }

      return {
        share: toRef(share),
        displayName: await directory.username(userId),
      };
    },

    async recordJoin(shareId) {
      const userId = ctx.currentActor() ?? null;
      await shares.touchUsage(shareId);
      await shares.recordParticipantJoin(shareId, userId, null);
    },

    async subscribeRoom(roomId, socket) {
      const userId = ctx.currentActor();
      if (!userId) return false;
      const room = await rooms.findById(roomId);
      if (!room || room.endedAt) return false;
      if (!(await rooms.findMember(roomId, userId))) return false;
      hub.subscribe(roomId, {
        ws: socket as WebSocket,
        userId,
        username: await directory.username(userId),
      });
      return true;
    },

    async unsubscribeRoom(socket, roomId) {
      hub.unsubscribe(socket as WebSocket, roomId);
    },
  };
}

export function createSessionGuests(deps: SharingDeps): SessionGuestsV1 {
  const { shares, rooms, guestLimiter } = deps;

  /** Sharing still allowed, and an SSH share: the only kind the socket joins. */
  async function joinable(
    share: ShareRecord,
  ): Promise<
    { ok: true; share: SharedSessionRef } | { ok: false; reason: string }
  > {
    if (share.protocol !== "ssh") {
      return { ok: false, reason: "Unsupported share protocol" };
    }
    if (!(await deps.isSharingEnabledForHost(share.hostId))) {
      return { ok: false, reason: "Session sharing is disabled for this host" };
    }
    return { ok: true, share: toRef(share) };
  }

  return {
    async resolve({ shareToken, roomGuestToken, clientIp }) {
      if (shareToken) {
        // Guessing link tokens is limited the same way room tokens are.
        if (guestLimiter.isLimited(clientIp)) {
          return { ok: false, reason: "Too many requests" };
        }
        const share = await shares.findByLinkToken(shareToken);
        if (!share || share.shareType !== "link") {
          return { ok: false, reason: "Invalid or expired share link" };
        }
        return joinable(share);
      }

      if (roomGuestToken) {
        if (guestLimiter.isLimited(clientIp)) {
          return { ok: false, reason: "Too many requests" };
        }
        const room = await rooms.findByGuestToken(roomGuestToken);
        const share = room?.stageShareId
          ? await shares.findActiveById(room.stageShareId)
          : null;
        if (!share) return { ok: false, reason: "Nothing is being presented" };
        return joinable(share);
      }

      return { ok: false, reason: "Authentication required" };
    },

    async recordJoin(shareId) {
      await shares.touchUsage(shareId);
      await shares.recordParticipantJoin(shareId, null, "Guest");
    },
  };
}
