import crypto from "crypto";
import express from "express";
import type { Request, Response } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { sshLogger } from "../../utils/logger.js";
import { sessionManager } from "../terminal/session-manager.js";
import { getGuacSessionInfo } from "../guacamole/guacamole-server.js";
import { GuacamoleTokenService } from "../guacamole/token-service.js";
import {
  createCurrentSessionShareRepository,
  createCurrentSettingsRepository,
  createCurrentHostResolutionRepository,
} from "../../database/repositories/factory.js";

const router = express.Router();
const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const permissionManager = PermissionManager.getInstance();
const tokenService = GuacamoleTokenService.getInstance();

const DEFAULT_EXPIRY_HOURS = 24;
const MAX_EXPIRY_HOURS = 24 * 30;

type Protocol = "ssh" | "rdp" | "vnc" | "telnet";
type PermissionLevel = "read-only" | "read-write";

interface ResolveRateEntry {
  count: number;
  windowStart: number;
}
const resolveAttempts = new Map<string, ResolveRateEntry>();
const RESOLVE_WINDOW_MS = 60 * 1000;
const RESOLVE_MAX_ATTEMPTS = 30;

function isResolveRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = resolveAttempts.get(ip);
  if (!entry || now - entry.windowStart > RESOLVE_WINDOW_MS) {
    resolveAttempts.set(ip, { count: 1, windowStart: now });
    return false;
  }
  entry.count += 1;
  return entry.count > RESOLVE_MAX_ATTEMPTS;
}

setInterval(
  () => {
    const now = Date.now();
    for (const [ip, entry] of resolveAttempts.entries()) {
      if (now - entry.windowStart > RESOLVE_WINDOW_MS)
        resolveAttempts.delete(ip);
    }
  },
  5 * 60 * 1000,
);

async function isSharingEnabledForHost(hostId: number): Promise<{
  enabled: boolean;
  hostOwnerId: string | null;
}> {
  const globalEnabled = await createCurrentSettingsRepository().getBoolean(
    "session_sharing_globally_enabled",
    true,
  );
  if (!globalEnabled) return { enabled: false, hostOwnerId: null };

  const hostResolutionRepository = createCurrentHostResolutionRepository();
  const hostOwnerId = await hostResolutionRepository.findHostOwnerId(hostId);
  if (!hostOwnerId) return { enabled: false, hostOwnerId: null };

  const host = await hostResolutionRepository.findHostById(hostId, hostOwnerId);
  if (!host) return { enabled: false, hostOwnerId: null };

  return {
    enabled: host.allowSessionSharing !== false,
    hostOwnerId,
  };
}

function computeExpiresAt(expiryHours: number | undefined): string {
  const hours = Math.min(
    Math.max(expiryHours ?? DEFAULT_EXPIRY_HOURS, 1),
    MAX_EXPIRY_HOURS,
  );
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function isLiveSessionOwnedBy(
  protocol: Protocol,
  sessionId: string,
  userId: string,
): boolean {
  if (protocol === "ssh") {
    const session = sessionManager.getSession(sessionId);
    return !!session && session.isConnected && session.userId === userId;
  }
  const info = getGuacSessionInfo(sessionId);
  return !!info && info.ownerUserId === userId;
}

function isLiveSession(protocol: Protocol, sessionId: string): boolean {
  if (protocol === "ssh") {
    const session = sessionManager.getSession(sessionId);
    return !!session && session.isConnected;
  }
  return !!getGuacSessionInfo(sessionId);
}

/**
 * @openapi
 * /session-sharing/create:
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
router.post("/create", authenticateJWT, async (req: Request, res: Response) => {
  try {
    const userId = (req as AuthenticatedRequest).userId!;
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

    if (!hostId || !sessionId || !protocol || !shareType || !permissionLevel) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    if (!["ssh", "rdp", "vnc", "telnet"].includes(protocol)) {
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

    const { enabled: sharingEnabled } =
      await isSharingEnabledForHost(numericHostId);
    if (!sharingEnabled) {
      return res
        .status(403)
        .json({ error: "Session sharing is disabled for this host" });
    }

    if (!isLiveSessionOwnedBy(protocol, String(sessionId), userId)) {
      return res
        .status(403)
        .json({ error: "You do not own this live session" });
    }

    if (shareType === "user") {
      const accessInfo = await permissionManager.canAccessHost(
        targetUserId,
        numericHostId,
        "connect",
      );
      if (!accessInfo.hasAccess) {
        return res.status(403).json({
          error: "Target user does not have access to this host",
        });
      }
    }

    const shareId = crypto.randomUUID();
    const linkToken =
      shareType === "link"
        ? crypto.randomBytes(24).toString("base64url")
        : null;
    const expiresAt = computeExpiresAt(expiryHours);

    const created = await createCurrentSessionShareRepository().create({
      id: shareId,
      hostId: numericHostId,
      ownerUserId: userId,
      protocol,
      sessionId: String(sessionId),
      tabInstanceId: tabInstanceId ?? null,
      shareType,
      targetUserId: shareType === "user" ? targetUserId : null,
      linkToken,
      permissionLevel,
      expiresAt,
    });

    res.json({
      shareId: created.id,
      linkToken: created.linkToken,
      expiresAt: created.expiresAt,
    });
  } catch (error) {
    sshLogger.error("Failed to create session share", error, {
      operation: "session_share_create_error",
    });
    res.status(500).json({ error: "Failed to create session share" });
  }
});

/**
 * @openapi
 * /session-sharing/host/{hostId}/active:
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
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const hostId = Number.parseInt(String(req.params.hostId), 10);
      if (!hostId || Number.isNaN(hostId)) {
        return res.status(400).json({ error: "Invalid host ID" });
      }

      const shares =
        await createCurrentSessionShareRepository().findActiveSharesForHost(
          hostId,
          userId,
        );

      res.json({ shares });
    } catch (error) {
      sshLogger.error("Failed to list session shares", error, {
        operation: "session_share_list_error",
      });
      res.status(500).json({ error: "Failed to list session shares" });
    }
  },
);

/**
 * @openapi
 * /session-sharing/{shareId}:
 *   delete:
 *     summary: Revoke a session share
 *     description: Revokes a share. Owner or admin only. Best-effort kick of live SSH participants; guac joins are not force-disconnected in v1.
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
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const shareId = String(req.params.shareId);

      const repository = createCurrentSessionShareRepository();
      const share = await repository.findById(shareId);
      if (!share) {
        return res.status(404).json({ error: "Share not found" });
      }

      let revoked = await repository.revoke(shareId, userId);
      if (!revoked) {
        if (await permissionManager.isAdmin(userId)) {
          revoked = await repository.revokeAsAdmin(shareId);
        }
      }

      if (!revoked) {
        return res
          .status(403)
          .json({ error: "Not authorized to revoke this share" });
      }

      // Best-effort kick of live participants. SSH sessions support ending
      // just the guests via ownerEndSession; guac joins aren't force-kickable
      // from a REST handler (guacamole-lite exposes no kick API), so a revoked
      // guac link only blocks *future* resolves until the guest's own socket ends.
      if (share.protocol === "ssh") {
        try {
          sessionManager.ownerEndSession(
            share.sessionId,
            "Session share revoked by owner",
          );
        } catch {
          // best-effort only
        }
      }

      res.json({ success: true });
    } catch (error) {
      sshLogger.error("Failed to revoke session share", error, {
        operation: "session_share_revoke_error",
      });
      res.status(500).json({ error: "Failed to revoke session share" });
    }
  },
);

/**
 * @openapi
 * /session-sharing/resolve/{linkToken}:
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
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    if (isResolveRateLimited(ip)) {
      return res.status(429).json({ error: "Too many requests" });
    }

    const linkToken = String(req.params.linkToken);
    const repository = createCurrentSessionShareRepository();
    const share = await repository.findByLinkToken(linkToken);
    if (!share) {
      return res.status(404).json({ error: "Link not found or expired" });
    }

    const { enabled: sharingEnabled } = await isSharingEnabledForHost(
      share.hostId,
    );
    if (!sharingEnabled) {
      return res.status(404).json({ error: "Link not found or expired" });
    }

    const protocol = share.protocol as Protocol;
    if (!isLiveSession(protocol, share.sessionId)) {
      return res.status(404).json({ error: "Session is no longer active" });
    }

    // Field-by-field by design - never spread a host row into this response.
    // Anonymous guests must never see hostname/IP/username/hostId (decision #5).
    const response: {
      protocol: Protocol;
      permissionLevel: PermissionLevel;
      wsPath: string;
      connectParams?: Record<string, string>;
    } = {
      protocol,
      permissionLevel: share.permissionLevel as PermissionLevel,
      wsPath:
        protocol === "ssh"
          ? `/terminal/ws?shareToken=${encodeURIComponent(linkToken)}`
          : "/guacamole/websocket/",
    };

    if (protocol !== "ssh") {
      const joinToken = tokenService.createJoinToken(
        share.sessionId,
        share.permissionLevel === "read-only",
      );
      response.connectParams = { token: joinToken };
    }

    try {
      await repository.touchShareUsage(share.id);
      await repository.recordParticipantJoin(share.id, null, "Guest");
    } catch {
      // best-effort, never fail the resolve response over audit bookkeeping
    }

    res.json(response);
  } catch (error) {
    sshLogger.error("Failed to resolve session share link", error, {
      operation: "session_share_resolve_error",
    });
    res.status(500).json({ error: "Failed to resolve share link" });
  }
});

/**
 * @openapi
 * /session-sharing/{shareId}/end:
 *   post:
 *     summary: End a shared session for all participants
 *     description: Owner-only. Terminates the underlying session and notifies joined participants. Guac protocol kick is best-effort in v1.
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
  authenticateJWT,
  async (req: Request, res: Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const shareId = String(req.params.shareId);

      const repository = createCurrentSessionShareRepository();
      const share = await repository.findById(shareId);
      if (!share) {
        return res.status(404).json({ error: "Share not found" });
      }
      if (share.ownerUserId !== userId) {
        return res.status(403).json({ error: "Not the owner of this share" });
      }

      if (share.protocol === "ssh") {
        sessionManager.ownerEndSession(
          share.sessionId,
          "Session ended by owner",
        );
      }
      // Guac protocols: no kick API available from a REST handler in v1 - see
      // DELETE /:shareId for the same limitation.

      res.json({ success: true });
    } catch (error) {
      sshLogger.error("Failed to end shared session", error, {
        operation: "session_share_end_error",
      });
      res.status(500).json({ error: "Failed to end shared session" });
    }
  },
);

export default router;
