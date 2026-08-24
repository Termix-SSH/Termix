import crypto from "crypto";
import express, { type Request, type Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { sshLogger } from "../../utils/logger.js";
import {
  logAudit,
  getAuditUsername,
  getRequestMeta,
} from "../../utils/audit-logger.js";
import { GuacamoleTokenService } from "../guacamole/token-service.js";
import { collabRoomHub } from "./room-hub.js";
import { getStageController, setStageController } from "./stage-control.js";
import { sessionManager } from "../terminal/session-manager.js";
import {
  isLiveSession,
  isLiveSessionOwnedBy,
  isSharingEnabledForHost,
  type LiveProtocol,
} from "../session-sharing/live-sessions.js";
import {
  createCurrentCollabRoomRepository,
  createCurrentRoleRepository,
  createCurrentSessionShareRepository,
  createCurrentUserRepository,
} from "../../database/repositories/factory.js";
import type { CollabRoomRecord } from "../../database/repositories/collab-room-repository.js";

/*
 * Known limits, shared with session sharing v1:
 * - Room events and stage control live in this process (room-hub,
 *   stage-control). With more than one backend instance, members connected
 *   to different instances do not see each other's events.
 * - A guac viewer whose control was revoked keeps its current connection
 *   until it reconnects; guacamole-lite exposes no server-side kick.
 */
const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const tokenService = GuacamoleTokenService.getInstance();

const STAGE_SHARE_EXPIRY_HOURS = 12;
const PROTOCOLS: LiveProtocol[] = ["ssh", "rdp", "vnc", "telnet"];

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

async function requireRoomMember(
  roomId: string,
  userId: string,
): Promise<{ room: CollabRoomRecord; isHost: boolean } | null> {
  const repository = createCurrentCollabRoomRepository();
  const room = await repository.findById(roomId);
  if (!room || room.endedAt) return null;
  const member = await repository.findMember(roomId, userId);
  if (!member) return null;
  return { room, isHost: member.roomRole === "host" };
}

async function revokeStageShare(room: CollabRoomRecord): Promise<void> {
  if (!room.stageShareId) return;
  try {
    await createCurrentSessionShareRepository().revokeAsAdmin(
      room.stageShareId,
    );
  } catch {
    // A stale share must never block switching presenters.
  }
}

function stagePayload(room: CollabRoomRecord) {
  return {
    presenterUserId: room.presenterUserId,
    protocol: room.stageProtocol,
    hostId: room.stageHostId,
    shareId: room.stageShareId,
  };
}

/**
 * @openapi
 * /collab/rooms:
 *   post:
 *     summary: Create a collaboration room
 *     tags:
 *       - Collab
 */
router.post("/rooms", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId!;
  const { name, persistent } = req.body ?? {};

  if (!isNonEmptyString(name) || name.trim().length > 120) {
    return res.status(400).json({ error: "Room name is required" });
  }

  try {
    const repository = createCurrentCollabRoomRepository();
    const room = await repository.createRoom({
      id: crypto.randomUUID(),
      name: name.trim(),
      ownerUserId: userId,
      persistent: persistent === true,
    });
    await repository.addMember({
      roomId: room.id,
      userId,
      roomRole: "host",
      addedBy: userId,
    });

    const { ipAddress, userAgent } = getRequestMeta(req);
    await logAudit({
      userId,
      username: await getAuditUsername(userId),
      action: "collab_room_create",
      resourceType: "collab_room",
      resourceId: room.id,
      resourceName: room.name,
      ipAddress,
      userAgent,
      success: true,
    });

    res.json({ room });
  } catch (error) {
    sshLogger.error("Failed to create collab room", error, {
      operation: "collab_room_create_error",
    });
    res.status(500).json({ error: "Failed to create room" });
  }
});

/**
 * @openapi
 * /collab/rooms:
 *   get:
 *     summary: List rooms the caller belongs to
 *     tags:
 *       - Collab
 */
router.get("/rooms", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId!;
  try {
    const rooms = await createCurrentCollabRoomRepository().listForUser(userId);
    res.json({ rooms });
  } catch (error) {
    sshLogger.error("Failed to list collab rooms", error, {
      operation: "collab_room_list_error",
    });
    res.status(500).json({ error: "Failed to list rooms" });
  }
});

/**
 * @openapi
 * /collab/rooms/{id}:
 *   get:
 *     summary: Get a room with members, online users and stage state
 *     tags:
 *       - Collab
 */
router.get(
  "/rooms/:id",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      const members =
        await createCurrentCollabRoomRepository().listMembers(roomId);
      res.json({
        room: access.room,
        me: userId,
        isHost: access.isHost,
        members,
        online: collabRoomHub.onlineUsers(roomId),
        stage: stagePayload(access.room),
        controllerUserId: getStageController(roomId),
      });
    } catch (error) {
      sshLogger.error("Failed to get collab room", error, {
        operation: "collab_room_get_error",
      });
      res.status(500).json({ error: "Failed to get room" });
    }
  },
);

/**
 * @openapi
 * /collab/rooms/{id}/members:
 *   post:
 *     summary: Invite users to a room (host only)
 *     tags:
 *       - Collab
 */
router.post(
  "/rooms/:id/members",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    const { userIds = [], roleIds = [] } = req.body ?? {};

    if (
      !Array.isArray(userIds) ||
      userIds.some((id) => !isNonEmptyString(id)) ||
      !Array.isArray(roleIds) ||
      roleIds.some((id) => !Number.isInteger(id)) ||
      (userIds.length === 0 && roleIds.length === 0)
    ) {
      return res.status(400).json({
        error: "userIds (user ids) or roleIds (integers) are required",
      });
    }

    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      if (!access.isHost) {
        return res.status(403).json({ error: "Only the host can invite" });
      }

      const userRepository = createCurrentUserRepository();
      const repository = createCurrentCollabRoomRepository();
      for (const targetId of userIds as string[]) {
        if (!(await userRepository.findById(targetId))) {
          return res.status(404).json({ error: "User not found", targetId });
        }
      }
      // Roles expand to their current members - a snapshot, like folder
      // sharing; people joining the role later are not pulled in.
      const roleRepository = createCurrentRoleRepository();
      const expanded = new Set<string>(userIds as string[]);
      for (const roleId of roleIds as number[]) {
        if (!(await roleRepository.findRoleById(roleId))) {
          return res.status(404).json({ error: "Role not found", roleId });
        }
        for (const memberId of await roleRepository.listRoleUserIds(roleId)) {
          expanded.add(memberId);
        }
      }
      for (const targetId of expanded) {
        await repository.addMember({
          roomId,
          userId: targetId,
          roomRole: "member",
          addedBy: userId,
        });
      }

      collabRoomHub.broadcast(roomId, {
        type: "collab_members_changed",
        roomId,
      });
      res.json({ success: true });
    } catch (error) {
      sshLogger.error("Failed to invite collab room members", error, {
        operation: "collab_room_invite_error",
      });
      res.status(500).json({ error: "Failed to invite members" });
    }
  },
);

/**
 * @openapi
 * /collab/rooms/{id}/members/{userId}:
 *   delete:
 *     summary: Remove a member (host), or leave the room (self)
 *     tags:
 *       - Collab
 */
router.delete(
  "/rooms/:id/members/:userId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    const targetId = String(req.params.userId);

    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      if (targetId !== userId && !access.isHost) {
        return res
          .status(403)
          .json({ error: "Only the host can remove members" });
      }
      if (targetId === access.room.ownerUserId) {
        return res.status(400).json({ error: "The owner cannot be removed" });
      }

      const repository = createCurrentCollabRoomRepository();
      await repository.removeMember(roomId, targetId);

      if (getStageController(roomId) === targetId) {
        await applyStageControl(access.room, roomId, null);
      }

      if (access.room.presenterUserId === targetId) {
        await revokeStageShare(access.room);
        await repository.clearStage(roomId);
        collabRoomHub.broadcast(roomId, {
          type: "collab_stage_changed",
          roomId,
          stage: null,
        });
      }

      collabRoomHub.broadcast(roomId, {
        type: "collab_members_changed",
        roomId,
      });
      res.json({ success: true });
    } catch (error) {
      sshLogger.error("Failed to remove collab room member", error, {
        operation: "collab_room_remove_member_error",
      });
      res.status(500).json({ error: "Failed to remove member" });
    }
  },
);

/**
 * @openapi
 * /collab/rooms/{id}/present:
 *   post:
 *     summary: Take the stage with one of your live sessions
 *     description: Any member may take over the stage; the previous stage share is revoked. The caller must own the live session and sharing must be enabled for the host.
 *     tags:
 *       - Collab
 */
router.post(
  "/rooms/:id/present",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    const { protocol, sessionId, hostId } = req.body ?? {};

    if (!PROTOCOLS.includes(protocol)) {
      return res.status(400).json({ error: "Invalid protocol" });
    }
    if (!isNonEmptyString(sessionId) || !Number.isInteger(Number(hostId))) {
      return res
        .status(400)
        .json({ error: "sessionId and hostId are required" });
    }

    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }

      const numericHostId = Number(hostId);
      const { enabled } = await isSharingEnabledForHost(numericHostId);
      if (!enabled) {
        return res
          .status(403)
          .json({ error: "Session sharing is disabled for this host" });
      }
      if (!isLiveSessionOwnedBy(protocol, String(sessionId), userId)) {
        return res
          .status(403)
          .json({ error: "You do not own this live session" });
      }

      const shareRepository = createCurrentSessionShareRepository();
      const share = await shareRepository.create({
        id: crypto.randomUUID(),
        hostId: numericHostId,
        ownerUserId: userId,
        protocol,
        sessionId: String(sessionId),
        shareType: "room",
        permissionLevel: "read-only",
        expiresAt: new Date(
          Date.now() + STAGE_SHARE_EXPIRY_HOURS * 60 * 60 * 1000,
        ).toISOString(),
      });

      await revokeStageShare(access.room);
      setStageController(roomId, null);
      const repository = createCurrentCollabRoomRepository();
      await repository.updateStage(roomId, {
        presenterUserId: userId,
        stageProtocol: protocol,
        stageHostId: numericHostId,
        stageShareId: share.id,
      });

      const stage = {
        presenterUserId: userId,
        protocol,
        hostId: numericHostId,
        shareId: share.id,
      };
      collabRoomHub.broadcast(roomId, {
        type: "collab_stage_changed",
        roomId,
        stage,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "collab_room_present",
        resourceType: "collab_room",
        resourceId: roomId,
        resourceName: access.room.name,
        details: JSON.stringify({ protocol, hostId: numericHostId }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({ stage });
    } catch (error) {
      sshLogger.error("Failed to take collab room stage", error, {
        operation: "collab_room_present_error",
      });
      res.status(500).json({ error: "Failed to start presenting" });
    }
  },
);

/**
 * @openapi
 * /collab/rooms/{id}/stop:
 *   post:
 *     summary: Stop presenting (presenter or host)
 *     tags:
 *       - Collab
 */
router.post(
  "/rooms/:id/stop",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      if (access.room.presenterUserId !== userId && !access.isHost) {
        return res
          .status(403)
          .json({ error: "Only the presenter or host can stop the stage" });
      }

      await revokeStageShare(access.room);
      setStageController(roomId, null);
      await createCurrentCollabRoomRepository().clearStage(roomId);
      collabRoomHub.broadcast(roomId, {
        type: "collab_stage_changed",
        roomId,
        stage: null,
      });
      res.json({ success: true });
    } catch (error) {
      sshLogger.error("Failed to stop collab room stage", error, {
        operation: "collab_room_stop_error",
      });
      res.status(500).json({ error: "Failed to stop presenting" });
    }
  },
);

/**
 * @openapi
 * /collab/rooms/{id}/stage:
 *   get:
 *     summary: Get connect info for the current stage (members only)
 *     description: SSH stages are joined over the terminal WS by shareId; guac stages get a freshly minted read-only join token.
 *     tags:
 *       - Collab
 */
router.get(
  "/rooms/:id/stage",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      const { room } = access;
      if (!room.stageShareId || !room.stageProtocol) {
        return res.json({ stage: null });
      }

      const share = await createCurrentSessionShareRepository().findActiveById(
        room.stageShareId,
      );
      const protocol = room.stageProtocol as LiveProtocol;
      if (!share || !isLiveSession(protocol, share.sessionId)) {
        // The presenter is gone (expired share or dead session): clear the
        // stale stage so the room stops pointing at it.
        setStageController(roomId, null);
        await createCurrentCollabRoomRepository().clearStage(roomId);
        collabRoomHub.broadcast(roomId, {
          type: "collab_stage_changed",
          roomId,
          stage: null,
        });
        return res.json({ stage: null });
      }

      const controllerUserId = getStageController(roomId);
      const stage: Record<string, unknown> = {
        ...stagePayload(room),
        sessionId: share.sessionId,
        controllerUserId,
      };
      if (protocol !== "ssh") {
        stage.connectParams = {
          token: tokenService.createJoinToken(
            share.sessionId,
            controllerUserId !== userId,
          ),
        };
      }
      res.json({ stage });
    } catch (error) {
      sshLogger.error("Failed to resolve collab room stage", error, {
        operation: "collab_room_stage_error",
      });
      res.status(500).json({ error: "Failed to resolve stage" });
    }
  },
);

/** Sets the controller everywhere it lives: memory, live SSH gate, hub. */
async function applyStageControl(
  room: CollabRoomRecord,
  roomId: string,
  controllerUserId: string | null,
): Promise<void> {
  setStageController(roomId, controllerUserId);
  if (room.stageShareId && room.stageProtocol === "ssh") {
    try {
      const share = await createCurrentSessionShareRepository().findActiveById(
        room.stageShareId,
      );
      if (share) {
        sessionManager.setRoomShareControl(
          share.sessionId,
          share.id,
          controllerUserId,
        );
      }
    } catch {
      // The gate keeps its previous state; the broadcast still lands.
    }
  }
  collabRoomHub.broadcast(roomId, {
    type: "collab_control_changed",
    roomId,
    controllerUserId,
  });
}

/**
 * @openapi
 * /collab/rooms/{id}/control:
 *   post:
 *     summary: Grant or revoke stage control (presenter or host)
 *     description: Grants a member write access to the current stage, or revokes it with a null userId. The controller may also release control themselves.
 *     tags:
 *       - Collab
 */
router.post(
  "/rooms/:id/control",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    const { userId: targetId } = req.body ?? {};

    if (targetId !== null && !isNonEmptyString(targetId)) {
      return res
        .status(400)
        .json({ error: "userId must be a user id or null" });
    }

    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      if (!access.room.stageShareId) {
        return res.status(400).json({ error: "Nothing is being presented" });
      }

      const releasingOwnControl =
        targetId === null && getStageController(roomId) === userId;
      const mayGrant = access.isHost || access.room.presenterUserId === userId;
      if (!mayGrant && !releasingOwnControl) {
        return res.status(403).json({
          error: "Only the presenter or host can change stage control",
        });
      }

      if (targetId) {
        const repository = createCurrentCollabRoomRepository();
        if (!(await repository.findMember(roomId, targetId))) {
          return res.status(404).json({ error: "Member not found" });
        }
      }

      await applyStageControl(access.room, roomId, targetId);
      res.json({ controllerUserId: targetId });
    } catch (error) {
      sshLogger.error("Failed to change collab stage control", error, {
        operation: "collab_control_error",
      });
      res.status(500).json({ error: "Failed to change stage control" });
    }
  },
);

/**
 * @openapi
 * /collab/rooms/{id}/control/request:
 *   post:
 *     summary: Ask the presenter for stage control (hand raise)
 *     tags:
 *       - Collab
 */
router.post(
  "/rooms/:id/control/request",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      if (!access.room.stageShareId) {
        return res.status(400).json({ error: "Nothing is being presented" });
      }
      collabRoomHub.broadcast(roomId, {
        type: "collab_control_requested",
        roomId,
        userId,
        username: await getAuditUsername(userId),
      });
      res.json({ success: true });
    } catch (error) {
      sshLogger.error("Failed to request collab stage control", error, {
        operation: "collab_control_request_error",
      });
      res.status(500).json({ error: "Failed to request control" });
    }
  },
);

/**
 * @openapi
 * /collab/rooms/{id}/guest-link:
 *   post:
 *     summary: Enable, rotate or disable the room's anonymous guest link (host only)
 *     tags:
 *       - Collab
 */
router.post(
  "/rooms/:id/guest-link",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      return res.status(400).json({ error: "enabled must be a boolean" });
    }
    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      if (!access.isHost) {
        return res
          .status(403)
          .json({ error: "Only the host can manage the guest link" });
      }
      const token = enabled
        ? crypto.randomBytes(24).toString("base64url")
        : null;
      await createCurrentCollabRoomRepository().setGuestToken(roomId, token);

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: enabled
          ? "collab_guest_link_enable"
          : "collab_guest_link_disable",
        resourceType: "collab_room",
        resourceId: roomId,
        resourceName: access.room.name,
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ guestLinkToken: token });
    } catch (error) {
      sshLogger.error("Failed to update collab guest link", error, {
        operation: "collab_guest_link_error",
      });
      res.status(500).json({ error: "Failed to update guest link" });
    }
  },
);

const GUEST_WINDOW_MS = 60 * 1000;
const GUEST_MAX_ATTEMPTS = 60;
const guestAttempts = new Map<string, { count: number; windowStart: number }>();

function isGuestRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = guestAttempts.get(ip);
  if (!entry || now - entry.windowStart > GUEST_WINDOW_MS) {
    guestAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > GUEST_MAX_ATTEMPTS;
}

setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of guestAttempts) {
    if (now - entry.windowStart > GUEST_WINDOW_MS) guestAttempts.delete(ip);
  }
}, 5 * GUEST_WINDOW_MS).unref();

/**
 * @openapi
 * /collab/guest/{token}:
 *   get:
 *     summary: Resolve a room's current stage for an anonymous guest
 *     description: Public, rate-limited per IP. Guests poll this to follow presenter switches. Never returns host details; SSH stages are joined over the terminal WS with roomGuestToken, guac stages get a read-only join token.
 *     tags:
 *       - Collab
 */
router.get("/guest/:token", async (req: Request, res: Response) => {
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  if (isGuestRateLimited(ip)) {
    return res.status(429).json({ error: "Too many requests" });
  }
  const token = String(req.params.token);
  try {
    const room =
      await createCurrentCollabRoomRepository().findByGuestToken(token);
    if (!room) {
      return res.status(404).json({ error: "Link not found" });
    }
    const response: Record<string, unknown> = {
      roomName: room.name,
      stage: null,
    };
    if (room.stageShareId && room.stageProtocol) {
      const share = await createCurrentSessionShareRepository().findActiveById(
        room.stageShareId,
      );
      const protocol = room.stageProtocol as LiveProtocol;
      if (share && isLiveSession(protocol, share.sessionId)) {
        const { enabled } = await isSharingEnabledForHost(share.hostId);
        if (enabled) {
          response.stage = {
            protocol,
            shareId: share.id,
            ...(protocol === "ssh"
              ? {
                  wsPath: `/terminal/ws?roomGuestToken=${encodeURIComponent(token)}`,
                }
              : {
                  connectParams: {
                    token: tokenService.createJoinToken(share.sessionId, true),
                  },
                }),
          };
        }
      }
    }
    res.json(response);
  } catch (error) {
    sshLogger.error("Failed to resolve collab guest link", error, {
      operation: "collab_guest_resolve_error",
    });
    res.status(500).json({ error: "Failed to resolve guest link" });
  }
});

/**
 * @openapi
 * /collab/rooms/{id}/end:
 *   post:
 *     summary: End the meeting (host only)
 *     description: Clears the stage. One-off rooms are ended for good; persistent rooms stay listed for reuse.
 *     tags:
 *       - Collab
 */
router.post(
  "/rooms/:id/end",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId!;
    const roomId = String(req.params.id);
    try {
      const access = await requireRoomMember(roomId, userId);
      if (!access) {
        return res.status(404).json({ error: "Room not found" });
      }
      if (!access.isHost) {
        return res
          .status(403)
          .json({ error: "Only the host can end the room" });
      }

      await revokeStageShare(access.room);
      setStageController(roomId, null);
      const repository = createCurrentCollabRoomRepository();
      if (access.room.persistent) {
        await repository.clearStage(roomId);
        collabRoomHub.broadcast(roomId, {
          type: "collab_stage_changed",
          roomId,
          stage: null,
        });
      } else {
        await repository.endRoom(roomId);
        collabRoomHub.broadcast(roomId, { type: "collab_room_ended", roomId });
      }

      const { ipAddress, userAgent } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "collab_room_end",
        resourceType: "collab_room",
        resourceId: roomId,
        resourceName: access.room.name,
        ipAddress,
        userAgent,
        success: true,
      });
      res.json({ success: true });
    } catch (error) {
      sshLogger.error("Failed to end collab room", error, {
        operation: "collab_room_end_error",
      });
      res.status(500).json({ error: "Failed to end room" });
    }
  },
);

export default router;
