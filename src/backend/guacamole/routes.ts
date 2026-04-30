import express from "express";
import { GuacamoleTokenService } from "./token-service.js";
import { guacLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "../../types/index.js";

const router = express.Router();
const tokenService = GuacamoleTokenService.getInstance();
const authManager = AuthManager.getInstance();

router.use(authManager.createAuthMiddleware());

/**
 * POST /guacamole/token
 * Generate an encrypted connection token for guacamole-lite
 *
 * Body: {
 *   type: "rdp" | "vnc" | "telnet",
 *   hostname: string,
 *   port?: number,
 *   username?: string,
 *   password?: string,
 *   domain?: string,
 *   // Additional protocol-specific options
 * }
 */
router.post("/token", async (req, res) => {
  try {
    const { type, hostname, port, username, password, domain, ...options } =
      req.body;

    if (!type || !hostname) {
      return res
        .status(400)
        .json({ error: "Missing required fields: type and hostname" });
    }

    if (!["rdp", "vnc", "telnet"].includes(type)) {
      return res.status(400).json({
        error: "Invalid connection type. Must be rdp, vnc, or telnet",
      });
    }

    let token: string;

    switch (type) {
      case "rdp":
        token = tokenService.createRdpToken(
          hostname,
          username || "",
          password || "",
          {
            port: port || 3389,
            domain,
            ...options,
          },
        );
        break;
      case "vnc":
        token = tokenService.createVncToken(
          hostname,
          username || undefined,
          password,
          {
            port: port || 5900,
            ...options,
          },
        );
        break;
      case "telnet":
        token = tokenService.createTelnetToken(hostname, username, password, {
          port: port || 23,
          ...options,
        });
        break;
      default:
        return res.status(400).json({ error: "Invalid connection type" });
    }

    res.json({ token });
  } catch (error) {
    guacLogger.error("Failed to generate guacamole token", error, {
      operation: "guac_token_error",
    });
    res.status(500).json({ error: "Failed to generate connection token" });
  }
});

/**
 * @openapi
 * /guacamole/connect-host/{hostId}:
 *   post:
 *     summary: Generate Guacamole connection token from host configuration
 *     description: Fetches host configuration from database and generates a connection token for RDP/VNC/Telnet
 *     tags:
 *       - Guacamole
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Host ID to connect to
 *     responses:
 *       200:
 *         description: Connection token generated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                   description: Encrypted connection token
 *       400:
 *         description: Invalid request or unsupported connection type
 *       403:
 *         description: Access denied to host
 *       404:
 *         description: Host not found
 *       500:
 *         description: Server error
 */
router.post(
  "/connect-host/:hostId",
  async (req: express.Request, res: express.Response) => {
    try {
      const userId = (req as AuthenticatedRequest).userId!;
      const hostId = Number.parseInt(String(req.params.hostId), 10);

      if (!hostId || isNaN(hostId)) {
        return res.status(400).json({ error: "Invalid host ID" });
      }

      const hostResults = await SimpleDBOps.select(
        getDb().select().from(hosts).where(eq(hosts.id, hostId)),
        "ssh_data",
        userId,
      );

      if (hostResults.length === 0) {
        return res.status(404).json({ error: "Host not found" });
      }

      const host = hostResults[0];

      if (host.userId !== userId) {
        const permissionManager = PermissionManager.getInstance();
        const accessInfo = await permissionManager.canAccessHost(
          userId,
          hostId,
          "read",
        );

        if (!accessInfo.hasAccess) {
          guacLogger.warn("User attempted to access host without permission", {
            operation: "guac_access_denied",
            userId,
            hostId,
          });
          return res.status(403).json({ error: "Access denied to this host" });
        }
      }

      const connectionType = (host.connectionType as string) || "ssh";
      if (!["rdp", "vnc", "telnet"].includes(connectionType)) {
        return res.status(400).json({
          error: `Connection type '${connectionType}' is not supported for remote desktop. Only RDP, VNC, and Telnet are supported.`,
        });
      }

      let guacConfig: Record<string, unknown> = {};
      if (host.guacamoleConfig) {
        try {
          guacConfig =
            typeof host.guacamoleConfig === "string"
              ? JSON.parse(host.guacamoleConfig as string)
              : (host.guacamoleConfig as Record<string, unknown>);
        } catch (error) {
          guacLogger.warn("Failed to parse guacamole config", {
            operation: "guac_config_parse_error",
            hostId,
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      let token: string;
      const hostname = host.ip as string;
      const port = host.port as number;
      const username = (host.username as string) || "";
      const password = (host.password as string) || "";
      const domain = (host.domain as string) || "";

      switch (connectionType) {
        case "rdp":
          token = tokenService.createRdpToken(hostname, username, password, {
            port: port || 3389,
            domain,
            security: (host.security as string) || undefined,
            "ignore-cert": (host.ignoreCert as boolean) || false,
            ...guacConfig,
          });
          break;
        case "vnc":
          token = tokenService.createVncToken(
            hostname,
            username || undefined,
            password,
            {
              port: port || 5900,
              ...guacConfig,
            },
          );
          break;
        case "telnet":
          token = tokenService.createTelnetToken(hostname, username, password, {
            port: port || 23,
            ...guacConfig,
          });
          break;
        default:
          return res.status(400).json({ error: "Invalid connection type" });
      }

      res.json({ token });
    } catch (error) {
      guacLogger.error("Failed to generate guacamole token for host", error, {
        operation: "guac_host_token_error",
      });
      res.status(500).json({ error: "Failed to generate connection token" });
    }
  },
);

/**
 * GET /guacamole/status
 * Check if guacd is reachable
 */
router.get("/status", async (req, res) => {
  try {
    let guacdHost = process.env.GUACD_HOST || "localhost";
    let guacdPort = parseInt(process.env.GUACD_PORT || "4822", 10);
    try {
      const db = getDb();
      const urlRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'guac_url'")
        .get() as { value: string } | undefined;
      if (urlRow?.value) {
        const parts = urlRow.value.split(":");
        guacdHost = parts[0] || guacdHost;
        guacdPort = parseInt(parts[1] || String(guacdPort), 10);
      }
    } catch {
      // Fall back to env vars
    }

    const net = await import("net");

    const checkConnection = (): Promise<boolean> => {
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);

        socket.on("connect", () => {
          socket.destroy();
          resolve(true);
        });

        socket.on("timeout", () => {
          socket.destroy();
          resolve(false);
        });

        socket.on("error", () => {
          socket.destroy();
          resolve(false);
        });

        socket.connect(guacdPort, guacdHost);
      });
    };

    const isConnected = await checkConnection();

    res.json({
      guacd: {
        host: guacdHost,
        port: guacdPort,
        status: isConnected ? "connected" : "disconnected",
      },
      websocket: {
        port: 30008,
        status: "running",
      },
    });
  } catch (error) {
    guacLogger.error("Failed to check guacamole status", error, {
      operation: "guac_status_error",
    });
    res.status(500).json({ error: "Failed to check status" });
  }
});

export default router;
