import express, { type Response } from "express";

import axios from "axios";
import type {
  SSHHost,
  TunnelConfig,
  AuthenticatedRequest,
} from "../../../types/index.js";
import { CONNECTION_STATES } from "../../../types/index.js";
import { tunnelLogger } from "../../utils/logger.js";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";

import { getTunnelMode, validateTunnelConfig } from "./utils.js";

import {
  tunnelConfigs,
  activeRetryTimers,
  pendingTunnelOperations,
  manualDisconnects,
  retryExhaustedTunnels,
  retryCounters,
  countdownIntervals,
  tunnelConnecting,
  tunnelStatusClients,
  connectionStatus,
  cleanupTunnelResources,
  broadcastTunnelStatus,
  handleDisconnect,
  sendTunnelStatusSnapshot,
  isSingleHostTunnel,
  getAllTunnelStatus,
  findHostByTunnelEndpoint,
  connectSSHTunnel,
} from "./manager.js";

const permissionManager = PermissionManager.getInstance();

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();

export function registerTunnelRoutes(app: express.Express): void {
  app.get(
    "/ssh/tunnel/status",
    authenticateJWT,
    (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      res.json(getAllTunnelStatus());
    },
  );

  app.get(
    "/ssh/tunnel/status/stream",
    authenticateJWT,
    (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-store, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      });
      res.flushHeaders?.();

      tunnelStatusClients.add(res);
      sendTunnelStatusSnapshot(res);

      const heartbeat = setInterval(() => {
        try {
          res.write(": keepalive\n\n");
        } catch {
          closeStream();
        }
      }, 30000);

      const closeStream = () => {
        clearInterval(heartbeat);
        tunnelStatusClients.delete(res);
      };

      req.on("close", closeStream);
    },
  );

  /**
   * @openapi
   * /ssh/tunnel/status/{tunnelName}:
   *   get:
   *     summary: Get tunnel status by name
   *     description: Retrieves the status of a specific SSH tunnel by its name.
   *     tags:
   *       - SSH Tunnels
   *     parameters:
   *       - in: path
   *         name: tunnelName
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Tunnel status.
   *       404:
   *         description: Tunnel not found.
   */
  app.get(
    "/ssh/tunnel/status/:tunnelName",
    authenticateJWT,
    (req: AuthenticatedRequest, res: Response) => {
      if (!req.userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      const tunnelNameParam = req.params.tunnelName;
      const tunnelName = Array.isArray(tunnelNameParam)
        ? tunnelNameParam[0]
        : tunnelNameParam;
      const status = connectionStatus.get(tunnelName);

      if (!status) {
        return res.status(404).json({ error: "Tunnel not found" });
      }

      res.json({ name: tunnelName, status });
    },
  );

  /**
   * @openapi
   * /ssh/tunnel/connect:
   *   post:
   *     summary: Connect SSH tunnel
   *     description: Establishes an SSH tunnel connection with the specified configuration.
   *     tags:
   *       - SSH Tunnels
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               name:
   *                 type: string
   *               sourceHostId:
   *                 type: integer
   *               tunnelIndex:
   *                 type: integer
   *     responses:
   *       200:
   *         description: Connection request received.
   *       400:
   *         description: Invalid tunnel configuration.
   *       401:
   *         description: Authentication required.
   *       403:
   *         description: Access denied to this host.
   *       500:
   *         description: Failed to connect tunnel.
   */
  app.post(
    "/ssh/tunnel/connect",
    authenticateJWT,
    async (req: AuthenticatedRequest, res: Response) => {
      const tunnelConfig: TunnelConfig = req.body;
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!tunnelConfig || !tunnelConfig.name) {
        return res.status(400).json({ error: "Invalid tunnel configuration" });
      }

      const tunnelName = tunnelConfig.name;
      tunnelConfig.requestingUserId = userId;

      try {
        if (!validateTunnelConfig(tunnelName, tunnelConfig)) {
          tunnelLogger.error(`Tunnel config validation failed`, {
            operation: "tunnel_connect",
            tunnelName,
            configHostId: tunnelConfig.sourceHostId,
            configTunnelIndex: tunnelConfig.tunnelIndex,
          });
          return res.status(400).json({
            error: "Tunnel configuration does not match tunnel name",
          });
        }

        if (tunnelConfig.sourceHostId) {
          const accessInfo = await permissionManager.canAccessHost(
            userId,
            tunnelConfig.sourceHostId,
            "connect",
          );

          if (!accessInfo.hasAccess) {
            tunnelLogger.warn("User attempted tunnel connect without access", {
              operation: "tunnel_connect_unauthorized",
              userId,
              hostId: tunnelConfig.sourceHostId,
              tunnelName,
            });
            return res
              .status(403)
              .json({ error: "Access denied to this host" });
          }
        }

        if (pendingTunnelOperations.has(tunnelName)) {
          try {
            await pendingTunnelOperations.get(tunnelName);
          } catch {
            tunnelLogger.warn(`Previous tunnel operation failed`, {
              tunnelName,
            });
          }
        }

        const operation = (async () => {
          manualDisconnects.delete(tunnelName);
          retryCounters.delete(tunnelName);
          retryExhaustedTunnels.delete(tunnelName);

          await cleanupTunnelResources(tunnelName);

          if (tunnelConfigs.has(tunnelName)) {
            const existingConfig = tunnelConfigs.get(tunnelName);
            if (
              existingConfig &&
              (existingConfig.sourceHostId !== tunnelConfig.sourceHostId ||
                existingConfig.tunnelIndex !== tunnelConfig.tunnelIndex)
            ) {
              throw new Error(`Tunnel name collision detected: ${tunnelName}`);
            }
          }

          if (
            !isSingleHostTunnel(tunnelConfig) &&
            (!tunnelConfig.endpointIP || !tunnelConfig.endpointUsername)
          ) {
            try {
              const systemCrypto = SystemCrypto.getInstance();
              const internalAuthToken =
                await systemCrypto.getInternalAuthToken();

              const allHostsResponse = await axios.get(
                "http://localhost:30001/host/db/host/internal/all",
                {
                  headers: {
                    "Content-Type": "application/json",
                    "X-Internal-Auth-Token": internalAuthToken,
                  },
                },
              );

              const allHosts: SSHHost[] = allHostsResponse.data || [];
              const endpointHost = findHostByTunnelEndpoint(
                allHosts,
                tunnelConfig.endpointHost,
              );

              if (!endpointHost) {
                if (getTunnelMode(tunnelConfig) !== "remote") {
                  tunnelConfig.endpointIP =
                    tunnelConfig.endpointIP || tunnelConfig.endpointHost;
                } else {
                  throw new Error(
                    `Endpoint host '${tunnelConfig.endpointHost}' not found in database`,
                  );
                }
              } else {
                if (!endpointHost.id) {
                  throw new Error("Endpoint host not found");
                }

                const endpointAccess = await permissionManager.canAccessHost(
                  userId,
                  endpointHost.id,
                  "connect",
                );
                if (!endpointAccess.hasAccess) {
                  tunnelLogger.warn(
                    "User attempted tunnel connect without endpoint access",
                    {
                      operation: "tunnel_connect_endpoint_unauthorized",
                      userId,
                      hostId: endpointHost.id,
                      tunnelName,
                    },
                  );
                  throw new Error("Endpoint host not found");
                }

                tunnelConfig.endpointIP = endpointHost.ip;
                tunnelConfig.endpointSSHPort = endpointHost.port;
                tunnelConfig.endpointUsername = endpointHost.username;
                tunnelConfig.endpointAuthMethod = endpointHost.authType;
                tunnelConfig.endpointKeyType = endpointHost.keyType;
                tunnelConfig.endpointCredentialId =
                  endpointHost.userId === userId
                    ? endpointHost.credentialId
                    : undefined;
                tunnelConfig.endpointUserId = userId;

                // Resolve credentials server-side instead of from HTTP response
                if (endpointHost.id) {
                  try {
                    const { resolveHostById } =
                      await import("../host-resolver.js");
                    const resolved = await resolveHostById(
                      endpointHost.id,
                      userId,
                    );
                    if (resolved) {
                      tunnelConfig.endpointPassword = resolved.password;
                      tunnelConfig.endpointSSHKey = resolved.key;
                      tunnelConfig.endpointKeyPassword = resolved.keyPassword;
                    }
                  } catch (credError) {
                    tunnelLogger.warn(
                      "Failed to resolve endpoint credentials from DB",
                      {
                        operation: "tunnel_endpoint_credential_resolve",
                        endpointHostId: endpointHost.id,
                        error:
                          credError instanceof Error
                            ? credError.message
                            : "Unknown",
                      },
                    );
                  }
                }
              }
            } catch (resolveError) {
              tunnelLogger.error(
                "Failed to resolve endpoint host",
                resolveError,
                {
                  operation: "tunnel_connect_resolve_endpoint_failed",
                  tunnelName,
                  endpointHost: tunnelConfig.endpointHost,
                },
              );
              throw new Error(
                `Failed to resolve endpoint host: ${resolveError instanceof Error ? resolveError.message : "Unknown error"}`,
                { cause: resolveError },
              );
            }
          }

          tunnelConfigs.set(tunnelName, tunnelConfig);
          await connectSSHTunnel(tunnelConfig, 0);
        })();

        pendingTunnelOperations.set(tunnelName, operation);

        res.json({ message: "Connection request received", tunnelName });

        operation
          .catch((err) => {
            tunnelLogger.error("Tunnel operation failed", err, {
              operation: "tunnel_operation_failed",
              tunnelName,
            });
            broadcastTunnelStatus(tunnelName, {
              connected: false,
              status: CONNECTION_STATES.FAILED,
              reason: err instanceof Error ? err.message : "Unknown error",
            });
            tunnelConnecting.delete(tunnelName);
          })
          .finally(() => {
            pendingTunnelOperations.delete(tunnelName);
          });
      } catch (error) {
        tunnelLogger.error("Failed to process tunnel connect", error, {
          operation: "tunnel_connect",
          tunnelName,
          userId,
        });
        res.status(500).json({ error: "Failed to connect tunnel" });
      }
    },
  );

  /**
   * @openapi
   * /ssh/tunnel/disconnect:
   *   post:
   *     summary: Disconnect SSH tunnel
   *     description: Disconnects an active SSH tunnel.
   *     tags:
   *       - SSH Tunnels
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               tunnelName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Disconnect request received.
   *       400:
   *         description: Tunnel name required.
   *       401:
   *         description: Authentication required.
   *       403:
   *         description: Access denied.
   *       500:
   *         description: Failed to disconnect tunnel.
   */
  app.post(
    "/ssh/tunnel/disconnect",
    authenticateJWT,
    async (req: AuthenticatedRequest, res: Response) => {
      const { tunnelName } = req.body;
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!tunnelName) {
        return res.status(400).json({ error: "Tunnel name required" });
      }

      try {
        const config = tunnelConfigs.get(tunnelName);
        if (config && config.sourceHostId) {
          const accessInfo = await permissionManager.canAccessHost(
            userId,
            config.sourceHostId,
            "connect",
          );
          if (!accessInfo.hasAccess) {
            return res.status(403).json({ error: "Access denied" });
          }
        }

        tunnelLogger.info("Tunnel stop request received", {
          operation: "tunnel_stop_request",
          userId,
          hostId: config?.sourceHostId,
          tunnelName,
        });
        manualDisconnects.add(tunnelName);
        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);

        if (activeRetryTimers.has(tunnelName)) {
          clearTimeout(activeRetryTimers.get(tunnelName)!);
          activeRetryTimers.delete(tunnelName);
        }

        await cleanupTunnelResources(tunnelName, true);
        tunnelLogger.info("Tunnel cleanup completed", {
          operation: "tunnel_cleanup_complete",
          userId,
          hostId: config?.sourceHostId,
          tunnelName,
        });

        broadcastTunnelStatus(tunnelName, {
          connected: false,
          status: CONNECTION_STATES.DISCONNECTED,
          manualDisconnect: true,
        });

        const tunnelConfig = tunnelConfigs.get(tunnelName) || null;
        handleDisconnect(tunnelName, tunnelConfig, false);

        setTimeout(() => {
          manualDisconnects.delete(tunnelName);
        }, 5000);

        res.json({ message: "Disconnect request received", tunnelName });
      } catch (error) {
        tunnelLogger.error("Failed to disconnect tunnel", error, {
          operation: "tunnel_disconnect",
          tunnelName,
          userId,
        });
        res.status(500).json({ error: "Failed to disconnect tunnel" });
      }
    },
  );

  /**
   * @openapi
   * /ssh/tunnel/cancel:
   *   post:
   *     summary: Cancel tunnel retry
   *     description: Cancels the retry mechanism for a failed SSH tunnel connection.
   *     tags:
   *       - SSH Tunnels
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               tunnelName:
   *                 type: string
   *     responses:
   *       200:
   *         description: Cancel request received.
   *       400:
   *         description: Tunnel name required.
   *       401:
   *         description: Authentication required.
   *       403:
   *         description: Access denied.
   *       500:
   *         description: Failed to cancel tunnel retry.
   */
  app.post(
    "/ssh/tunnel/cancel",
    authenticateJWT,
    async (req: AuthenticatedRequest, res: Response) => {
      const { tunnelName } = req.body;
      const userId = req.userId;

      if (!userId) {
        return res.status(401).json({ error: "Authentication required" });
      }

      if (!tunnelName) {
        return res.status(400).json({ error: "Tunnel name required" });
      }

      try {
        const config = tunnelConfigs.get(tunnelName);
        if (config && config.sourceHostId) {
          const accessInfo = await permissionManager.canAccessHost(
            userId,
            config.sourceHostId,
            "connect",
          );
          if (!accessInfo.hasAccess) {
            return res.status(403).json({ error: "Access denied" });
          }
        }

        retryCounters.delete(tunnelName);
        retryExhaustedTunnels.delete(tunnelName);

        if (activeRetryTimers.has(tunnelName)) {
          clearTimeout(activeRetryTimers.get(tunnelName)!);
          activeRetryTimers.delete(tunnelName);
        }

        if (countdownIntervals.has(tunnelName)) {
          clearInterval(countdownIntervals.get(tunnelName)!);
          countdownIntervals.delete(tunnelName);
        }

        await cleanupTunnelResources(tunnelName, true);

        broadcastTunnelStatus(tunnelName, {
          connected: false,
          status: CONNECTION_STATES.DISCONNECTED,
          manualDisconnect: true,
        });

        const tunnelConfig = tunnelConfigs.get(tunnelName) || null;
        handleDisconnect(tunnelName, tunnelConfig, false);

        setTimeout(() => {
          manualDisconnects.delete(tunnelName);
        }, 5000);

        res.json({ message: "Cancel request received", tunnelName });
      } catch (error) {
        tunnelLogger.error("Failed to cancel tunnel retry", error, {
          operation: "tunnel_cancel",
          tunnelName,
          userId,
        });
        res.status(500).json({ error: "Failed to cancel tunnel retry" });
      }
    },
  );
}
