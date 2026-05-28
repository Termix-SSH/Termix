import express from "express";
import { GuacamoleTokenService } from "./token-service.js";
import { guacLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { getDb } from "../database/db/index.js";
import { hosts } from "../database/db/schema.js";
import { eq } from "drizzle-orm";
import { Client } from "ssh2";
import net from "net";
import type { AuthenticatedRequest } from "../../types/index.js";

const router = express.Router();
const tokenService = GuacamoleTokenService.getInstance();
const authManager = AuthManager.getInstance();

router.use(authManager.createAuthMiddleware());

/**
 * @openapi
 * /guacamole/token:
 *   post:
 *     summary: Generate an encrypted Guacamole connection token
 *     description: Creates an AES-256-CBC encrypted token for guacamole-lite with the given connection parameters
 *     tags:
 *       - Guacamole
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - type
 *               - hostname
 *             properties:
 *               type:
 *                 type: string
 *                 enum: [rdp, vnc, telnet]
 *               hostname:
 *                 type: string
 *               port:
 *                 type: integer
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *               domain:
 *                 type: string
 *     responses:
 *       200:
 *         description: Encrypted connection token
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *       400:
 *         description: Invalid request
 *       500:
 *         description: Server error
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
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               protocol:
 *                 type: string
 *                 enum: [rdp, vnc, telnet]
 *                 description: Override the host's default connection type
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

      const requestedProtocol = req.body?.protocol as string | undefined;
      const connectionType =
        requestedProtocol || (host.connectionType as string);

      if (!["rdp", "vnc", "telnet"].includes(connectionType)) {
        return res.status(400).json({
          error: `Connection type '${connectionType}' is not supported for remote desktop. Only RDP, VNC, and Telnet are supported.`,
        });
      }

      const protocolEnabledMap: Record<string, boolean> = {
        rdp: !!host.enableRdp,
        vnc: !!host.enableVnc,
        telnet: !!host.enableTelnet,
      };
      if (!protocolEnabledMap[connectionType]) {
        return res.status(400).json({
          error: `${connectionType.toUpperCase()} is not enabled for this host.`,
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

      if (guacConfig.dpi != null) {
        const parsed = parseInt(String(guacConfig.dpi), 10);
        guacConfig.dpi =
          Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
      }

      let token: string;
      let hostname = host.ip as string;
      let port = host.port as number;
      let username: string;
      let password: string;

      switch (connectionType) {
        case "rdp":
          username =
            (host.rdpUser as string) || (host.username as string) || "";
          password =
            (host.rdpPassword as string) || (host.password as string) || "";
          port = (host.rdpPort as number) || port || 3389;
          break;
        case "vnc":
          username = (host.vncUser as string) || "";
          password =
            (host.vncPassword as string) || (host.password as string) || "";
          port = (host.vncPort as number) || port || 5900;
          break;
        case "telnet":
          username = (host.telnetUser as string) || "";
          password =
            (host.telnetPassword as string) || (host.password as string) || "";
          port = (host.telnetPort as number) || port || 23;
          break;
        default:
          username = "";
          password = "";
      }
      const domain =
        (host.rdpDomain as string) || (host.domain as string) || "";

      // Establish SSH tunnel if jump hosts are configured
      let jumpHosts: Array<{ hostId: number }> = [];
      if (host.jumpHosts) {
        try {
          jumpHosts =
            typeof host.jumpHosts === "string"
              ? JSON.parse(host.jumpHosts as string)
              : (host.jumpHosts as Array<{ hostId: number }>);
        } catch {
          jumpHosts = [];
        }
      }

      if (jumpHosts.length > 0) {
        try {
          const { resolveHostById } = await import("../ssh/host-resolver.js");
          const jumpHost = await resolveHostById(jumpHosts[0].hostId, userId);
          if (jumpHost) {
            const tunnelPort = await new Promise<number>((resolve, reject) => {
              const sshClient = new Client();
              sshClient.on("ready", () => {
                const server = net.createServer((sock) => {
                  sshClient.forwardOut(
                    "127.0.0.1",
                    0,
                    hostname,
                    port,
                    (err, stream) => {
                      if (err) {
                        sock.destroy();
                        return;
                      }
                      sock.pipe(stream).pipe(sock);
                    },
                  );
                });
                server.listen(0, "127.0.0.1", () => {
                  const addr = server.address() as net.AddressInfo;
                  // Auto-cleanup after 1 hour
                  setTimeout(
                    () => {
                      server.close();
                      sshClient.end();
                    },
                    60 * 60 * 1000,
                  );
                  resolve(addr.port);
                });
              });
              sshClient.on("error", reject);

              const connectOpts: Record<string, unknown> = {
                host: jumpHost.ip,
                port: jumpHost.port || 22,
                username: jumpHost.username,
                readyTimeout: 30000,
              };
              if (jumpHost.key) {
                connectOpts.privateKey = jumpHost.key;
                if (jumpHost.keyPassword)
                  connectOpts.passphrase = jumpHost.keyPassword;
              } else if (jumpHost.password) {
                connectOpts.password = jumpHost.password;
              }
              sshClient.connect(connectOpts);
            });
            hostname = "127.0.0.1";
            port = tunnelPort;
            guacLogger.info("SSH tunnel established for guacamole", {
              operation: "guac_ssh_tunnel",
              hostId,
              tunnelPort,
            });
          }
        } catch (tunnelError) {
          guacLogger.error("Failed to establish SSH tunnel", tunnelError, {
            operation: "guac_ssh_tunnel_error",
            hostId,
          });
          return res.status(500).json({
            error: "Failed to establish SSH tunnel to remote host",
          });
        }
      }

      switch (connectionType) {
        case "rdp":
          if (guacConfig["enable-drive"] && !guacConfig["drive-path"]) {
            guacConfig["drive-path"] = "/drive";
            guacConfig["create-drive-path"] = true;
          }
          token = tokenService.createRdpToken(hostname, username, password, {
            port,
            domain,
            security:
              (host.rdpSecurity as string) ||
              (host.security as string) ||
              undefined,
            "ignore-cert":
              host.rdpIgnoreCert !== undefined
                ? !!host.rdpIgnoreCert
                : host.ignoreCert !== undefined
                  ? !!host.ignoreCert
                  : true,
            ...guacConfig,
          });
          break;
        case "vnc":
          token = tokenService.createVncToken(
            hostname,
            username || undefined,
            password,
            {
              port,
              security: "any",
              ...guacConfig,
            },
          );
          break;
        case "telnet":
          token = tokenService.createTelnetToken(hostname, username, password, {
            port,
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
