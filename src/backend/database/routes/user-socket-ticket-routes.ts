import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Router } from "express";
import type { AuthManager } from "../../utils/auth-manager.js";
import { authLogger } from "../../utils/logger.js";
import { isCookieOriginAllowed } from "../../utils/ws-auth.js";

type UserSocketTicketRoutesDeps = {
  authenticateJWT: RequestHandler;
  authManager: AuthManager;
};

export function registerUserSocketTicketRoutes(
  router: Router,
  { authenticateJWT, authManager }: UserSocketTicketRoutesDeps,
): void {
  /**
   * @openapi
   * /users/ws-ticket:
   *   post:
   *     summary: Get a WebSocket ticket
   *     description: Returns a token that is valid for one minute and only opens plugin WebSockets. The web app sends it as a subprotocol, so sockets work behind a proxy that rewrites the Host header. Only a page on this server can get one.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: The ticket.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 ticket:
   *                   type: string
   *       401:
   *         description: Not authenticated, or not a login session.
   *       403:
   *         description: The request came from a page on another site.
   *       500:
   *         description: Failed to issue the ticket.
   */
  router.post("/ws-ticket", authenticateJWT, async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    const sessionId = authReq.sessionId;
    if (!sessionId || authReq.apiKeyId) {
      return res.status(401).json({ error: "A login session is required" });
    }
    // The cookie rides along from sibling subdomains too, so the ticket only
    // goes to a page the browser says is this server.
    if (req.cookies?.jwt && !isCookieOriginAllowed(req)) {
      return res.status(403).json({ error: "Not allowed from this origin" });
    }
    try {
      const ticket = await authManager.issueSocketTicket(
        authReq.userId,
        sessionId,
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({ ticket });
    } catch (err) {
      authLogger.error("Failed to issue a socket ticket", err);
      res.status(500).json({ error: "Failed to issue a socket ticket" });
    }
  });

  /**
   * @openapi
   * /users/ws-ticket/api-key:
   *   post:
   *     summary: Get a WebSocket ticket for an API key
   *     description: For another Termix server that manages this one with an API key. Returns a token that is valid for one minute and only opens plugin WebSockets, as the key's user. It cannot call any other route.
   *     tags:
   *       - Users
   *     responses:
   *       200:
   *         description: The ticket.
   *       401:
   *         description: The request did not use an API key.
   *       500:
   *         description: Failed to issue the ticket.
   */
  router.post("/ws-ticket/api-key", authenticateJWT, async (req, res) => {
    const authReq = req as AuthenticatedRequest;
    if (!authReq.apiKeyId) {
      return res.status(401).json({ error: "An API key is required" });
    }
    try {
      const ticket = await authManager.issueApiKeySocketTicket(
        authReq.userId,
        authReq.apiKeyId,
      );
      res.setHeader("Cache-Control", "no-store");
      res.json({ ticket });
    } catch (err) {
      authLogger.error("Failed to issue an API key socket ticket", err);
      res.status(500).json({ error: "Failed to issue a socket ticket" });
    }
  });
}
