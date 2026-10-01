import crypto from "node:crypto";
import type { Request, Response, Router } from "express";
import {
  DISPLAY_WS_PATH,
  PROTOCOLS,
  TERMINAL_WS_PATH,
  actorOf,
  clientIp,
  type SharingDeps,
} from "./deps.js";
import type { LiveProtocol, PermissionLevel } from "./repositories.js";

const DEFAULT_EXPIRY_HOURS = 24;
const MAX_EXPIRY_HOURS = 24 * 30;

function computeExpiresAt(expiryHours: number | undefined): string {
  const hours = Math.min(
    Math.max(expiryHours ?? DEFAULT_EXPIRY_HOURS, 1),
    MAX_EXPIRY_HOURS,
  );
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/**
 * The share routes. `/resolve/:linkToken` is public (an anonymous guest link);
 * the rest run behind core auth and the plugin's `use` permission, which the
 * caller applies to the router first.
 */
export function registerShareRoutes(router: Router, deps: SharingDeps): void {
  const { ctx, shares, directory, live, resolveLimiter } = deps;
  const requireUse = ctx.rbac.require("use") as never;

  /**
   * @openapi
   * /plugin-api/session-sharing/resolve/{linkToken}:
   *   get:
   *     summary: Resolve a guest share link
   *     description: Public, unauthenticated endpoint for anonymous share-link guests. Never returns host name, IP, username, or hostId. Rate-limited per IP.
   *     tags:
   *       - Session Sharing
   *     parameters:
   *       - in: path
   *         name: linkToken
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Resolved share connection info
   *       404:
   *         description: Link not found, expired, revoked, or sharing disabled
   *       429:
   *         description: Too many requests
   *       500:
   *         description: Server error
   */
  router.get("/resolve/:linkToken", async (req: Request, res: Response) => {
    try {
      if (resolveLimiter.isLimited(clientIp(req))) {
        return res.status(429).json({ error: "Too many requests" });
      }

      const linkToken = String(req.params.linkToken);
      const share = await shares.findByLinkToken(linkToken);
      if (!share || share.shareType !== "link") {
        return res.status(404).json({ error: "Link not found or expired" });
      }
      if (!(await deps.isSharingEnabledForHost(share.hostId))) {
        return res.status(404).json({ error: "Link not found or expired" });
      }

      const protocol = share.protocol as LiveProtocol;
      if (!(await live.isLive(protocol, share.sessionId, share.ownerUserId))) {
        return res.status(404).json({ error: "Session is no longer active" });
      }

      // Field by field on purpose: anonymous guests never see the host's
      // name, address, username or id.
      const response: {
        protocol: LiveProtocol;
        permissionLevel: PermissionLevel;
        wsPath: string;
        connectParams?: Record<string, string>;
      } = {
        protocol,
        permissionLevel: share.permissionLevel as PermissionLevel,
        // Advisory only: the client builds its own socket URL per deployment.
        wsPath:
          protocol === "ssh"
            ? `${TERMINAL_WS_PATH}?shareToken=${encodeURIComponent(linkToken)}`
            : DISPLAY_WS_PATH,
      };

      if (protocol !== "ssh") {
        response.connectParams = {
          token: await live.createViewerToken(
            protocol,
            share.sessionId,
            share.permissionLevel === "read-only",
            share.ownerUserId,
          ),
        };
      }

      try {
        await shares.touchUsage(share.id);
        await shares.recordParticipantJoin(share.id, null, "Guest");
      } catch {
        // Bookkeeping never fails the resolve.
      }

      res.json(response);
    } catch (error) {
      ctx.log.error(
        "Failed to resolve session share link",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to resolve share link" });
    }
  });

  /**
   * @openapi
   * /plugin-api/session-sharing/create:
   *   post:
   *     summary: Create a session share (link or targeted user)
   *     description: Mints a share grant for a live terminal/RDP/VNC/Telnet session. Caller must own the live session.
   *     tags:
   *       - Session Sharing
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - hostId
   *               - sessionId
   *               - protocol
   *               - shareType
   *               - permissionLevel
   *             properties:
   *               hostId:
   *                 type: integer
   *               sessionId:
   *                 type: string
   *               tabInstanceId:
   *                 type: string
   *               protocol:
   *                 type: string
   *                 enum: [ssh, rdp, vnc, telnet]
   *               shareType:
   *                 type: string
   *                 enum: [link, user]
   *               targetUserId:
   *                 type: string
   *               permissionLevel:
   *                 type: string
   *                 enum: [read-only, read-write]
   *               expiryHours:
   *                 type: number
   *     responses:
   *       200:
   *         description: Share created
   *       400:
   *         description: Invalid request
   *       403:
   *         description: Sharing disabled, or caller does not own the session
   *       500:
   *         description: Server error
   */
  router.post("/create", requireUse, async (req: Request, res: Response) => {
    try {
      const userId = actorOf(ctx);
      const {
        hostId,
        sessionId,
        tabInstanceId,
        protocol,
        shareType,
        targetUserId,
        permissionLevel,
        expiryHours,
      } = req.body ?? {};

      if (
        !hostId ||
        !sessionId ||
        !protocol ||
        !shareType ||
        !permissionLevel
      ) {
        return res.status(400).json({ error: "Missing required fields" });
      }
      if (!PROTOCOLS.includes(protocol)) {
        return res.status(400).json({ error: "Invalid protocol" });
      }
      if (!["link", "user"].includes(shareType)) {
        return res.status(400).json({ error: "Invalid shareType" });
      }
      if (!["read-only", "read-write"].includes(permissionLevel)) {
        return res.status(400).json({ error: "Invalid permissionLevel" });
      }
      if (shareType === "user" && !targetUserId) {
        return res
          .status(400)
          .json({ error: "targetUserId is required for user shares" });
      }

      const numericHostId = Number(hostId);
      if (!(await deps.isSharingEnabledForHost(numericHostId))) {
        return res
          .status(403)
          .json({ error: "Session sharing is disabled for this host" });
      }
      if (!(await live.isOwnedBy(protocol, String(sessionId), userId))) {
        return res
          .status(403)
          .json({ error: "You do not own this live session" });
      }

      if (shareType === "user") {
        const target = String(targetUserId);
        const access = (await directory.userExists(target))
          ? await ctx.asUser(target, () =>
              ctx.hosts.checkAccess(numericHostId, "connect"),
            )
          : { hasAccess: false };
        if (!access.hasAccess) {
          return res.status(403).json({
            error: "Target user does not have access to this host",
          });
        }
      }

      const created = await shares.create({
        id: crypto.randomUUID(),
        hostId: numericHostId,
        ownerUserId: userId,
        protocol,
        sessionId: String(sessionId),
        tabInstanceId: tabInstanceId ?? null,
        shareType,
        targetUserId: shareType === "user" ? String(targetUserId) : null,
        linkToken:
          shareType === "link"
            ? crypto.randomBytes(24).toString("base64url")
            : null,
        permissionLevel,
        expiresAt: computeExpiresAt(expiryHours),
      });

      res.json({
        shareId: created.id,
        linkToken: created.linkToken,
        expiresAt: created.expiresAt,
      });
    } catch (error) {
      ctx.log.error(
        "Failed to create session share",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to create session share" });
    }
  });

  /**
   * @openapi
   * /plugin-api/session-sharing/host/{hostId}/active:
   *   get:
   *     summary: List active session shares for a host
   *     description: Returns active (non-revoked, non-expired) shares owned by the caller for the given host.
   *     tags:
   *       - Session Sharing
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: hostId
   *         required: true
   *         schema:
   *           type: integer
   *     responses:
   *       200:
   *         description: List of active shares
   *       400:
   *         description: Invalid host id
   *       500:
   *         description: Server error
   */
  router.get(
    "/host/:hostId/active",
    requireUse,
    async (req: Request, res: Response) => {
      try {
        const userId = actorOf(ctx);
        const hostId = Number.parseInt(String(req.params.hostId), 10);
        if (!hostId || Number.isNaN(hostId)) {
          return res.status(400).json({ error: "Invalid host ID" });
        }
        res.json({
          shares: await shares.findActiveSharesForHost(hostId, userId),
        });
      } catch (error) {
        ctx.log.error(
          "Failed to list session shares",
          error instanceof Error ? error : undefined,
        );
        res.status(500).json({ error: "Failed to list session shares" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/shared-with-me:
   *   get:
   *     summary: List live SSH sessions other users shared with the caller
   *     description: Active user shares aimed at the caller whose session is still live, in the shape of /open-tabs/active-sessions.
   *     tags:
   *       - Session Sharing
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Shared sessions
   *       500:
   *         description: Server error
   */
  router.get(
    "/shared-with-me",
    requireUse,
    async (_req: Request, res: Response) => {
      try {
        const userId = actorOf(ctx);
        const result = [];
        for (const share of await shares.findSharesTargetingUser(userId)) {
          if (share.protocol !== "ssh") continue;
          const session = await live.getSession("ssh", share.sessionId);
          if (!session?.isConnected) continue;
          result.push({
            sessionId: session.id,
            hostId: session.hostId,
            hostName: session.hostName,
            tabInstanceId: session.tabInstanceId,
            isConnected: session.isConnected,
            createdAt: session.createdAt,
            isOwnSession: false,
            sharedByUsername: await directory.username(share.ownerUserId),
            permissionLevel: share.permissionLevel,
            shareId: share.id,
          });
        }
        res.json(result);
      } catch (error) {
        ctx.log.error(
          "Failed to list shared sessions",
          error instanceof Error ? error : undefined,
        );
        res.status(500).json({ error: "Failed to list shared sessions" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/directory:
   *   get:
   *     summary: Users and roles to share with or invite
   *     tags:
   *       - Session Sharing
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Users (id, username) and roles (id, name, displayName)
   *       500:
   *         description: Server error
   */
  router.get("/directory", requireUse, async (_req: Request, res: Response) => {
    try {
      res.json({
        users: await directory.listUsers(),
        roles: await directory.listRoles(),
      });
    } catch (error) {
      ctx.log.error(
        "Failed to list users and roles",
        error instanceof Error ? error : undefined,
      );
      res.status(500).json({ error: "Failed to list users and roles" });
    }
  });

  /**
   * @openapi
   * /plugin-api/session-sharing/{shareId}:
   *   delete:
   *     summary: Revoke a session share
   *     description: Revokes a share. Owner or admin only. Best-effort kick of live SSH participants; remote desktop viewers are not force-disconnected.
   *     tags:
   *       - Session Sharing
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: shareId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Share revoked
   *       403:
   *         description: Not authorized to revoke this share
   *       404:
   *         description: Share not found
   *       500:
   *         description: Server error
   */
  router.delete(
    "/:shareId",
    requireUse,
    async (req: Request, res: Response) => {
      try {
        const userId = actorOf(ctx);
        const shareId = String(req.params.shareId);
        const share = await shares.findById(shareId);
        if (!share) {
          return res.status(404).json({ error: "Share not found" });
        }

        let revoked = await shares.revoke(shareId, userId);
        if (!revoked && (await directory.isAdmin(userId))) {
          revoked = await shares.revokeAny(shareId);
        }
        if (!revoked) {
          return res
            .status(403)
            .json({ error: "Not authorized to revoke this share" });
        }

        // guacamole-lite has no kick, so a revoked remote desktop link only
        // blocks new resolves until the viewer's own socket ends.
        if (share.protocol === "ssh") {
          await live.ownerEndSession(
            "ssh",
            share.sessionId,
            "Session share revoked by owner",
            share.ownerUserId,
          );
        }

        res.json({ success: true });
      } catch (error) {
        ctx.log.error(
          "Failed to revoke session share",
          error instanceof Error ? error : undefined,
        );
        res.status(500).json({ error: "Failed to revoke session share" });
      }
    },
  );

  /**
   * @openapi
   * /plugin-api/session-sharing/{shareId}/end:
   *   post:
   *     summary: End a shared session for all participants
   *     description: Owner-only. Terminates the underlying session and notifies joined participants. Remote desktop viewers are not force-disconnected.
   *     tags:
   *       - Session Sharing
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: shareId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Session ended
   *       403:
   *         description: Not the owner of this share
   *       404:
   *         description: Share not found
   *       500:
   *         description: Server error
   */
  router.post(
    "/:shareId/end",
    requireUse,
    async (req: Request, res: Response) => {
      try {
        const userId = actorOf(ctx);
        const share = await shares.findById(String(req.params.shareId));
        if (!share) {
          return res.status(404).json({ error: "Share not found" });
        }
        if (share.ownerUserId !== userId) {
          return res.status(403).json({ error: "Not the owner of this share" });
        }
        if (share.protocol === "ssh") {
          await live.ownerEndSession(
            "ssh",
            share.sessionId,
            "Session ended by owner",
          );
        }
        res.json({ success: true });
      } catch (error) {
        ctx.log.error(
          "Failed to end shared session",
          error instanceof Error ? error : undefined,
        );
        res.status(500).json({ error: "Failed to end shared session" });
      }
    },
  );
}
