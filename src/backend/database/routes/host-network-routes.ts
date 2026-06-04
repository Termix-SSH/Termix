import type { AuthenticatedRequest } from "../../../types/index.js";
import type { Request, RequestHandler, Response, Router } from "express";
import { and, eq } from "drizzle-orm";
import { sendWakeOnLan, isValidMac } from "../../utils/wake-on-lan.js";
import { sshLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";

interface HostNetworkRoutesDeps {
  authenticateJWT: RequestHandler;
  requireDataAccess: RequestHandler;
}

export function registerHostNetworkRoutes(
  router: Router,
  { authenticateJWT, requireDataAccess }: HostNetworkRoutesDeps,
): void {
  /**
   * @openapi
   * /host/db/proxy/test:
   *   post:
   *     summary: Test proxy connectivity
   *     description: Tests connectivity through a proxy configuration to a target host.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               singleProxy:
   *                 type: object
   *                 properties:
   *                   host:
   *                     type: string
   *                   port:
   *                     type: number
   *                   type:
   *                     type: string
   *                   username:
   *                     type: string
   *                   password:
   *                     type: string
   *               proxyChain:
   *                 type: array
   *                 items:
   *                   type: object
   *               testTarget:
   *                 type: object
   *                 properties:
   *                   host:
   *                     type: string
   *                   port:
   *                     type: number
   *     responses:
   *       200:
   *         description: Test result
   *       500:
   *         description: Proxy connection failed
   */
  router.post(
    "/db/proxy/test",
    authenticateJWT,
    requireDataAccess,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { singleProxy, proxyChain, testTarget } = req.body;

        const { testProxyConnectivity } =
          await import("../../utils/proxy-helper.js");

        const result = await testProxyConnectivity({
          singleProxy,
          proxyChain,
          testTarget,
        });

        res.json(result);
      } catch (error) {
        sshLogger.error("Proxy connectivity test failed", error, {
          operation: "proxy_test",
          userId: req.userId,
        });
        res.status(500).json({
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    },
  );

  router.post(
    "/db/host/:id/wake",
    authenticateJWT,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const hostId = Number.parseInt(String(req.params.id), 10);
      const userId = (req as AuthenticatedRequest).userId;

      try {
        const host = await db
          .select({ macAddress: hosts.macAddress })
          .from(hosts)
          .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId)))
          .then((rows) => rows[0]);

        if (!host) {
          return res.status(404).json({ error: "Host not found" });
        }

        if (!host.macAddress || !isValidMac(host.macAddress)) {
          return res
            .status(400)
            .json({ error: "No valid MAC address configured" });
        }

        await sendWakeOnLan(host.macAddress);

        sshLogger.info("Wake-on-LAN packet sent", {
          operation: "wake_on_lan",
          userId,
          hostId,
        });

        res.json({ success: true });
      } catch (error) {
        sshLogger.error("Wake-on-LAN failed", error, {
          operation: "wake_on_lan",
          userId,
          hostId,
        });
        res.status(500).json({
          error:
            error instanceof Error
              ? error.message
              : "Failed to send WoL packet",
        });
      }
    },
  );
}
