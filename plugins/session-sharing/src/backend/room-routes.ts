import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import {
  PROTOCOLS,
  TERMINAL_WS_PATH,
  actorOf,
  clientIp,
  isNonEmptyString,
  type SharingDeps,
} from "./deps.js";
import type { LiveProtocol, RoomRecord } from "./repositories.js";
import type { CollabControlRequest } from "./runtime-store.js";

/*
 * Known limits, shared with session sharing:
 * - Redis synchronizes collaboration events and ephemeral state across
 *   instances, but live session transports still need WebSocket affinity.
 * - Remote desktop stages stay read-only because guacamole-lite cannot revoke
 *   a writable viewer without disconnecting the whole shared session.
 */

const STAGE_SHARE_EXPIRY_HOURS = 12;
const MAX_INVITE_TARGETS = 200;
const CONTROL_REQUEST_COOLDOWN_MS = 5000;

function publicRoom(room: RoomRecord) {
  const { guestLinkToken: secret, ...safeRoom } = room;
  return { ...safeRoom, guestLinkEnabled: Boolean(secret) };
}

function stagePayload(room: RoomRecord) {
  return {
    presenterUserId: room.presenterUserId,
    protocol: room.stageProtocol,
    hostId: room.stageHostId,
    shareId: room.stageShareId,
  };
}

/** The pieces of room behaviour the routes and the runtime events share. */
export function createRoomActions(deps: SharingDeps) {
  const { shares, rooms, live, hub, store } = deps;

  async function requireRoomMember(
    roomId: string,
    userId: string,
  ): Promise<{ room: RoomRecord; isHost: boolean } | null> {
    const room = await rooms.findById(roomId);
    if (!room || room.endedAt) return null;
    const member = await rooms.findMember(roomId, userId);
    if (!member) return null;
    return { room, isHost: member.roomRole === "host" };
  }

  async function revokeStageShare(room: RoomRecord): Promise<void> {
    if (!room.stageShareId) return;
    const share = await shares.findActiveById(room.stageShareId);
    if (!share) return;
    if (!(await shares.revokeAny(room.stageShareId))) {
      throw new Error("Failed to revoke the active stage share");
    }
    if (share.protocol === "ssh") {
      await live.disconnectParticipants(
        "ssh",
        share.sessionId,
        share.id,
        { reason: "The collaboration stage ended" },
        share.ownerUserId,
      );
      void store.publish(room.id, {
        type: "collab_internal_stage_revoked",
        sessionId: share.sessionId,
        shareId: share.id,
        ownerUserId: share.ownerUserId,
      });
    }
  }

  /** Sets the controller everywhere it lives: the store, the live gate, the hub. */
  async function applyStageControl(
    room: RoomRecord,
    controllerUserId: string | null,
  ): Promise<void> {
    await store.setController(room.id, controllerUserId);
    if (room.stageShareId && room.stageProtocol === "ssh") {
      const share = await shares
        .findActiveById(room.stageShareId)
        .catch(() => null);
      if (share) {
        await live.setRoomShareControl(
          "ssh",
          share.sessionId,
          share.id,
          controllerUserId,
          share.ownerUserId,
        );
      }
    }
    hub.broadcast(room.id, {
      type: "collab_control_changed",
      roomId: room.id,
      controllerUserId,
    });
  }

  async function clearStaleStage(roomId: string): Promise<void> {
    await store.setController(roomId, null);
    await rooms.clearStage(roomId);
    hub.broadcast(roomId, {
      type: "collab_stage_changed",
      roomId,
      stage: null,
    });
  }

  /** The stage's share, when it is still active and its session still live. */
  async function liveStageShare(room: RoomRecord) {
    if (!room.stageShareId || !room.stageProtocol) return null;
    const share = await shares.findActiveById(room.stageShareId);
    if (!share) return null;
    const alive = await live.isLive(
      room.stageProtocol,
      share.sessionId,
      share.ownerUserId,
    );
    return alive ? share : null;
  }

  /** Room events from other instances that touch live sessions here. */
  function onRuntimeEvent(roomId: string, message: object): void {
    const event = message as Record<string, unknown>;
    if (event.type === "collab_control_changed") {
      const controllerUserId =
        typeof event.controllerUserId === "string"
          ? event.controllerUserId
          : null;
      void rooms
        .findById(roomId)
        .then(async (room) => {
          if (!room?.stageShareId || room.stageProtocol !== "ssh") return;
          const share = await shares.findActiveById(room.stageShareId);
          if (share) {
            await live.setRoomShareControl(
              "ssh",
              share.sessionId,
              share.id,
              controllerUserId,
              share.ownerUserId,
            );
          }
        })
        .catch(() => {});
    }
    if (
      event.type === "collab_internal_stage_revoked" &&
      typeof event.sessionId === "string" &&
      typeof event.shareId === "string" &&
      typeof event.ownerUserId === "string"
    ) {
      void live.disconnectParticipants(
        "ssh",
        event.sessionId,
        event.shareId,
        { reason: "The collaboration stage ended" },
        event.ownerUserId,
      );
    }
  }

  return {
    requireRoomMember,
    revokeStageShare,
    applyStageControl,
    clearStaleStage,
    liveStageShare,
    onRuntimeEvent,
  };
}

export type RoomActions = ReturnType<typeof createRoomActions>;

/**
 * Collaboration rooms. `/guest/:token` is public (an anonymous room guest
 * link); everything else needs the plugin's `use` permission and room
 * membership.
 */
export function registerRoomRoutes(
  router: Router,
  deps: SharingDeps,
  actions: RoomActions,
): void {
  const { ctx, shares, rooms, directory, live, hub, store, guestLimiter } =
    deps;
  const {
    requireRoomMember,
    revokeStageShare,
    applyStageControl,
    clearStaleStage,
    liveStageShare,
  } = actions;
  const requireUse = ctx.rbac.require("use") as never;

  const audit = (
    action: string,
    room: { id: string; name: string },
    details?: Record<string, unknown>,
  ) =>
    ctx.audit.record({
      action,
      resourceType: "collab_room",
      resourceId: room.id,
      resourceName: room.name,
      details: details ? JSON.stringify(details) : undefined,
      success: true,
    });

  const fail = (res: Response, operation: string, message: string) => {
    return (error: unknown) => {
      ctx.log.error(
        `${operation}: ${message}`,
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: message });
    };
  };

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms:
   *   post:
   *     summary: Create a collaboration room
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [name]
   *             properties:
   *               name:
   *                 type: string
   *               persistent:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The new room
   *       400:
   *         description: Missing or too long name
   */
  router.post("/rooms", requireUse, async (req: Request, res: Response) => {
    const userId = actorOf(ctx);
    const { name, persistent } = req.body ?? {};
    if (!isNonEmptyString(name) || name.trim().length > 120) {
      return res.status(400).json({ error: "Room name is required" });
    }
    try {
      const room = await rooms.createRoom({
        id: crypto.randomUUID(),
        name: name.trim(),
        ownerUserId: userId,
        persistent: persistent === true,
      });
      await rooms.addMember({
        roomId: room.id,
        userId,
        roomRole: "host",
        addedBy: userId,
      });
      await audit("collab_room_create", room);
      res.json({ room: publicRoom(room) });
    } catch (error) {
      fail(res, "collab_room_create_error", "Failed to create room")(error);
    }
  });

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms:
   *   get:
   *     summary: List rooms the caller belongs to
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Rooms, without their guest tokens
   */
  router.get("/rooms", requireUse, async (_req: Request, res: Response) => {
    try {
      const list = await rooms.listForUser(actorOf(ctx));
      res.json({ rooms: list.map(publicRoom) });
    } catch (error) {
      fail(res, "collab_room_list_error", "Failed to list rooms")(error);
    }
  });

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}:
   *   get:
   *     summary: Get a room with members, online users and stage state
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The room
   *       404:
   *         description: Not a member, or no such room
   */
  router.get("/rooms/:id", requireUse, async (req: Request, res: Response) => {
    const userId = actorOf(ctx);
    const roomId = String(req.params.id);
    try {
      let access = await requireRoomMember(roomId, userId);
      if (!access) return res.status(404).json({ error: "Room not found" });

      // The presenter's own client drives the stage locally and never asks
      // for it, so this is where a presenter whose session died is noticed.
      if (access.room.stageShareId && !(await liveStageShare(access.room))) {
        await clearStaleStage(roomId);
        access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
      }

      const members = await rooms.listMembers(roomId);
      const mayReview = access.isHost || access.room.presenterUserId === userId;
      const controlRequests = await store.listRequests(roomId);
      res.json({
        room: publicRoom(access.room),
        me: userId,
        isHost: access.isHost,
        members,
        online: await hub.onlineUsers(roomId),
        stage: stagePayload(access.room),
        controllerUserId: await store.getController(roomId),
        controlRequests: mayReview
          ? controlRequests
          : controlRequests.filter((request) => request.userId === userId),
        // Room events ride on the terminal socket.
        eventsWsPath: TERMINAL_WS_PATH,
      });
    } catch (error) {
      fail(res, "collab_room_get_error", "Failed to get room")(error);
    }
  });

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/members:
   *   post:
   *     summary: Invite users to a room (host only)
   *     description: Roles expand to their current members, a snapshot.
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               userIds:
   *                 type: array
   *                 items:
   *                   type: string
   *               roleIds:
   *                 type: array
   *                 items:
   *                   type: integer
   *     responses:
   *       200:
   *         description: Invited
   *       403:
   *         description: Not the host
   *       404:
   *         description: Room, user or role not found
   */
  router.post(
    "/rooms/:id/members",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
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
      if (userIds.length + roleIds.length > MAX_INVITE_TARGETS) {
        return res.status(400).json({ error: "Too many invite targets" });
      }

      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (!access.isHost) {
          return res.status(403).json({ error: "Only the host can invite" });
        }

        for (const targetId of userIds as string[]) {
          if (!(await directory.userExists(targetId))) {
            return res.status(404).json({ error: "User not found", targetId });
          }
        }
        const expanded = new Set<string>(userIds as string[]);
        for (const roleId of roleIds as number[]) {
          if (!(await directory.roleExists(roleId))) {
            return res.status(404).json({ error: "Role not found", roleId });
          }
          for (const memberId of await directory.roleUserIds(roleId)) {
            expanded.add(memberId);
          }
        }
        for (const targetId of expanded) {
          await rooms.addMember({
            roomId,
            userId: targetId,
            roomRole: "member",
            addedBy: userId,
          });
        }

        await audit("collab_room_invite", access.room, {
          memberCount: expanded.size,
        });
        hub.broadcast(roomId, { type: "collab_members_changed", roomId });
        res.json({ success: true });
      } catch (error) {
        fail(
          res,
          "collab_room_invite_error",
          "Failed to invite members",
        )(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/members/{userId}:
   *   delete:
   *     summary: Remove a member (host), or leave the room (self)
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Removed
   *       400:
   *         description: The owner cannot be removed
   *       403:
   *         description: Only the host can remove others
   */
  router.delete(
    "/rooms/:id/members/:userId",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      const targetId = String(req.params.userId);
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (targetId !== userId && !access.isHost) {
          return res
            .status(403)
            .json({ error: "Only the host can remove members" });
        }
        if (targetId === access.room.ownerUserId) {
          return res.status(400).json({ error: "The owner cannot be removed" });
        }

        await rooms.removeMember(roomId, targetId);
        await store.removeRequest(roomId, targetId);

        if (access.room.stageShareId && access.room.stageProtocol === "ssh") {
          const share = await shares.findActiveById(access.room.stageShareId);
          if (share) {
            await live.disconnectParticipants(
              "ssh",
              share.sessionId,
              share.id,
              {
                userId: targetId,
                reason: "You were removed from the collaboration room",
              },
              share.ownerUserId,
            );
          }
        }

        if ((await store.getController(roomId)) === targetId) {
          await applyStageControl(access.room, null);
        }

        if (access.room.presenterUserId === targetId) {
          await revokeStageShare(access.room);
          await rooms.clearStage(roomId);
          hub.broadcast(roomId, {
            type: "collab_stage_changed",
            roomId,
            stage: null,
          });
        }

        await audit(
          targetId === userId
            ? "collab_room_leave"
            : "collab_room_remove_member",
          access.room,
          { targetUserId: targetId },
        );
        hub.broadcast(roomId, { type: "collab_members_changed", roomId });
        res.json({ success: true });
      } catch (error) {
        fail(
          res,
          "collab_room_remove_member_error",
          "Failed to remove member",
        )(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/present:
   *   post:
   *     summary: Take the stage with one of your live sessions
   *     description: Any member may take over the stage; the previous stage share is revoked. The caller must own the live session and sharing must be enabled for the host.
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [protocol, sessionId, hostId]
   *             properties:
   *               protocol:
   *                 type: string
   *                 enum: [ssh, rdp, vnc, telnet]
   *               sessionId:
   *                 type: string
   *               hostId:
   *                 type: integer
   *     responses:
   *       200:
   *         description: The new stage
   *       403:
   *         description: Sharing disabled, or not the session's owner
   *       409:
   *         description: The stage changed meanwhile
   */
  router.post(
    "/rooms/:id/present",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
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
        if (!access) return res.status(404).json({ error: "Room not found" });

        const numericHostId = Number(hostId);
        if (!(await deps.isSharingEnabledForHost(numericHostId))) {
          return res
            .status(403)
            .json({ error: "Session sharing is disabled for this host" });
        }
        if (
          !(await live.isOwnedBy(
            protocol as LiveProtocol,
            String(sessionId),
            userId,
          ))
        ) {
          return res
            .status(403)
            .json({ error: "You do not own this live session" });
        }

        const share = await shares.create({
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
        const replaced = await rooms.replaceStage(
          roomId,
          access.room.stageShareId,
          {
            presenterUserId: userId,
            stageProtocol: protocol,
            stageHostId: numericHostId,
            stageShareId: share.id,
          },
        );
        if (!replaced) {
          await shares.revokeAny(share.id);
          return res
            .status(409)
            .json({ error: "The stage changed; try again" });
        }
        await store.setController(roomId, null);
        await store.clearRequests(roomId);

        const stage = {
          presenterUserId: userId,
          protocol,
          hostId: numericHostId,
          shareId: share.id,
        };
        hub.broadcast(roomId, { type: "collab_stage_changed", roomId, stage });
        await audit("collab_room_present", access.room, {
          protocol,
          hostId: numericHostId,
        });
        res.json({ stage });
      } catch (error) {
        fail(
          res,
          "collab_room_present_error",
          "Failed to start presenting",
        )(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/stop:
   *   post:
   *     summary: Stop presenting (presenter or host)
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Stage cleared
   *       403:
   *         description: Not the presenter or host
   */
  router.post(
    "/rooms/:id/stop",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (access.room.presenterUserId !== userId && !access.isHost) {
          return res
            .status(403)
            .json({ error: "Only the presenter or host can stop the stage" });
        }

        await revokeStageShare(access.room);
        await store.setController(roomId, null);
        await store.clearRequests(roomId);
        await rooms.clearStage(roomId);
        hub.broadcast(roomId, {
          type: "collab_stage_changed",
          roomId,
          stage: null,
        });
        await audit("collab_room_stop_presenting", access.room);
        res.json({ success: true });
      } catch (error) {
        fail(res, "collab_room_stop_error", "Failed to stop presenting")(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/stage:
   *   get:
   *     summary: Get connect info for the current stage (members only)
   *     description: SSH stages are joined over the terminal socket by shareId; remote desktop stages get a freshly minted read-only viewer token.
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The stage, or null
   */
  router.get(
    "/rooms/:id/stage",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        const { room } = access;
        if (!room.stageShareId || !room.stageProtocol) {
          return res.json({ stage: null });
        }

        const share = await liveStageShare(room);
        if (!share) {
          // The presenter is gone (expired share or dead session).
          await clearStaleStage(roomId);
          return res.json({ stage: null });
        }

        const stage: Record<string, unknown> = {
          ...stagePayload(room),
          sessionId: share.sessionId,
          controllerUserId: await store.getController(roomId),
        };
        if (room.stageProtocol !== "ssh") {
          stage.connectParams = {
            token: await live.createViewerToken(
              room.stageProtocol,
              share.sessionId,
              true,
              share.ownerUserId,
            ),
          };
        }
        res.json({ stage });
      } catch (error) {
        fail(res, "collab_room_stage_error", "Failed to resolve stage")(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/control:
   *   post:
   *     summary: Grant or revoke stage control (presenter or host)
   *     description: Grants a member write access to the current SSH stage, or revokes it with a null userId. The controller may also release control themselves.
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               userId:
   *                 type: string
   *                 nullable: true
   *     responses:
   *       200:
   *         description: The new controller
   *       400:
   *         description: Nothing presented, or a remote desktop stage
   *       403:
   *         description: Not the presenter or host
   */
  router.post(
    "/rooms/:id/control",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      const { userId: targetId } = req.body ?? {};
      if (targetId !== null && !isNonEmptyString(targetId)) {
        return res
          .status(400)
          .json({ error: "userId must be a user id or null" });
      }

      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (!access.room.stageShareId) {
          return res.status(400).json({ error: "Nothing is being presented" });
        }
        if (access.room.stageProtocol !== "ssh") {
          return res
            .status(400)
            .json({ error: "Remote desktop stages are read-only" });
        }

        const releasingOwn =
          targetId === null && (await store.getController(roomId)) === userId;
        const mayGrant =
          access.isHost || access.room.presenterUserId === userId;
        if (!mayGrant && !releasingOwn) {
          return res.status(403).json({
            error: "Only the presenter or host can change stage control",
          });
        }
        if (targetId && !(await rooms.findMember(roomId, targetId))) {
          return res.status(404).json({ error: "Member not found" });
        }

        await applyStageControl(access.room, targetId);
        if (targetId) {
          await store.removeRequest(roomId, targetId);
          hub.broadcast(roomId, {
            type: "collab_control_requests_changed",
            roomId,
          });
        }
        await audit(
          targetId ? "collab_control_grant" : "collab_control_revoke",
          access.room,
          { targetUserId: targetId },
        );
        res.json({ controllerUserId: targetId });
      } catch (error) {
        fail(
          res,
          "collab_control_error",
          "Failed to change stage control",
        )(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/control/request:
   *   post:
   *     summary: Ask the presenter for stage control (hand raise)
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: The request
   *       429:
   *         description: Asked too recently
   */
  router.post(
    "/rooms/:id/control/request",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (!access.room.stageShareId) {
          return res.status(400).json({ error: "Nothing is being presented" });
        }
        if (access.room.stageProtocol !== "ssh") {
          return res
            .status(400)
            .json({ error: "Remote desktop stages are read-only" });
        }
        const existing = (await store.listRequests(roomId)).find(
          (request) => request.userId === userId,
        );
        if (
          existing &&
          Date.now() - Date.parse(existing.requestedAt) <
            CONTROL_REQUEST_COOLDOWN_MS
        ) {
          return res
            .status(429)
            .json({ error: "Control was already requested" });
        }
        const request: CollabControlRequest = {
          userId,
          username: await directory.username(userId),
          requestedAt: new Date().toISOString(),
        };
        await store.upsertRequest(roomId, request);
        hub.broadcast(roomId, {
          type: "collab_control_requested",
          roomId,
          ...request,
        });
        await audit("collab_control_request", access.room);
        res.json({ request });
      } catch (error) {
        fail(
          res,
          "collab_control_request_error",
          "Failed to request control",
        )(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/control/requests:
   *   get:
   *     summary: List pending control requests (presenter or host)
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Pending requests
   *       403:
   *         description: Not the presenter or host
   */
  router.get(
    "/rooms/:id/control/requests",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (!access.isHost && access.room.presenterUserId !== userId) {
          return res.status(403).json({
            error: "Only the presenter or host can review control requests",
          });
        }
        res.json({ requests: await store.listRequests(roomId) });
      } catch (error) {
        fail(
          res,
          "collab_control_requests_list_error",
          "Failed to list control requests",
        )(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/control/requests/{userId}:
   *   delete:
   *     summary: Dismiss a control request (presenter or host), or cancel your own
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *       - in: path
   *         name: userId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Dismissed
   *       403:
   *         description: Not allowed to dismiss it
   */
  router.delete(
    "/rooms/:id/control/requests/:userId",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      const targetId = String(req.params.userId);
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        const mayReview =
          access.isHost || access.room.presenterUserId === userId;
        if (!mayReview && targetId !== userId) {
          return res
            .status(403)
            .json({ error: "Not allowed to dismiss request" });
        }
        await store.removeRequest(roomId, targetId);
        hub.broadcast(roomId, {
          type: "collab_control_requests_changed",
          roomId,
        });
        await audit(
          targetId === userId
            ? "collab_control_request_cancel"
            : "collab_control_request_dismiss",
          access.room,
          { targetUserId: targetId },
        );
        res.json({ success: true });
      } catch (error) {
        fail(
          res,
          "collab_control_request_dismiss_error",
          "Failed to dismiss control request",
        )(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/guest-link:
   *   post:
   *     summary: Enable, rotate or disable the room's anonymous guest link (host only)
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required: [enabled]
   *             properties:
   *               enabled:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: The new token, or null when disabled
   *       403:
   *         description: Not the host
   */
  router.post(
    "/rooms/:id/guest-link",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      const { enabled } = req.body ?? {};
      if (typeof enabled !== "boolean") {
        return res.status(400).json({ error: "enabled must be a boolean" });
      }
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (!access.isHost) {
          return res
            .status(403)
            .json({ error: "Only the host can manage the guest link" });
        }
        const token = enabled
          ? crypto.randomBytes(24).toString("base64url")
          : null;
        await rooms.setGuestToken(roomId, token);

        // A rotated or disabled link drops the guests who came in on the old one.
        if (
          (!enabled || access.room.guestLinkToken) &&
          access.room.stageShareId &&
          access.room.stageProtocol === "ssh"
        ) {
          const share = await shares.findActiveById(access.room.stageShareId);
          if (share) {
            await live.disconnectParticipants(
              "ssh",
              share.sessionId,
              share.id,
              {
                userId: null,
                reason: enabled
                  ? "The guest link was rotated"
                  : "The guest link was disabled",
              },
              share.ownerUserId,
            );
          }
        }

        await audit(
          enabled ? "collab_guest_link_enable" : "collab_guest_link_disable",
          access.room,
        );
        res.json({ guestLinkToken: token });
      } catch (error) {
        fail(
          res,
          "collab_guest_link_error",
          "Failed to update guest link",
        )(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/guest/{token}:
   *   get:
   *     summary: Resolve a room's current stage for an anonymous guest
   *     description: Public, rate-limited per IP. Guests poll this to follow presenter switches. Never returns host details; SSH stages are joined over the terminal socket with roomGuestToken, remote desktop stages get a read-only viewer token.
   *     tags:
   *       - Collab
   *     parameters:
   *       - in: path
   *         name: token
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Room name and the stage, or a null stage
   *       404:
   *         description: Link not found
   *       429:
   *         description: Too many requests
   */
  router.get("/guest/:token", async (req: Request, res: Response) => {
    if (guestLimiter.isLimited(clientIp(req))) {
      return res.status(429).json({ error: "Too many requests" });
    }
    const token = String(req.params.token);
    try {
      const room = await rooms.findByGuestToken(token);
      if (!room) return res.status(404).json({ error: "Link not found" });

      const response: Record<string, unknown> = {
        roomName: room.name,
        stage: null,
      };
      const share = await liveStageShare(room);
      if (
        share &&
        room.stageProtocol &&
        (await deps.isSharingEnabledForHost(share.hostId))
      ) {
        const protocol = room.stageProtocol as LiveProtocol;
        response.stage = {
          protocol,
          shareId: share.id,
          ...(protocol === "ssh"
            ? {
                wsPath: `${TERMINAL_WS_PATH}?roomGuestToken=${encodeURIComponent(token)}`,
              }
            : {
                connectParams: {
                  token: await live.createViewerToken(
                    protocol,
                    share.sessionId,
                    true,
                    share.ownerUserId,
                  ),
                },
              }),
        };
      }
      res.json(response);
    } catch (error) {
      fail(
        res,
        "collab_guest_resolve_error",
        "Failed to resolve guest link",
      )(error);
    }
  });

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}/end:
   *   post:
   *     summary: End the meeting (host only)
   *     description: Clears the stage. One-off rooms are ended for good; persistent rooms stay listed for reuse.
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Ended
   *       403:
   *         description: Not the host
   */
  router.post(
    "/rooms/:id/end",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (!access.isHost) {
          return res
            .status(403)
            .json({ error: "Only the host can end the room" });
        }

        await revokeStageShare(access.room);
        await store.setController(roomId, null);
        await store.clearRequests(roomId);
        if (access.room.persistent) {
          await rooms.setGuestToken(roomId, null);
          await rooms.clearStage(roomId);
          hub.broadcast(roomId, {
            type: "collab_stage_changed",
            roomId,
            stage: null,
          });
        } else {
          await rooms.endRoom(roomId);
          hub.broadcast(roomId, { type: "collab_room_ended", roomId });
        }
        await audit("collab_room_end", access.room);
        res.json({ success: true });
      } catch (error) {
        fail(res, "collab_room_end_error", "Failed to end room")(error);
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/rooms/{id}:
   *   delete:
   *     summary: Permanently delete a room (host only)
   *     description: Revokes the active stage and removes the room and its membership. This cannot be undone.
   *     tags:
   *       - Collab
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: id
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Deleted
   *       403:
   *         description: Not the host
   */
  router.delete(
    "/rooms/:id",
    requireUse,
    async (req: Request, res: Response) => {
      const userId = actorOf(ctx);
      const roomId = String(req.params.id);
      try {
        const access = await requireRoomMember(roomId, userId);
        if (!access) return res.status(404).json({ error: "Room not found" });
        if (!access.isHost) {
          return res
            .status(403)
            .json({ error: "Only the host can delete the room" });
        }

        await revokeStageShare(access.room);
        await store.setController(roomId, null);
        await store.clearRequests(roomId);
        hub.broadcast(roomId, { type: "collab_room_ended", roomId });
        await rooms.deleteRoom(roomId);
        await audit("collab_room_delete", access.room);
        res.json({ success: true });
      } catch (error) {
        fail(res, "collab_room_delete_error", "Failed to delete room")(error);
      }
    },
  );
}
