import { getErrorMessage } from "../../utils/error-message.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import type { RequestHandler, Response, Router } from "express";
import { sshLogger } from "../../utils/logger.js";

interface HostNetworkRoutesDeps {
  authenticateJWT: RequestHandler;
  requireViewPermission: RequestHandler;
  requireDataAccess: RequestHandler;
}

export function registerHostNetworkRoutes(
  router: Router,
  {
    authenticateJWT,
    requireViewPermission,
    requireDataAccess,
  }: HostNetworkRoutesDeps,
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
    requireViewPermission,
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
          error: getErrorMessage(error),
        });
      }
    },
  );
}
