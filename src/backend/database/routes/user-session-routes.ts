import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import { AuthManager } from "../../utils/auth-manager.js";
import { authLogger } from "../../utils/logger.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";
import {
  createCurrentApiKeyRepository,
  createCurrentSessionRepository,
  createCurrentUserRepository,
} from "../repositories/factory.js";

type UserSessionRoutesDeps = {
  authenticateJWT: RequestHandler;
  authManager: AuthManager;
};

export function registerUserSessionRoutes(
  router: Router,
  { authenticateJWT, authManager }: UserSessionRoutesDeps,
): void {
  /**
   * @openapi
   * /users/sessions/revoke-everyone:
   *   post:
   *     summary: Sign everyone out (admin only)
   *     description: Ends every session on the server except the caller's own. With apiKeys true, every API key is revoked too.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               apiKeys:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Sessions ended. Returns how many sessions and keys.
   *       403:
   *         description: Admin access required.
   *       500:
   *         description: Failed to end sessions.
   */
  router.post(
    "/sessions/revoke-everyone",
    authenticateJWT,
    async (req, res) => {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.userId;
      try {
        const userRecord = await createCurrentUserRepository().findById(userId);
        if (!userRecord?.isAdmin) {
          return res.status(403).json({ error: "Admin access required" });
        }
        const sessions = await createCurrentSessionRepository().revokeAll(
          authReq.sessionId,
        );
        const apiKeys =
          req.body?.apiKeys === true
            ? await createCurrentApiKeyRepository().deleteAll()
            : 0;
        const { ipAddress, userAgent } = getRequestMeta(req);
        await logAudit({
          userId,
          username: userRecord.username ?? userId,
          action: "revoke_everyone_sessions",
          resourceType: "session",
          details: JSON.stringify({ sessions, apiKeys }),
          ipAddress,
          userAgent,
          success: true,
        });
        res.json({ sessions, apiKeys });
      } catch (err) {
        authLogger.error("Failed to end every session", err);
        res.status(500).json({ error: "Failed to end sessions" });
      }
    },
  );

  /**
   * @openapi
   * /users/sessions:
   *   get:
   *     summary: Get sessions
   *     description: Retrieves all sessions for authenticated user (or all sessions for admins).
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: Sessions list returned.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to get sessions.
   */
  router.get("/sessions", authenticateJWT, async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.userId;
    const currentSessionId = authReq.sessionId;

    try {
      const userRepository = createCurrentUserRepository();
      const userRecord = await userRepository.findById(userId);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      let sessionList;

      if (userRecord.isAdmin) {
        sessionList = await authManager.getAllSessions();
        const sessionUsers = await userRepository.listByIds(
          sessionList.map((session) => session.userId),
        );
        const usernamesById = new Map(
          sessionUsers.map((sessionUser) => [
            sessionUser.id,
            sessionUser.username,
          ]),
        );

        const enrichedSessions = sessionList.map((session) => ({
          id: session.id,
          userId: session.userId,
          username: usernamesById.get(session.userId) || "Unknown",
          deviceType: session.deviceType,
          deviceInfo: session.deviceInfo,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
          lastActiveAt: session.lastActiveAt,
          isRevoked: session.isRevoked,
          isCurrentSession: session.id === currentSessionId,
        }));

        return res.json({ sessions: enrichedSessions });
      } else {
        sessionList = await authManager.getUserSessions(userId);
        return res.json({
          sessions: sessionList.map((session) => ({
            id: session.id,
            userId: session.userId,
            deviceType: session.deviceType,
            deviceInfo: session.deviceInfo,
            createdAt: session.createdAt,
            expiresAt: session.expiresAt,
            lastActiveAt: session.lastActiveAt,
            isRevoked: session.isRevoked,
            isCurrentSession: session.id === currentSessionId,
          })),
        });
      }
    } catch (err) {
      authLogger.error("Failed to get sessions", err);
      res.status(500).json({ error: "Failed to get sessions" });
    }
  });

  /**
   * @openapi
   * /users/sessions/{sessionId}:
   *   delete:
   *     summary: Revoke a specific session
   *     description: Revokes a specific session by ID.
   *     tags:
   *       - Users
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *         description: The session ID to revoke
   *     responses:
   *       200:
   *         description: Session revoked successfully.
   *       400:
   *         description: Session ID is required.
   *       403:
   *         description: Not authorized to revoke this session.
   *       404:
   *         description: Session not found.
   *       500:
   *         description: Failed to revoke session.
   */
  router.delete("/sessions/:sessionId", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sessionId = Array.isArray(req.params.sessionId)
      ? req.params.sessionId[0]
      : req.params.sessionId;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    try {
      const userRepository = createCurrentUserRepository();
      const userRecord = await userRepository.findById(userId);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      const session =
        await createCurrentSessionRepository().findById(sessionId);

      if (!session) {
        return res.status(404).json({ error: "Session not found" });
      }

      if (!userRecord.isAdmin && session.userId !== userId) {
        return res
          .status(403)
          .json({ error: "Not authorized to revoke this session" });
      }

      const success = await authManager.revokeSession(sessionId);

      if (success) {
        authLogger.success("Session revoked", {
          operation: "session_revoke",
          sessionId,
          revokedBy: userId,
          sessionUserId: session.userId,
        });

        const { ipAddress, userAgent } = getRequestMeta(req);
        await logAudit({
          userId,
          username: userRecord.username ?? userId,
          action: "revoke_session",
          resourceType: "session",
          resourceId: sessionId,
          details: JSON.stringify({ targetUserId: session.userId }),
          ipAddress,
          userAgent,
          success: true,
        });

        res.json({ success: true, message: "Session revoked successfully" });
      } else {
        res.status(500).json({ error: "Failed to revoke session" });
      }
    } catch (err) {
      authLogger.error("Failed to revoke session", err);
      res.status(500).json({ error: "Failed to revoke session" });
    }
  });

  /**
   * @openapi
   * /users/sessions/revoke-all:
   *   post:
   *     summary: Revoke all sessions for a user
   *     description: Revokes all sessions with option to exclude current session.
   *     tags:
   *       - Users
   *     requestBody:
   *       required: false
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               targetUserId:
   *                 type: string
   *               exceptCurrent:
   *                 type: boolean
   *     responses:
   *       200:
   *         description: Sessions revoked successfully.
   *       403:
   *         description: Not authorized to revoke sessions for other users.
   *       404:
   *         description: User not found.
   *       500:
   *         description: Failed to revoke sessions.
   */
  router.post("/sessions/revoke-all", authenticateJWT, async (req, res) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { targetUserId, exceptCurrent } = req.body;

    try {
      const userRepository = createCurrentUserRepository();
      const userRecord = await userRepository.findById(userId);
      if (!userRecord) {
        return res.status(404).json({ error: "User not found" });
      }

      let revokeUserId = userId;
      if (targetUserId && userRecord.isAdmin) {
        revokeUserId = targetUserId;
      } else if (targetUserId && targetUserId !== userId) {
        return res.status(403).json({
          error: "Not authorized to revoke sessions for other users",
        });
      }

      let currentSessionId: string | undefined;
      if (exceptCurrent) {
        currentSessionId = (req as AuthenticatedRequest).sessionId;
      }

      const revokedCount = await authManager.revokeAllUserSessions(
        revokeUserId,
        currentSessionId,
      );

      authLogger.success("User sessions revoked", {
        operation: "user_sessions_revoke_all",
        revokeUserId,
        revokedBy: userId,
        exceptCurrent,
        revokedCount,
      });

      const { ipAddress, userAgent } = getRequestMeta(req);
      const targetUserRecord =
        revokeUserId === userId
          ? userRecord
          : await userRepository.findById(revokeUserId);
      await logAudit({
        userId,
        username: userRecord.username ?? userId,
        action: "revoke_all_sessions",
        resourceType: "session",
        resourceId: revokeUserId,
        resourceName: targetUserRecord?.username,
        details: JSON.stringify({ revokedCount, exceptCurrent }),
        ipAddress,
        userAgent,
        success: true,
      });

      res.json({
        message: `${revokedCount} session(s) revoked successfully`,
        count: revokedCount,
      });
    } catch (err) {
      authLogger.error("Failed to revoke user sessions", err);
      res.status(500).json({ error: "Failed to revoke sessions" });
    }
  });
}
