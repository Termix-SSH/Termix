import type { Request, Response, Router } from "express";
import { and, eq, isNotNull } from "drizzle-orm";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { sshLogger } from "../../utils/logger.js";
import { db } from "../db/index.js";
import { hosts } from "../db/schema.js";

export function registerHostInternalRoutes(router: Router): void {
  /**
   * @openapi
   * /host/db/host/internal:
   *   get:
   *     summary: Get internal SSH host data
   *     description: Returns internal SSH host data for autostart tunnels. Requires internal auth token.
   *     tags:
   *       - SSH
   *     responses:
   *       200:
   *         description: A list of autostart hosts.
   *       403:
   *         description: Forbidden.
   *       500:
   *         description: Failed to fetch autostart SSH data.
   */
  router.get("/db/host/internal", async (req: Request, res: Response) => {
    try {
      const internalToken = req.headers["x-internal-auth-token"];
      const systemCrypto = SystemCrypto.getInstance();
      const expectedToken = await systemCrypto.getInternalAuthToken();

      if (internalToken !== expectedToken) {
        sshLogger.warn(
          "Unauthorized attempt to access internal SSH host endpoint",
          {
            source: req.ip,
            userAgent: req.headers["user-agent"],
            providedToken: internalToken ? "present" : "missing",
          },
        );
        return res.status(403).json({ error: "Forbidden" });
      }
    } catch (error) {
      sshLogger.error("Failed to validate internal auth token", error);
      return res.status(500).json({ error: "Internal server error" });
    }

    try {
      const autostartHosts = await db
        .select()
        .from(hosts)
        .where(
          and(eq(hosts.enableTunnel, true), isNotNull(hosts.tunnelConnections)),
        );

      const result = autostartHosts
        .map((host) => {
          const tunnelConnections = host.tunnelConnections
            ? JSON.parse(host.tunnelConnections)
            : [];

          const hasAutoStartTunnels = tunnelConnections.some(
            (tunnel: Record<string, unknown>) => tunnel.autoStart,
          );

          if (!hasAutoStartTunnels) {
            return null;
          }

          return {
            id: host.id,
            userId: host.userId,
            name: host.name || `autostart-${host.id}`,
            ip: host.ip,
            port: host.port,
            username: host.username,
            authType: host.authType,
            keyType: host.keyType,
            credentialId: host.credentialId,
            enableTunnel: true,
            tunnelConnections: tunnelConnections.filter(
              (tunnel: Record<string, unknown>) => tunnel.autoStart,
            ),
            pin: !!host.pin,
            enableTerminal: !!host.enableTerminal,
            enableFileManager: !!host.enableFileManager,
            showTerminalInSidebar: !!host.showTerminalInSidebar,
            showFileManagerInSidebar: !!host.showFileManagerInSidebar,
            showTunnelInSidebar: !!host.showTunnelInSidebar,
            showDockerInSidebar: !!host.showDockerInSidebar,
            showServerStatsInSidebar: !!host.showServerStatsInSidebar,
            tags: ["autostart"],
          };
        })
        .filter(Boolean);

      res.json(result);
    } catch (err) {
      sshLogger.error("Failed to fetch autostart SSH data", err);
      res.status(500).json({ error: "Failed to fetch autostart SSH data" });
    }
  });

  /**
   * @openapi
   * /host/db/host/internal/all:
   *   get:
   *     summary: Get all internal SSH host data
   *     description: Returns all internal SSH host data. Requires internal auth token.
   *     tags:
   *       - SSH
   *     responses:
   *       200:
   *         description: A list of all hosts.
   *       401:
   *         description: Invalid or missing internal authentication token.
   *       500:
   *         description: Failed to fetch all hosts.
   */
  router.get("/db/host/internal/all", async (req: Request, res: Response) => {
    try {
      const internalToken = req.headers["x-internal-auth-token"];
      if (!internalToken) {
        return res
          .status(401)
          .json({ error: "Internal authentication token required" });
      }

      const systemCrypto = SystemCrypto.getInstance();
      const expectedToken = await systemCrypto.getInternalAuthToken();

      if (internalToken !== expectedToken) {
        return res
          .status(401)
          .json({ error: "Invalid internal authentication token" });
      }

      const allHosts = await db.select().from(hosts);

      const result = allHosts.map((host) => {
        const tunnelConnections = host.tunnelConnections
          ? JSON.parse(host.tunnelConnections)
          : [];

        return {
          id: host.id,
          userId: host.userId,
          name: host.name || `${host.username}@${host.ip}`,
          ip: host.ip,
          port: host.port,
          username: host.username,
          authType: host.authType,
          keyType: host.keyType,
          credentialId: host.credentialId,
          enableTunnel: !!host.enableTunnel,
          tunnelConnections: tunnelConnections,
          pin: !!host.pin,
          enableTerminal: !!host.enableTerminal,
          enableFileManager: !!host.enableFileManager,
          showTerminalInSidebar: !!host.showTerminalInSidebar,
          showFileManagerInSidebar: !!host.showFileManagerInSidebar,
          showTunnelInSidebar: !!host.showTunnelInSidebar,
          showDockerInSidebar: !!host.showDockerInSidebar,
          showServerStatsInSidebar: !!host.showServerStatsInSidebar,
          defaultPath: host.defaultPath,
          createdAt: host.createdAt,
          updatedAt: host.updatedAt,
        };
      });

      res.json(result);
    } catch (err) {
      sshLogger.error("Failed to fetch all hosts for internal use", err);
      res.status(500).json({ error: "Failed to fetch all hosts" });
    }
  });
}
