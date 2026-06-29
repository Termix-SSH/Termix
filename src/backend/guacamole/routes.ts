import express from "express";
import { GuacamoleTokenService } from "./token-service.js";
import { guacLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { PermissionManager } from "../utils/permission-manager.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { getDb } from "../database/db/index.js";
import { hosts, sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { Client } from "ssh2";
import net from "net";
import type { AuthenticatedRequest } from "../../types/index.js";
import { resolveGuacdOptions } from "../utils/guacd-config.js";

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
    const { type, hostname, port, username, password, domain, ...rawOptions } =
      req.body;

    // Strip "auto" sentinel values before forwarding to guacd
    const options: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(rawOptions)) {
      if (value !== "auto") options[key] = value;
    }

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

      // Old hosts only had connectionType set; enableRdp/enableVnc/enableTelnet defaulted to false.
      // Apply the same migration fallback used in host.ts GET routes.
      const ct = host.connectionType as string;
      const rdpRaw = !!host.enableRdp;
      const vncRaw = !!host.enableVnc;
      const telRaw = !!host.enableTelnet;
      const isMigratedNonSsh =
        !rdpRaw && !vncRaw && !telRaw && ct && ct !== "ssh";
      const protocolEnabledMap: Record<string, boolean> = {
        rdp: isMigratedNonSsh ? ct === "rdp" : rdpRaw,
        vnc: isMigratedNonSsh ? ct === "vnc" : vncRaw,
        telnet: isMigratedNonSsh ? ct === "telnet" : telRaw,
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

      // Strip "auto" sentinel values — these mean "use guacd default" in the UI
      // but guacd doesn't recognise "auto" as a valid parameter value.
      for (const key of Object.keys(guacConfig)) {
        if (guacConfig[key] === "auto") {
          delete guacConfig[key];
        }
      }

      // Extract per-connection guacd proxy settings before passing the rest as connection settings
      const perConnectionGuacdHost = guacConfig["guacd-hostname"] as
        | string
        | undefined;
      const perConnectionGuacdPortRaw = guacConfig["guacd-port"];
      const perConnectionGuacdPort = perConnectionGuacdPortRaw
        ? parseInt(String(perConnectionGuacdPortRaw), 10) || undefined
        : undefined;
      delete guacConfig["guacd-hostname"];
      delete guacConfig["guacd-port"];

      if (guacConfig.dpi != null) {
        const parsed = parseInt(String(guacConfig.dpi), 10);
        guacConfig.dpi =
          Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
      }

      const hostRecord = host as Record<string, unknown>;

      // Backward compat: if authType is not stored but a credentialId is, treat as credential mode
      const rdpEffectiveAuthType =
        (host.rdpAuthType as string) ||
        (host.rdpCredentialId ? "credential" : "direct");
      const vncEffectiveAuthType =
        (host.vncAuthType as string) ||
        (host.vncCredentialId ? "credential" : "direct");
      const telnetEffectiveAuthType =
        (host.telnetAuthType as string) ||
        (hostRecord.telnetCredentialId ? "credential" : "direct");

      if (rdpEffectiveAuthType === "credential" && host.rdpCredentialId) {
        try {
          const rdpCreds = await SimpleDBOps.select(
            getDb()
              .select()
              .from(sshCredentials)
              .where(
                and(
                  eq(sshCredentials.id, host.rdpCredentialId as number),
                  eq(sshCredentials.userId, host.userId as string),
                ),
              ),
            "ssh_credentials",
            userId,
          );
          if (rdpCreds.length > 0) {
            const cred = rdpCreds[0] as Record<string, unknown>;
            if (cred.username) host.rdpUser = cred.username;
            if (cred.password) host.rdpPassword = cred.password;
            // domain is never sourced from credential
          }
        } catch (e) {
          guacLogger.warn("Failed to resolve RDP credential", {
            operation: "guac_rdp_credential_resolve",
            hostId,
            error: e instanceof Error ? e.message : "Unknown",
          });
        }
      }

      if (vncEffectiveAuthType === "credential" && host.vncCredentialId) {
        try {
          const vncCreds = await SimpleDBOps.select(
            getDb()
              .select()
              .from(sshCredentials)
              .where(
                and(
                  eq(sshCredentials.id, host.vncCredentialId as number),
                  eq(sshCredentials.userId, host.userId as string),
                ),
              ),
            "ssh_credentials",
            userId,
          );
          if (vncCreds.length > 0) {
            const cred = vncCreds[0] as Record<string, unknown>;
            if (cred.password) host.vncPassword = cred.password;
            if (cred.username) host.vncUser = cred.username;
          }
        } catch (e) {
          guacLogger.warn("Failed to resolve VNC credential", {
            operation: "guac_vnc_credential_resolve",
            hostId,
            error: e instanceof Error ? e.message : "Unknown",
          });
        }
      }

      if (
        telnetEffectiveAuthType === "credential" &&
        hostRecord.telnetCredentialId
      ) {
        try {
          const telnetCreds = await SimpleDBOps.select(
            getDb()
              .select()
              .from(sshCredentials)
              .where(
                and(
                  eq(
                    sshCredentials.id,
                    hostRecord.telnetCredentialId as number,
                  ),
                  eq(sshCredentials.userId, host.userId as string),
                ),
              ),
            "ssh_credentials",
            userId,
          );
          if (telnetCreds.length > 0) {
            const cred = telnetCreds[0] as Record<string, unknown>;
            if (cred.username) host.telnetUser = cred.username;
            if (cred.password) host.telnetPassword = cred.password;
          }
        } catch (e) {
          guacLogger.warn("Failed to resolve Telnet credential", {
            operation: "guac_telnet_credential_resolve",
            hostId,
            error: e instanceof Error ? e.message : "Unknown",
          });
        }
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

      const guacdOverrides = {
        ...(perConnectionGuacdHost
          ? { guacdHost: perConnectionGuacdHost }
          : {}),
        ...(perConnectionGuacdPort
          ? { guacdPort: perConnectionGuacdPort }
          : {}),
      };

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
            ...guacdOverrides,
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
              ...guacdOverrides,
            },
          );
          break;
        case "telnet":
          token = tokenService.createTelnetToken(hostname, username, password, {
            port,
            ...guacConfig,
            ...guacdOverrides,
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
    let dbUrl: string | undefined;
    try {
      const db = getDb();
      const urlRow = db.$client
        .prepare("SELECT value FROM settings WHERE key = 'guac_url'")
        .get() as { value: string } | undefined;
      dbUrl = urlRow?.value;
    } catch {
      // Fall back to env vars
    }
    const { host: guacdHost, port: guacdPort } = resolveGuacdOptions(dbUrl);

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
