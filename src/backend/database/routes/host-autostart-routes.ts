import type { Request, RequestHandler, Response, Router } from "express";
import type { AuthenticatedRequest } from "../../../types/index.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { sshLogger } from "../../utils/logger.js";
import { createCurrentHostRepository } from "../repositories/factory.js";

type HostAutostartRoutesDeps = {
  authenticateJWT: RequestHandler;
  requireDataAccess: RequestHandler;
};

export function registerHostAutostartRoutes(
  router: Router,
  { authenticateJWT, requireDataAccess }: HostAutostartRoutesDeps,
): void {
  /**
   * @openapi
   * /host/autostart/enable:
   *   post:
   *     summary: Enable autostart for SSH configuration
   *     description: Enables autostart for a specific SSH configuration.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sshConfigId:
   *                 type: number
   *     responses:
   *       200:
   *         description: AutoStart enabled successfully.
   *       400:
   *         description: Valid sshConfigId is required.
   *       404:
   *         description: SSH configuration not found.
   *       500:
   *         description: Internal server error.
   */
  router.post(
    "/autostart/enable",
    authenticateJWT,
    requireDataAccess,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { sshConfigId } = req.body;

      if (!sshConfigId || typeof sshConfigId !== "number") {
        sshLogger.warn(
          "Missing or invalid sshConfigId in autostart enable request",
          {
            operation: "autostart_enable",
            userId,
            sshConfigId,
          },
        );
        return res.status(400).json({ error: "Valid sshConfigId is required" });
      }

      try {
        const userDataKey = DataCrypto.getUserDataKey(userId);
        if (!userDataKey) {
          sshLogger.warn(
            "User attempted to enable autostart without unlocked data",
            {
              operation: "autostart_enable_failed",
              userId,
              sshConfigId,
              reason: "data_locked",
            },
          );
          return res.status(400).json({
            error: "Failed to enable autostart. Ensure user data is unlocked.",
          });
        }

        const hostRepository = createCurrentHostRepository();
        const config = await hostRepository.findByIdForUser(
          userId,
          sshConfigId,
        );

        if (!config) {
          sshLogger.warn("SSH config not found for autostart enable", {
            operation: "autostart_enable_failed",
            userId,
            sshConfigId,
            reason: "config_not_found",
          });
          return res.status(404).json({
            error: "SSH configuration not found",
          });
        }

        const decryptedConfig = DataCrypto.decryptRecord(
          "ssh_data",
          config,
          userId,
          userDataKey,
        );

        let updatedTunnelConnections = config.tunnelConnections;
        if (config.tunnelConnections) {
          try {
            const tunnelConnections = JSON.parse(config.tunnelConnections);
            const endpointHosts = await hostRepository.listByUserId(userId);

            const resolvedConnections = await Promise.all(
              tunnelConnections.map(async (tunnel: Record<string, unknown>) => {
                if (
                  tunnel.autoStart &&
                  tunnel.endpointHost &&
                  !tunnel.endpointPassword &&
                  !tunnel.endpointKey
                ) {
                  const endpointHost = endpointHosts.find(
                    (h) =>
                      h.name === tunnel.endpointHost ||
                      `${h.username}@${h.ip}` === tunnel.endpointHost,
                  );

                  if (endpointHost) {
                    const decryptedEndpoint = DataCrypto.decryptRecord(
                      "ssh_data",
                      endpointHost,
                      userId,
                      userDataKey,
                    );

                    return {
                      ...tunnel,
                      endpointPassword: decryptedEndpoint.password || null,
                      endpointKey: decryptedEndpoint.key || null,
                      endpointKeyPassword:
                        decryptedEndpoint.keyPassword || null,
                      endpointAuthType: endpointHost.authType,
                    };
                  }
                }
                return tunnel;
              }),
            );

            updatedTunnelConnections = JSON.stringify(resolvedConnections);
          } catch (error) {
            sshLogger.warn("Failed to update tunnel connections", {
              operation: "tunnel_connections_update_failed",
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        await hostRepository.updateForUser(userId, sshConfigId, {
          autostartPassword: decryptedConfig.password || null,
          autostartKey: decryptedConfig.key || null,
          autostartKeyPassword: decryptedConfig.keyPassword || null,
          tunnelConnections: updatedTunnelConnections,
        });

        res.json({
          message: "AutoStart enabled successfully",
          sshConfigId,
        });
      } catch (error) {
        sshLogger.error("Error enabling autostart", error, {
          operation: "autostart_enable_error",
          userId,
          sshConfigId,
        });
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  /**
   * @openapi
   * /host/autostart/disable:
   *   delete:
   *     summary: Disable autostart for SSH configuration
   *     description: Disables autostart for a specific SSH configuration.
   *     tags:
   *       - SSH
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sshConfigId:
   *                 type: number
   *     responses:
   *       200:
   *         description: AutoStart disabled successfully.
   *       400:
   *         description: Valid sshConfigId is required.
   *       500:
   *         description: Internal server error.
   */
  router.delete(
    "/autostart/disable",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;
      const { sshConfigId } = req.body;

      if (!sshConfigId || typeof sshConfigId !== "number") {
        sshLogger.warn(
          "Missing or invalid sshConfigId in autostart disable request",
          {
            operation: "autostart_disable",
            userId,
            sshConfigId,
          },
        );
        return res.status(400).json({ error: "Valid sshConfigId is required" });
      }

      try {
        await createCurrentHostRepository().updateForUser(userId, sshConfigId, {
          autostartPassword: null,
          autostartKey: null,
          autostartKeyPassword: null,
        });

        res.json({
          message: "AutoStart disabled successfully",
          sshConfigId,
        });
      } catch (error) {
        sshLogger.error("Error disabling autostart", error, {
          operation: "autostart_disable_error",
          userId,
          sshConfigId,
        });
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );

  /**
   * @openapi
   * /host/autostart/status:
   *   get:
   *     summary: Get autostart status
   *     description: Retrieves the autostart status for the user's SSH configurations.
   *     tags:
   *       - SSH
   *     responses:
   *       200:
   *         description: A list of autostart configurations.
   *       500:
   *         description: Internal server error.
   */
  router.get(
    "/autostart/status",
    authenticateJWT,
    async (req: Request, res: Response) => {
      const userId = (req as AuthenticatedRequest).userId;

      try {
        const autostartConfigs = (
          await createCurrentHostRepository().listByUserId(userId)
        ).filter((config) => config.autostartPassword || config.autostartKey);

        const statusList = autostartConfigs.map((config) => ({
          sshConfigId: config.id,
          host: config.ip,
          port: config.port,
          username: config.username,
          authType: config.authType,
        }));

        res.json({
          autostart_configs: statusList,
          total_count: statusList.length,
        });
      } catch (error) {
        sshLogger.error("Error getting autostart status", error, {
          operation: "autostart_status_error",
          userId,
        });
        res.status(500).json({ error: "Internal server error" });
      }
    },
  );
}
