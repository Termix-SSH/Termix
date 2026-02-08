import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import {
  sshData,
  sshCredentials,
  sshCredentialUsage,
  fileManagerRecent,
  fileManagerPinned,
  fileManagerShortcuts,
  sshFolders,
  commandHistory,
  recentActivity,
  hostAccess,
  userRoles,
  sessionRecordings,
} from "../db/schema.js";
import {
  eq,
  and,
  desc,
  isNotNull,
  or,
  isNull,
  gte,
  sql,
  inArray,
} from "drizzle-orm";
import type { Request, Response } from "express";
import multer from "multer";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { DatabaseSaveTrigger } from "../db/index.js";
import { parseSSHKey } from "../../utils/ssh-key-utils.js";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && port > 0 && port <= 65535;
}

function transformHostResponse(
  host: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...host,
    tags:
      typeof host.tags === "string"
        ? host.tags
          ? host.tags.split(",").filter(Boolean)
          : []
        : [],
    pin: !!host.pin,
    enableTerminal: !!host.enableTerminal,
    enableTunnel: !!host.enableTunnel,
    enableFileManager: !!host.enableFileManager,
    enableDocker: !!host.enableDocker,
    showTerminalInSidebar: !!host.showTerminalInSidebar,
    showFileManagerInSidebar: !!host.showFileManagerInSidebar,
    showTunnelInSidebar: !!host.showTunnelInSidebar,
    showDockerInSidebar: !!host.showDockerInSidebar,
    showServerStatsInSidebar: !!host.showServerStatsInSidebar,
    tunnelConnections: host.tunnelConnections
      ? JSON.parse(host.tunnelConnections as string)
      : [],
    jumpHosts: host.jumpHosts ? JSON.parse(host.jumpHosts as string) : [],
    quickActions: host.quickActions
      ? JSON.parse(host.quickActions as string)
      : [],
    statsConfig: host.statsConfig
      ? JSON.parse(host.statsConfig as string)
      : undefined,
    terminalConfig: host.terminalConfig
      ? JSON.parse(host.terminalConfig as string)
      : undefined,
    dockerConfig: host.dockerConfig
      ? JSON.parse(host.dockerConfig as string)
      : undefined,
    forceKeyboardInteractive: host.forceKeyboardInteractive === "true",
    socks5ProxyChain: host.socks5ProxyChain
      ? JSON.parse(host.socks5ProxyChain as string)
      : [],
  };
}

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

/**
 * @openapi
 * /ssh/db/host/internal:
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
      .from(sshData)
      .where(
        and(
          eq(sshData.enableTunnel, true),
          isNotNull(sshData.tunnelConnections),
        ),
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
          password: host.autostartPassword,
          key: host.autostartKey,
          keyPassword: host.autostartKeyPassword,
          autostartPassword: host.autostartPassword,
          autostartKey: host.autostartKey,
          autostartKeyPassword: host.autostartKeyPassword,
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
 * /ssh/db/host/internal/all:
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

    const allHosts = await db.select().from(sshData);

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
        password: host.autostartPassword || host.password,
        key: host.autostartKey || host.key,
        keyPassword: host.autostartKeyPassword || host.key_password,
        autostartPassword: host.autostartPassword,
        autostartKey: host.autostartKey,
        autostartKeyPassword: host.autostartKeyPassword,
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

/**
 * @openapi
 * /ssh/db/host:
 *   post:
 *     summary: Create SSH host
 *     description: Creates a new SSH host configuration.
 *     tags:
 *       - SSH
 *     responses:
 *       200:
 *         description: Host created successfully.
 *       400:
 *         description: Invalid SSH data.
 *       500:
 *         description: Failed to save SSH data.
 */
router.post(
  "/db/host",
  authenticateJWT,
  requireDataAccess,
  upload.single("key"),
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    let hostData: Record<string, unknown>;

    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      if (req.body.data) {
        try {
          hostData = JSON.parse(req.body.data);
        } catch (err) {
          sshLogger.warn("Invalid JSON data in multipart request", {
            operation: "host_create",
            userId,
            error: err,
          });
          return res.status(400).json({ error: "Invalid JSON data" });
        }
      } else {
        sshLogger.warn("Missing data field in multipart request", {
          operation: "host_create",
          userId,
        });
        return res.status(400).json({ error: "Missing data field" });
      }

      if (req.file) {
        hostData.key = req.file.buffer.toString("utf8");
      }
    } else {
      hostData = req.body;
    }

    const {
      name,
      folder,
      tags,
      ip,
      port,
      username,
      password,
      authMethod,
      authType,
      credentialId,
      key,
      keyPassword,
      keyType,
      sudoPassword,
      pin,
      enableTerminal,
      enableTunnel,
      enableFileManager,
      enableDocker,
      showTerminalInSidebar,
      showFileManagerInSidebar,
      showTunnelInSidebar,
      showDockerInSidebar,
      showServerStatsInSidebar,
      defaultPath,
      tunnelConnections,
      jumpHosts,
      quickActions,
      statsConfig,
      terminalConfig,
      forceKeyboardInteractive,
      notes,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
      overrideCredentialUsername,
    } = hostData;
    databaseLogger.info("Creating SSH host", {
      operation: "host_create",
      userId,
      name,
      ip,
    });

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(ip) ||
      !isValidPort(port)
    ) {
      sshLogger.warn("Invalid SSH data input validation failed", {
        operation: "host_create",
        userId,
        hasIp: !!ip,
        port,
        isValidPort: isValidPort(port),
      });
      return res.status(400).json({ error: "Invalid SSH data" });
    }

    const effectiveAuthType = authType || authMethod;
    const sshDataObj: Record<string, unknown> = {
      userId: userId,
      name,
      folder: folder || null,
      tags: Array.isArray(tags) ? tags.join(",") : tags || "",
      ip,
      port,
      username,
      authType: effectiveAuthType,
      credentialId: credentialId || null,
      overrideCredentialUsername: overrideCredentialUsername ? 1 : 0,
      pin: pin ? 1 : 0,
      enableTerminal: enableTerminal ? 1 : 0,
      enableTunnel: enableTunnel ? 1 : 0,
      tunnelConnections: Array.isArray(tunnelConnections)
        ? JSON.stringify(tunnelConnections)
        : null,
      jumpHosts: Array.isArray(jumpHosts) ? JSON.stringify(jumpHosts) : null,
      quickActions: Array.isArray(quickActions)
        ? JSON.stringify(quickActions)
        : null,
      enableFileManager: enableFileManager ? 1 : 0,
      enableDocker: enableDocker ? 1 : 0,
      showTerminalInSidebar: showTerminalInSidebar ? 1 : 0,
      showFileManagerInSidebar: showFileManagerInSidebar ? 1 : 0,
      showTunnelInSidebar: showTunnelInSidebar ? 1 : 0,
      showDockerInSidebar: showDockerInSidebar ? 1 : 0,
      showServerStatsInSidebar: showServerStatsInSidebar ? 1 : 0,
      defaultPath: defaultPath || null,
      statsConfig: statsConfig ? JSON.stringify(statsConfig) : null,
      terminalConfig: terminalConfig ? JSON.stringify(terminalConfig) : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
      notes: notes || null,
      sudoPassword: sudoPassword || null,
      useSocks5: useSocks5 ? 1 : 0,
      socks5Host: socks5Host || null,
      socks5Port: socks5Port || null,
      socks5Username: socks5Username || null,
      socks5Password: socks5Password || null,
      socks5ProxyChain: socks5ProxyChain
        ? JSON.stringify(socks5ProxyChain)
        : null,
    };

    if (effectiveAuthType === "password") {
      sshDataObj.password = password || null;
      sshDataObj.key = null;
      sshDataObj.key_password = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "key") {
      if (key && typeof key === "string") {
        if (!key.includes("-----BEGIN") || !key.includes("-----END")) {
          sshLogger.warn("Invalid SSH key format provided", {
            operation: "host_create",
            userId,
            name,
            ip,
            port,
          });
          return res.status(400).json({
            error: "Invalid SSH key format. Key must be in PEM format.",
          });
        }

        const keyValidation = parseSSHKey(
          key,
          typeof keyPassword === "string" ? keyPassword : undefined,
        );
        if (!keyValidation.success) {
          sshLogger.warn("SSH key validation failed", {
            operation: "host_create",
            userId,
            name,
            ip,
            port,
            error: keyValidation.error,
          });
          return res.status(400).json({
            error: `Invalid SSH key: ${keyValidation.error || "Unable to parse key"}`,
          });
        }
      }

      sshDataObj.key = key || null;
      sshDataObj.key_password = keyPassword || null;
      sshDataObj.keyType = keyType;
      sshDataObj.password = null;
    } else {
      sshDataObj.password = null;
      sshDataObj.key = null;
      sshDataObj.key_password = null;
      sshDataObj.keyType = null;
    }

    try {
      const result = await SimpleDBOps.insert(
        sshData,
        "ssh_data",
        sshDataObj,
        userId,
      );

      if (!result) {
        sshLogger.warn("No host returned after creation", {
          operation: "host_create",
          userId,
          name,
          ip,
          port,
        });
        return res.status(500).json({ error: "Failed to create host" });
      }

      const createdHost = result;
      const baseHost = transformHostResponse(createdHost);

      const resolvedHost =
        (await resolveHostCredentials(baseHost, userId)) || baseHost;
      databaseLogger.success("SSH host created", {
        operation: "host_create_success",
        userId,
        hostId: createdHost.id as number,
        name,
      });

      try {
        const axios = (await import("axios")).default;
        const statsPort = process.env.STATS_PORT || 30005;
        await axios.post(
          `http://localhost:${statsPort}/host-updated`,
          { hostId: createdHost.id },
          {
            headers: {
              Authorization: req.headers.authorization || "",
              Cookie: req.headers.cookie || "",
            },
            timeout: 5000,
          },
        );
      } catch (err) {
        sshLogger.warn("Failed to notify stats server of new host", {
          operation: "host_create",
          hostId: createdHost.id as number,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.json(resolvedHost);
    } catch (err) {
      sshLogger.error("Failed to save SSH host to database", err, {
        operation: "host_create",
        userId,
        name,
        ip,
        port,
        authType: effectiveAuthType,
      });
      res.status(500).json({ error: "Failed to save SSH data" });
    }
  },
);

/**
 * @openapi
 * /ssh/quick-connect:
 *   post:
 *     summary: Create a temporary SSH connection without saving to database
 *     description: Returns a temporary host configuration for immediate use
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - ip
 *               - port
 *               - username
 *               - authType
 *             properties:
 *               ip:
 *                 type: string
 *                 description: SSH server IP or hostname
 *               port:
 *                 type: number
 *                 description: SSH server port
 *               username:
 *                 type: string
 *                 description: SSH username
 *               authType:
 *                 type: string
 *                 enum: [password, key, credential]
 *                 description: Authentication method
 *               password:
 *                 type: string
 *                 description: Password (required if authType is password)
 *               key:
 *                 type: string
 *                 description: SSH private key (required if authType is key)
 *               keyPassword:
 *                 type: string
 *                 description: SSH key password (optional)
 *               keyType:
 *                 type: string
 *                 description: SSH key type
 *               credentialId:
 *                 type: number
 *                 description: Credential ID (required if authType is credential)
 *               overrideCredentialUsername:
 *                 type: boolean
 *                 description: Use provided username instead of credential username
 *     responses:
 *       200:
 *         description: Temporary host configuration created successfully
 *       400:
 *         description: Invalid request data
 *       401:
 *         description: Unauthorized
 *       403:
 *         description: Forbidden
 *       404:
 *         description: Credential not found
 *       500:
 *         description: Server error
 */
router.post(
  "/quick-connect",
  authenticateJWT,
  requireDataAccess,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId;
    const {
      ip,
      port,
      username,
      authType,
      password,
      key,
      keyPassword,
      keyType,
      credentialId,
      overrideCredentialUsername,
    } = req.body;

    if (
      !isNonEmptyString(ip) ||
      !isValidPort(port) ||
      !isNonEmptyString(username) ||
      !authType
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    try {
      let resolvedPassword = password;
      let resolvedKey = key;
      let resolvedKeyPassword = keyPassword;
      let resolvedKeyType = keyType;
      let resolvedAuthType = authType;
      let resolvedUsername = username;

      if (authType === "credential" && credentialId) {
        const credentials = await SimpleDBOps.select(
          db
            .select()
            .from(sshCredentials)
            .where(
              and(
                eq(sshCredentials.id, credentialId),
                eq(sshCredentials.userId, userId),
              ),
            ),
          "ssh_credentials",
          userId,
        );

        if (!credentials || credentials.length === 0) {
          return res.status(404).json({ error: "Credential not found" });
        }

        const cred = credentials[0];

        resolvedPassword = cred.password as string | undefined;
        resolvedKey = (cred.private_key || cred.privateKey || cred.key) as
          | string
          | undefined;
        resolvedKeyPassword = (cred.key_password || cred.keyPassword) as
          | string
          | undefined;
        resolvedKeyType = (cred.key_type || cred.keyType) as string | undefined;
        resolvedAuthType = (cred.auth_type || cred.authType) as
          | string
          | undefined;

        if (!overrideCredentialUsername) {
          resolvedUsername = cred.username as string;
        }
      }

      const tempHost: Record<string, unknown> = {
        id: -Date.now(),
        userId: userId,
        name: `${resolvedUsername}@${ip}:${port}`,
        ip,
        port: Number(port),
        username: resolvedUsername,
        folder: "",
        tags: [],
        pin: false,
        authType: resolvedAuthType || authType,
        password: resolvedPassword,
        key: resolvedKey,
        keyPassword: resolvedKeyPassword,
        keyType: resolvedKeyType,
        enableTerminal: true,
        enableTunnel: false,
        enableFileManager: true,
        enableDocker: false,
        showTerminalInSidebar: true,
        showFileManagerInSidebar: false,
        showTunnelInSidebar: false,
        showDockerInSidebar: false,
        showServerStatsInSidebar: false,
        defaultPath: "/",
        tunnelConnections: [],
        jumpHosts: [],
        quickActions: [],
        statsConfig: {},
        notes: "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      return res.status(200).json(tempHost);
    } catch (error) {
      sshLogger.error("Quick connect failed", error, {
        operation: "quick_connect",
        userId,
        ip,
        port,
        authType,
      });
      return res
        .status(500)
        .json({ error: "Failed to create quick connection" });
    }
  },
);

/**
 * @openapi
 * /ssh/db/host/{id}:
 *   put:
 *     summary: Update SSH host
 *     description: Updates an existing SSH host configuration.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Host updated successfully.
 *       400:
 *         description: Invalid SSH data.
 *       403:
 *         description: Access denied.
 *       404:
 *         description: Host not found.
 *       500:
 *         description: Failed to update SSH data.
 */
router.put(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  upload.single("key"),
  async (req: Request, res: Response) => {
    const hostId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const userId = (req as AuthenticatedRequest).userId;
    let hostData: Record<string, unknown>;

    if (req.headers["content-type"]?.includes("multipart/form-data")) {
      if (req.body.data) {
        try {
          hostData = JSON.parse(req.body.data);
        } catch (err) {
          sshLogger.warn("Invalid JSON data in multipart request", {
            operation: "host_update",
            hostId: parseInt(hostId),
            userId,
            error: err,
          });
          return res.status(400).json({ error: "Invalid JSON data" });
        }
      } else {
        sshLogger.warn("Missing data field in multipart request", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(400).json({ error: "Missing data field" });
      }

      if (req.file) {
        hostData.key = req.file.buffer.toString("utf8");
      }
    } else {
      hostData = req.body;
    }

    const {
      name,
      folder,
      tags,
      ip,
      port,
      username,
      password,
      authMethod,
      authType,
      credentialId,
      key,
      keyPassword,
      keyType,
      sudoPassword,
      pin,
      enableTerminal,
      enableTunnel,
      enableFileManager,
      enableDocker,
      showTerminalInSidebar,
      showFileManagerInSidebar,
      showTunnelInSidebar,
      showDockerInSidebar,
      showServerStatsInSidebar,
      defaultPath,
      tunnelConnections,
      jumpHosts,
      quickActions,
      statsConfig,
      terminalConfig,
      forceKeyboardInteractive,
      notes,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
      overrideCredentialUsername,
    } = hostData;
    databaseLogger.info("Updating SSH host", {
      operation: "host_update",
      userId,
      hostId: parseInt(hostId),
      changes: Object.keys(hostData),
    });

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(ip) ||
      !isValidPort(port) ||
      !hostId
    ) {
      sshLogger.warn("Invalid SSH data input validation failed for update", {
        operation: "host_update",
        hostId: parseInt(hostId),
        userId,
        hasIp: !!ip,
        port,
        isValidPort: isValidPort(port),
      });
      return res.status(400).json({ error: "Invalid SSH data" });
    }

    const effectiveAuthType = authType || authMethod;
    const sshDataObj: Record<string, unknown> = {
      name,
      folder,
      tags: Array.isArray(tags) ? tags.join(",") : tags || "",
      ip,
      port,
      username,
      authType: effectiveAuthType,
      credentialId: credentialId || null,
      overrideCredentialUsername: overrideCredentialUsername ? 1 : 0,
      pin: pin ? 1 : 0,
      enableTerminal: enableTerminal ? 1 : 0,
      enableTunnel: enableTunnel ? 1 : 0,
      tunnelConnections: Array.isArray(tunnelConnections)
        ? JSON.stringify(tunnelConnections)
        : null,
      jumpHosts: Array.isArray(jumpHosts) ? JSON.stringify(jumpHosts) : null,
      quickActions: Array.isArray(quickActions)
        ? JSON.stringify(quickActions)
        : null,
      enableFileManager: enableFileManager ? 1 : 0,
      enableDocker: enableDocker ? 1 : 0,
      showTerminalInSidebar: showTerminalInSidebar ? 1 : 0,
      showFileManagerInSidebar: showFileManagerInSidebar ? 1 : 0,
      showTunnelInSidebar: showTunnelInSidebar ? 1 : 0,
      showDockerInSidebar: showDockerInSidebar ? 1 : 0,
      showServerStatsInSidebar: showServerStatsInSidebar ? 1 : 0,
      defaultPath: defaultPath || null,
      statsConfig: statsConfig ? JSON.stringify(statsConfig) : null,
      terminalConfig: terminalConfig ? JSON.stringify(terminalConfig) : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
      notes: notes || null,
      sudoPassword: sudoPassword || null,
      useSocks5: useSocks5 ? 1 : 0,
      socks5Host: socks5Host || null,
      socks5Port: socks5Port || null,
      socks5Username: socks5Username || null,
      socks5Password: socks5Password || null,
      socks5ProxyChain: socks5ProxyChain
        ? JSON.stringify(socks5ProxyChain)
        : null,
    };

    if (effectiveAuthType === "password") {
      if (password) {
        sshDataObj.password = password;
      }
      sshDataObj.key = null;
      sshDataObj.key_password = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "key") {
      if (key && typeof key === "string") {
        if (!key.includes("-----BEGIN") || !key.includes("-----END")) {
          sshLogger.warn("Invalid SSH key format provided", {
            operation: "host_update",
            hostId: parseInt(hostId),
            userId,
            name,
            ip,
            port,
          });
          return res.status(400).json({
            error: "Invalid SSH key format. Key must be in PEM format.",
          });
        }

        const keyValidation = parseSSHKey(
          key,
          typeof keyPassword === "string" ? keyPassword : undefined,
        );
        if (!keyValidation.success) {
          sshLogger.warn("SSH key validation failed", {
            operation: "host_update",
            hostId: parseInt(hostId),
            userId,
            name,
            ip,
            port,
            error: keyValidation.error,
          });
          return res.status(400).json({
            error: `Invalid SSH key: ${keyValidation.error || "Unable to parse key"}`,
          });
        }

        sshDataObj.key = key;
      }
      if (keyPassword !== undefined) {
        sshDataObj.key_password = keyPassword || null;
      }
      if (keyType) {
        sshDataObj.keyType = keyType;
      }
      sshDataObj.password = null;
    } else {
      sshDataObj.password = null;
      sshDataObj.key = null;
      sshDataObj.key_password = null;
      sshDataObj.keyType = null;
    }

    try {
      const accessInfo = await permissionManager.canAccessHost(
        userId,
        Number(hostId),
        "write",
      );

      if (!accessInfo.hasAccess) {
        sshLogger.warn("User does not have permission to update host", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(403).json({ error: "Access denied" });
      }

      if (!accessInfo.isOwner) {
        sshLogger.warn("Shared user attempted to update host (view-only)", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(403).json({
          error: "Only the host owner can modify host configuration",
        });
      }

      const hostRecord = await db
        .select({
          userId: sshData.userId,
          credentialId: sshData.credentialId,
          authType: sshData.authType,
        })
        .from(sshData)
        .where(eq(sshData.id, Number(hostId)))
        .limit(1);

      if (hostRecord.length === 0) {
        sshLogger.warn("Host not found for update", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "Host not found" });
      }

      const ownerId = hostRecord[0].userId;

      if (
        !accessInfo.isOwner &&
        sshDataObj.credentialId !== undefined &&
        sshDataObj.credentialId !== hostRecord[0].credentialId
      ) {
        return res.status(403).json({
          error: "Only the host owner can change the credential",
        });
      }

      if (
        !accessInfo.isOwner &&
        sshDataObj.authType !== undefined &&
        sshDataObj.authType !== hostRecord[0].authType
      ) {
        return res.status(403).json({
          error: "Only the host owner can change the authentication type",
        });
      }

      if (sshDataObj.credentialId !== undefined) {
        if (
          hostRecord[0].credentialId !== null &&
          sshDataObj.credentialId === null
        ) {
          const revokedShares = await db
            .delete(hostAccess)
            .where(eq(hostAccess.hostId, Number(hostId)))
            .returning({ id: hostAccess.id, userId: hostAccess.userId });
        }
      }

      await SimpleDBOps.update(
        sshData,
        "ssh_data",
        eq(sshData.id, Number(hostId)),
        sshDataObj,
        ownerId,
      );

      const updatedHosts = await SimpleDBOps.select(
        db
          .select()
          .from(sshData)
          .where(eq(sshData.id, Number(hostId))),
        "ssh_data",
        ownerId,
      );

      if (updatedHosts.length === 0) {
        sshLogger.warn("Updated host not found after update", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "Host not found after update" });
      }

      const updatedHost = updatedHosts[0];
      const baseHost = transformHostResponse(updatedHost);

      const resolvedHost =
        (await resolveHostCredentials(baseHost, userId)) || baseHost;
      databaseLogger.success("SSH host updated", {
        operation: "host_update_success",
        userId,
        hostId: parseInt(hostId),
      });

      try {
        const axios = (await import("axios")).default;
        const statsPort = process.env.STATS_PORT || 30005;
        await axios.post(
          `http://localhost:${statsPort}/host-updated`,
          { hostId: parseInt(hostId) },
          {
            headers: {
              Authorization: req.headers.authorization || "",
              Cookie: req.headers.cookie || "",
            },
            timeout: 5000,
          },
        );
      } catch (err) {
        sshLogger.warn("Failed to notify stats server of host update", {
          operation: "host_update",
          hostId: parseInt(hostId),
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.json(resolvedHost);
    } catch (err) {
      sshLogger.error("Failed to update SSH host in database", err, {
        operation: "host_update",
        hostId: parseInt(hostId),
        userId,
        name,
        ip,
        port,
        authType: effectiveAuthType,
      });
      res.status(500).json({ error: "Failed to update SSH data" });
    }
  },
);

/**
 * @openapi
 * /ssh/db/host:
 *   get:
 *     summary: Get all SSH hosts
 *     description: Retrieves all SSH hosts for the authenticated user.
 *     tags:
 *       - SSH
 *     responses:
 *       200:
 *         description: A list of SSH hosts.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to fetch SSH data.
 */
router.get(
  "/db/host",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    if (!isNonEmptyString(userId)) {
      sshLogger.warn("Invalid userId for SSH data fetch", {
        operation: "host_fetch",
        userId,
      });
      return res.status(400).json({ error: "Invalid userId" });
    }
    try {
      const now = new Date().toISOString();

      const userRoleIds = await db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));
      const roleIds = userRoleIds.map((r) => r.roleId);

      const rawData = await db
        .select({
          id: sshData.id,
          userId: sshData.userId,
          name: sshData.name,
          ip: sshData.ip,
          port: sshData.port,
          username: sshData.username,
          folder: sshData.folder,
          tags: sshData.tags,
          pin: sshData.pin,
          authType: sshData.authType,
          password: sshData.password,
          key: sshData.key,
          keyPassword: sshData.key_password,
          keyType: sshData.keyType,
          enableTerminal: sshData.enableTerminal,
          enableTunnel: sshData.enableTunnel,
          tunnelConnections: sshData.tunnelConnections,
          jumpHosts: sshData.jumpHosts,
          enableFileManager: sshData.enableFileManager,
          defaultPath: sshData.defaultPath,
          autostartPassword: sshData.autostartPassword,
          autostartKey: sshData.autostartKey,
          autostartKeyPassword: sshData.autostartKeyPassword,
          forceKeyboardInteractive: sshData.forceKeyboardInteractive,
          statsConfig: sshData.statsConfig,
          terminalConfig: sshData.terminalConfig,
          sudoPassword: sshData.sudoPassword,
          createdAt: sshData.createdAt,
          updatedAt: sshData.updatedAt,
          credentialId: sshData.credentialId,
          overrideCredentialUsername: sshData.overrideCredentialUsername,
          quickActions: sshData.quickActions,
          notes: sshData.notes,
          enableDocker: sshData.enableDocker,
          showTerminalInSidebar: sshData.showTerminalInSidebar,
          showFileManagerInSidebar: sshData.showFileManagerInSidebar,
          showTunnelInSidebar: sshData.showTunnelInSidebar,
          showDockerInSidebar: sshData.showDockerInSidebar,
          showServerStatsInSidebar: sshData.showServerStatsInSidebar,
          useSocks5: sshData.useSocks5,
          socks5Host: sshData.socks5Host,
          socks5Port: sshData.socks5Port,
          socks5Username: sshData.socks5Username,
          socks5Password: sshData.socks5Password,
          socks5ProxyChain: sshData.socks5ProxyChain,

          ownerId: sshData.userId,
          isShared: sql<boolean>`${hostAccess.id} IS NOT NULL AND ${sshData.userId} != ${userId}`,
          permissionLevel: hostAccess.permissionLevel,
          expiresAt: hostAccess.expiresAt,
        })
        .from(sshData)
        .leftJoin(
          hostAccess,
          and(
            eq(hostAccess.hostId, sshData.id),
            or(
              eq(hostAccess.userId, userId),
              roleIds.length > 0
                ? inArray(hostAccess.roleId, roleIds)
                : sql`false`,
            ),
            or(isNull(hostAccess.expiresAt), gte(hostAccess.expiresAt, now)),
          ),
        )
        .where(
          or(
            eq(sshData.userId, userId),
            and(
              eq(hostAccess.userId, userId),
              or(isNull(hostAccess.expiresAt), gte(hostAccess.expiresAt, now)),
            ),
            roleIds.length > 0
              ? and(
                  inArray(hostAccess.roleId, roleIds),
                  or(
                    isNull(hostAccess.expiresAt),
                    gte(hostAccess.expiresAt, now),
                  ),
                )
              : sql`false`,
          ),
        );

      const ownHosts = rawData.filter((row) => row.userId === userId);
      const sharedHosts = rawData.filter((row) => row.userId !== userId);

      let decryptedOwnHosts: any[] = [];
      try {
        decryptedOwnHosts = await SimpleDBOps.select(
          Promise.resolve(ownHosts),
          "ssh_data",
          userId,
        );
      } catch (decryptError) {
        sshLogger.error("Failed to decrypt own hosts", decryptError, {
          operation: "host_fetch_own_decrypt_failed",
          userId,
        });
        decryptedOwnHosts = [];
      }

      const sanitizedSharedHosts = sharedHosts;

      const data = [...decryptedOwnHosts, ...sanitizedSharedHosts];

      const result = await Promise.all(
        data.map(async (row: Record<string, unknown>) => {
          const baseHost = {
            ...transformHostResponse(row),
            isShared: !!row.isShared,
            permissionLevel: row.permissionLevel || undefined,
            sharedExpiresAt: row.expiresAt || undefined,
          };

          const resolved =
            (await resolveHostCredentials(baseHost, userId)) || baseHost;
          return resolved;
        }),
      );

      res.json(result);
    } catch (err) {
      sshLogger.error("Failed to fetch SSH hosts from database", err, {
        operation: "host_fetch",
        userId,
      });
      res.status(500).json({ error: "Failed to fetch SSH data" });
    }
  },
);

/**
 * @openapi
 * /ssh/db/host/{id}:
 *   get:
 *     summary: Get SSH host by ID
 *     description: Retrieves a specific SSH host by its ID.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The requested SSH host.
 *       400:
 *         description: Invalid userId or hostId.
 *       404:
 *         description: SSH host not found.
 *       500:
 *         description: Failed to fetch SSH host.
 */
router.get(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId) || !hostId) {
      sshLogger.warn("Invalid userId or hostId for SSH host fetch by ID", {
        operation: "host_fetch_by_id",
        hostId: parseInt(hostId),
        userId,
      });
      return res.status(400).json({ error: "Invalid userId or hostId" });
    }
    try {
      const data = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)));

      if (data.length === 0) {
        sshLogger.warn("SSH host not found", {
          operation: "host_fetch_by_id",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "SSH host not found" });
      }

      const host = data[0];
      const result = transformHostResponse(host);

      res.json((await resolveHostCredentials(result, userId)) || result);
    } catch (err) {
      sshLogger.error("Failed to fetch SSH host by ID from database", err, {
        operation: "host_fetch_by_id",
        hostId: parseInt(hostId),
        userId,
      });
      res.status(500).json({ error: "Failed to fetch SSH host" });
    }
  },
);

/**
 * @openapi
 * /ssh/db/host/{id}/export:
 *   get:
 *     summary: Export SSH host
 *     description: Exports a specific SSH host with decrypted credentials.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: The exported SSH host.
 *       400:
 *         description: Invalid userId or hostId.
 *       404:
 *         description: SSH host not found.
 *       500:
 *         description: Failed to export SSH host.
 */
router.get(
  "/db/host/:id/export",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId) || !hostId) {
      return res.status(400).json({ error: "Invalid userId or hostId" });
    }

    try {
      const hosts = await SimpleDBOps.select(
        db
          .select()
          .from(sshData)
          .where(
            and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)),
          ),
        "ssh_data",
        userId,
      );

      if (hosts.length === 0) {
        return res.status(404).json({ error: "SSH host not found" });
      }

      const host = hosts[0];

      const resolvedHost = (await resolveHostCredentials(host, userId)) || host;

      const exportData = {
        name: resolvedHost.name,
        ip: resolvedHost.ip,
        port: resolvedHost.port,
        username: resolvedHost.username,
        authType: resolvedHost.authType,
        password: resolvedHost.password || null,
        key: resolvedHost.key || null,
        keyPassword: resolvedHost.key_password || null,
        keyType: resolvedHost.keyType || null,
        folder: resolvedHost.folder,
        tags:
          typeof resolvedHost.tags === "string"
            ? resolvedHost.tags.split(",").filter(Boolean)
            : resolvedHost.tags || [],
        pin: !!resolvedHost.pin,
        enableTerminal: !!resolvedHost.enableTerminal,
        enableTunnel: !!resolvedHost.enableTunnel,
        enableFileManager: !!resolvedHost.enableFileManager,
        defaultPath: resolvedHost.defaultPath,
        tunnelConnections: resolvedHost.tunnelConnections
          ? JSON.parse(resolvedHost.tunnelConnections as string)
          : [],
        socks5ProxyChain: resolvedHost.socks5ProxyChain
          ? JSON.parse(resolvedHost.socks5ProxyChain as string)
          : [],
      };

      sshLogger.success("Host exported with decrypted credentials", {
        operation: "host_export",
        hostId: parseInt(hostId),
        userId,
      });

      res.json(exportData);
    } catch (err) {
      sshLogger.error("Failed to export SSH host", err, {
        operation: "host_export",
        hostId: parseInt(hostId),
        userId,
      });
      res.status(500).json({ error: "Failed to export SSH host" });
    }
  },
);

/**
 * @openapi
 * /ssh/db/host/{id}:
 *   delete:
 *     summary: Delete SSH host
 *     description: Deletes an SSH host by its ID.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: SSH host deleted successfully.
 *       400:
 *         description: Invalid userId or id.
 *       404:
 *         description: SSH host not found.
 *       500:
 *         description: Failed to delete SSH host.
 */
router.delete(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = Array.isArray(req.params.id)
      ? req.params.id[0]
      : req.params.id;

    if (!isNonEmptyString(userId) || !hostId) {
      sshLogger.warn("Invalid userId or hostId for SSH host delete", {
        operation: "host_delete",
        hostId: parseInt(hostId),
        userId,
      });
      return res.status(400).json({ error: "Invalid userId or id" });
    }
    databaseLogger.info("Deleting SSH host", {
      operation: "host_delete",
      userId,
      hostId: parseInt(hostId),
    });
    try {
      const hostToDelete = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)));

      if (hostToDelete.length === 0) {
        sshLogger.warn("SSH host not found for deletion", {
          operation: "host_delete",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "SSH host not found" });
      }

      const numericHostId = Number(hostId);

      await db
        .delete(fileManagerRecent)
        .where(eq(fileManagerRecent.hostId, numericHostId));

      await db
        .delete(fileManagerPinned)
        .where(eq(fileManagerPinned.hostId, numericHostId));

      await db
        .delete(fileManagerShortcuts)
        .where(eq(fileManagerShortcuts.hostId, numericHostId));

      await db
        .delete(commandHistory)
        .where(eq(commandHistory.hostId, numericHostId));

      await db
        .delete(sshCredentialUsage)
        .where(eq(sshCredentialUsage.hostId, numericHostId));

      await db
        .delete(recentActivity)
        .where(eq(recentActivity.hostId, numericHostId));

      await db.delete(hostAccess).where(eq(hostAccess.hostId, numericHostId));

      await db
        .delete(sessionRecordings)
        .where(eq(sessionRecordings.hostId, numericHostId));

      await db
        .delete(sshData)
        .where(and(eq(sshData.id, numericHostId), eq(sshData.userId, userId)));

      const host = hostToDelete[0];
      databaseLogger.success("SSH host deleted", {
        operation: "host_delete_success",
        userId,
        hostId: parseInt(hostId),
      });

      try {
        const axios = (await import("axios")).default;
        const statsPort = process.env.STATS_PORT || 30005;
        await axios.post(
          `http://localhost:${statsPort}/host-deleted`,
          { hostId: numericHostId },
          {
            headers: {
              Authorization: req.headers.authorization || "",
              Cookie: req.headers.cookie || "",
            },
            timeout: 5000,
          },
        );
      } catch (err) {
        sshLogger.warn("Failed to notify stats server of host deletion", {
          operation: "host_delete",
          hostId: numericHostId,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.json({ message: "SSH host deleted" });
    } catch (err) {
      sshLogger.error("Failed to delete SSH host from database", err, {
        operation: "host_delete",
        hostId: parseInt(hostId),
        userId,
      });
      res.status(500).json({ error: "Failed to delete SSH host" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/recent:
 *   get:
 *     summary: Get recent files
 *     description: Retrieves a list of recent files for a specific host.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: query
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A list of recent files.
 *       400:
 *         description: Invalid userId or hostId.
 *       500:
 *         description: Failed to fetch recent files.
 */
router.get(
  "/file_manager/recent",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostIdQuery = Array.isArray(req.query.hostId)
      ? req.query.hostId[0]
      : req.query.hostId;
    const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

    if (!isNonEmptyString(userId)) {
      sshLogger.warn("Invalid userId for recent files fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!hostId) {
      sshLogger.warn("Host ID is required for recent files fetch");
      return res.status(400).json({ error: "Host ID is required" });
    }

    try {
      const recentFiles = await db
        .select()
        .from(fileManagerRecent)
        .where(
          and(
            eq(fileManagerRecent.userId, userId),
            eq(fileManagerRecent.hostId, hostId),
          ),
        )
        .orderBy(desc(fileManagerRecent.lastOpened))
        .limit(20);

      res.json(recentFiles);
    } catch (err) {
      sshLogger.error("Failed to fetch recent files", err);
      res.status(500).json({ error: "Failed to fetch recent files" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/recent:
 *   post:
 *     summary: Add recent file
 *     description: Adds a file to the list of recent files for a host.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               path:
 *                 type: string
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Recent file added.
 *       400:
 *         description: Invalid data.
 *       500:
 *         description: Failed to add recent file.
 */
router.post(
  "/file_manager/recent",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      sshLogger.warn("Invalid data for recent file addition");
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const existing = await db
        .select()
        .from(fileManagerRecent)
        .where(
          and(
            eq(fileManagerRecent.userId, userId),
            eq(fileManagerRecent.hostId, hostId),
            eq(fileManagerRecent.path, path),
          ),
        );

      if (existing.length > 0) {
        await db
          .update(fileManagerRecent)
          .set({ lastOpened: new Date().toISOString() })
          .where(eq(fileManagerRecent.id, existing[0].id));
      } else {
        await db.insert(fileManagerRecent).values({
          userId,
          hostId,
          path,
          name: name || path.split("/").pop() || "Unknown",
          lastOpened: new Date().toISOString(),
        });
      }

      res.json({ message: "Recent file added" });
    } catch (err) {
      sshLogger.error("Failed to add recent file", err);
      res.status(500).json({ error: "Failed to add recent file" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/recent:
 *   delete:
 *     summary: Remove recent file
 *     description: Removes a file from the list of recent files for a host.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               path:
 *                 type: string
 *     responses:
 *       200:
 *         description: Recent file removed.
 *       400:
 *         description: Invalid data.
 *       500:
 *         description: Failed to remove recent file.
 */
router.delete(
  "/file_manager/recent",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, path } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      sshLogger.warn("Invalid data for recent file deletion");
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      await db
        .delete(fileManagerRecent)
        .where(
          and(
            eq(fileManagerRecent.userId, userId),
            eq(fileManagerRecent.hostId, hostId),
            eq(fileManagerRecent.path, path),
          ),
        );

      res.json({ message: "Recent file removed" });
    } catch (err) {
      sshLogger.error("Failed to remove recent file", err);
      res.status(500).json({ error: "Failed to remove recent file" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/pinned:
 *   get:
 *     summary: Get pinned files
 *     description: Retrieves a list of pinned files for a specific host.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: query
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A list of pinned files.
 *       400:
 *         description: Invalid userId or hostId.
 *       500:
 *         description: Failed to fetch pinned files.
 */
router.get(
  "/file_manager/pinned",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostIdQuery = Array.isArray(req.query.hostId)
      ? req.query.hostId[0]
      : req.query.hostId;
    const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

    if (!isNonEmptyString(userId)) {
      sshLogger.warn("Invalid userId for pinned files fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!hostId) {
      sshLogger.warn("Host ID is required for pinned files fetch");
      return res.status(400).json({ error: "Host ID is required" });
    }

    try {
      const pinnedFiles = await db
        .select()
        .from(fileManagerPinned)
        .where(
          and(
            eq(fileManagerPinned.userId, userId),
            eq(fileManagerPinned.hostId, hostId),
          ),
        )
        .orderBy(desc(fileManagerPinned.pinnedAt));

      res.json(pinnedFiles);
    } catch (err) {
      sshLogger.error("Failed to fetch pinned files", err);
      res.status(500).json({ error: "Failed to fetch pinned files" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/pinned:
 *   post:
 *     summary: Add pinned file
 *     description: Adds a file to the list of pinned files for a host.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               path:
 *                 type: string
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: File pinned.
 *       400:
 *         description: Invalid data.
 *       409:
 *         description: File already pinned.
 *       500:
 *         description: Failed to pin file.
 */
router.post(
  "/file_manager/pinned",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      sshLogger.warn("Invalid data for pinned file addition");
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const existing = await db
        .select()
        .from(fileManagerPinned)
        .where(
          and(
            eq(fileManagerPinned.userId, userId),
            eq(fileManagerPinned.hostId, hostId),
            eq(fileManagerPinned.path, path),
          ),
        );

      if (existing.length > 0) {
        return res.status(409).json({ error: "File already pinned" });
      }

      await db.insert(fileManagerPinned).values({
        userId,
        hostId,
        path,
        name: name || path.split("/").pop() || "Unknown",
        pinnedAt: new Date().toISOString(),
      });

      res.json({ message: "File pinned" });
    } catch (err) {
      sshLogger.error("Failed to pin file", err);
      res.status(500).json({ error: "Failed to pin file" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/pinned:
 *   delete:
 *     summary: Remove pinned file
 *     description: Removes a file from the list of pinned files for a host.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               path:
 *                 type: string
 *     responses:
 *       200:
 *         description: Pinned file removed.
 *       400:
 *         description: Invalid data.
 *       500:
 *         description: Failed to remove pinned file.
 */
router.delete(
  "/file_manager/pinned",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, path } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      sshLogger.warn("Invalid data for pinned file deletion");
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      await db
        .delete(fileManagerPinned)
        .where(
          and(
            eq(fileManagerPinned.userId, userId),
            eq(fileManagerPinned.hostId, hostId),
            eq(fileManagerPinned.path, path),
          ),
        );

      res.json({ message: "Pinned file removed" });
    } catch (err) {
      sshLogger.error("Failed to remove pinned file", err);
      res.status(500).json({ error: "Failed to remove pinned file" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/shortcuts:
 *   get:
 *     summary: Get shortcuts
 *     description: Retrieves a list of shortcuts for a specific host.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: query
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A list of shortcuts.
 *       400:
 *         description: Invalid userId or hostId.
 *       500:
 *         description: Failed to fetch shortcuts.
 */
router.get(
  "/file_manager/shortcuts",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostIdQuery = Array.isArray(req.query.hostId)
      ? req.query.hostId[0]
      : req.query.hostId;
    const hostId = hostIdQuery ? parseInt(hostIdQuery as string) : null;

    if (!isNonEmptyString(userId)) {
      sshLogger.warn("Invalid userId for shortcuts fetch");
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!hostId) {
      sshLogger.warn("Host ID is required for shortcuts fetch");
      return res.status(400).json({ error: "Host ID is required" });
    }

    try {
      const shortcuts = await db
        .select()
        .from(fileManagerShortcuts)
        .where(
          and(
            eq(fileManagerShortcuts.userId, userId),
            eq(fileManagerShortcuts.hostId, hostId),
          ),
        )
        .orderBy(desc(fileManagerShortcuts.createdAt));

      res.json(shortcuts);
    } catch (err) {
      sshLogger.error("Failed to fetch shortcuts", err);
      res.status(500).json({ error: "Failed to fetch shortcuts" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/shortcuts:
 *   post:
 *     summary: Add shortcut
 *     description: Adds a shortcut for a specific host.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               path:
 *                 type: string
 *               name:
 *                 type: string
 *     responses:
 *       200:
 *         description: Shortcut added.
 *       400:
 *         description: Invalid data.
 *       409:
 *         description: Shortcut already exists.
 *       500:
 *         description: Failed to add shortcut.
 */
router.post(
  "/file_manager/shortcuts",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, path, name } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      sshLogger.warn("Invalid data for shortcut addition");
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const existing = await db
        .select()
        .from(fileManagerShortcuts)
        .where(
          and(
            eq(fileManagerShortcuts.userId, userId),
            eq(fileManagerShortcuts.hostId, hostId),
            eq(fileManagerShortcuts.path, path),
          ),
        );

      if (existing.length > 0) {
        return res.status(409).json({ error: "Shortcut already exists" });
      }

      await db.insert(fileManagerShortcuts).values({
        userId,
        hostId,
        path,
        name: name || path.split("/").pop() || "Unknown",
        createdAt: new Date().toISOString(),
      });

      res.json({ message: "Shortcut added" });
    } catch (err) {
      sshLogger.error("Failed to add shortcut", err);
      res.status(500).json({ error: "Failed to add shortcut" });
    }
  },
);

/**
 * @openapi
 * /ssh/file_manager/shortcuts:
 *   delete:
 *     summary: Remove shortcut
 *     description: Removes a shortcut for a specific host.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               path:
 *                 type: string
 *     responses:
 *       200:
 *         description: Shortcut removed.
 *       400:
 *         description: Invalid data.
 *       500:
 *         description: Failed to remove shortcut.
 */
router.delete(
  "/file_manager/shortcuts",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, path } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !path) {
      sshLogger.warn("Invalid data for shortcut deletion");
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      await db
        .delete(fileManagerShortcuts)
        .where(
          and(
            eq(fileManagerShortcuts.userId, userId),
            eq(fileManagerShortcuts.hostId, hostId),
            eq(fileManagerShortcuts.path, path),
          ),
        );

      res.json({ message: "Shortcut removed" });
    } catch (err) {
      sshLogger.error("Failed to remove shortcut", err);
      res.status(500).json({ error: "Failed to remove shortcut" });
    }
  },
);

/**
 * @openapi
 * /ssh/command-history/{hostId}:
 *   get:
 *     summary: Get command history
 *     description: Retrieves the command history for a specific host.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: hostId
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: A list of commands.
 *       400:
 *         description: Invalid userId or hostId.
 *       500:
 *         description: Failed to fetch command history.
 */
router.get(
  "/command-history/:hostId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostIdParam = Array.isArray(req.params.hostId)
      ? req.params.hostId[0]
      : req.params.hostId;
    const hostId = parseInt(hostIdParam, 10);

    if (!isNonEmptyString(userId) || !hostId) {
      sshLogger.warn("Invalid userId or hostId for command history fetch", {
        operation: "command_history_fetch",
        hostId,
        userId,
      });
      return res.status(400).json({ error: "Invalid userId or hostId" });
    }

    try {
      const history = await db
        .select({
          id: commandHistory.id,
          command: commandHistory.command,
        })
        .from(commandHistory)
        .where(
          and(
            eq(commandHistory.userId, userId),
            eq(commandHistory.hostId, hostId),
          ),
        )
        .orderBy(desc(commandHistory.executedAt))
        .limit(200);

      res.json(history.map((h) => h.command));
    } catch (err) {
      sshLogger.error("Failed to fetch command history from database", err, {
        operation: "command_history_fetch",
        hostId,
        userId,
      });
      res.status(500).json({ error: "Failed to fetch command history" });
    }
  },
);

/**
 * @openapi
 * /ssh/command-history:
 *   delete:
 *     summary: Delete command from history
 *     description: Deletes a specific command from the history of a host.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               command:
 *                 type: string
 *     responses:
 *       200:
 *         description: Command deleted from history.
 *       400:
 *         description: Invalid data.
 *       500:
 *         description: Failed to delete command.
 */
router.delete(
  "/command-history",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostId, command } = req.body;

    if (!isNonEmptyString(userId) || !hostId || !command) {
      sshLogger.warn("Invalid data for command history deletion", {
        operation: "command_history_delete",
        hostId,
        userId,
      });
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      await db
        .delete(commandHistory)
        .where(
          and(
            eq(commandHistory.userId, userId),
            eq(commandHistory.hostId, hostId),
            eq(commandHistory.command, command),
          ),
        );

      res.json({ message: "Command deleted from history" });
    } catch (err) {
      sshLogger.error("Failed to delete command from history", err, {
        operation: "command_history_delete",
        hostId,
        userId,
        command,
      });
      res.status(500).json({ error: "Failed to delete command" });
    }
  },
);

async function resolveHostCredentials(
  host: Record<string, unknown>,
  requestingUserId?: string,
): Promise<Record<string, unknown>> {
  try {
    if (host.credentialId && (host.userId || host.ownerId)) {
      const credentialId = host.credentialId as number;
      const ownerId = (host.ownerId || host.userId) as string;

      if (requestingUserId && requestingUserId !== ownerId) {
        try {
          const { SharedCredentialManager } =
            await import("../../utils/shared-credential-manager.js");
          const sharedCredManager = SharedCredentialManager.getInstance();
          const sharedCred = await sharedCredManager.getSharedCredentialForUser(
            host.id as number,
            requestingUserId,
          );

          if (sharedCred) {
            const resolvedHost: Record<string, unknown> = {
              ...host,
              password: sharedCred.password,
              key: sharedCred.key,
              keyPassword: sharedCred.keyPassword,
              keyType: sharedCred.keyType,
            };

            if (!host.overrideCredentialUsername) {
              resolvedHost.username = sharedCred.username;
            }

            return resolvedHost;
          }
        } catch (sharedCredError) {
          sshLogger.warn(
            "Failed to get shared credential, falling back to owner credential",
            {
              operation: "resolve_shared_credential_fallback",
              hostId: host.id as number,
              requestingUserId,
              error:
                sharedCredError instanceof Error
                  ? sharedCredError.message
                  : "Unknown error",
            },
          );
        }
      }

      const credentials = await SimpleDBOps.select(
        db
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, credentialId),
              eq(sshCredentials.userId, ownerId),
            ),
          ),
        "ssh_credentials",
        ownerId,
      );

      if (credentials.length > 0) {
        const credential = credentials[0];
        const resolvedHost: Record<string, unknown> = {
          ...host,
          password: credential.password,
          key: credential.key,
          keyPassword: credential.key_password || credential.keyPassword,
          keyType: credential.key_type || credential.keyType,
        };

        if (!host.overrideCredentialUsername) {
          resolvedHost.username = credential.username;
        }

        return resolvedHost;
      }
    }

    const result = { ...host };
    if (host.key_password !== undefined) {
      if (result.keyPassword === undefined) {
        result.keyPassword = host.key_password;
      }
      delete result.key_password;
    }
    return result;
  } catch (error) {
    sshLogger.warn(
      `Failed to resolve credentials for host ${host.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return host;
  }
}

/**
 * @openapi
 * /ssh/folders/rename:
 *   put:
 *     summary: Rename folder
 *     description: Renames a folder for SSH hosts and credentials.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               oldName:
 *                 type: string
 *               newName:
 *                 type: string
 *     responses:
 *       200:
 *         description: Folder renamed successfully.
 *       400:
 *         description: Old name and new name are required.
 *       500:
 *         description: Failed to rename folder.
 */
router.put(
  "/folders/rename",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { oldName, newName } = req.body;

    if (!isNonEmptyString(userId) || !oldName || !newName) {
      sshLogger.warn("Invalid data for folder rename");
      return res
        .status(400)
        .json({ error: "Old name and new name are required" });
    }

    if (oldName === newName) {
      return res.json({ message: "Folder name unchanged" });
    }

    try {
      const updatedHosts = await SimpleDBOps.update(
        sshData,
        "ssh_data",
        and(eq(sshData.userId, userId), eq(sshData.folder, oldName)),
        {
          folder: newName,
          updatedAt: new Date().toISOString(),
        },
        userId,
      );

      const updatedCredentials = await db
        .update(sshCredentials)
        .set({
          folder: newName,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(
            eq(sshCredentials.userId, userId),
            eq(sshCredentials.folder, oldName),
          ),
        )
        .returning();

      DatabaseSaveTrigger.triggerSave("folder_rename");

      await db
        .update(sshFolders)
        .set({
          name: newName,
          updatedAt: new Date().toISOString(),
        })
        .where(
          and(eq(sshFolders.userId, userId), eq(sshFolders.name, oldName)),
        );

      res.json({
        message: "Folder renamed successfully",
        updatedHosts: updatedHosts.length,
        updatedCredentials: updatedCredentials.length,
      });
    } catch (err) {
      sshLogger.error("Failed to rename folder", err, {
        operation: "folder_rename",
        userId,
        oldName,
        newName,
      });
      res.status(500).json({ error: "Failed to rename folder" });
    }
  },
);

/**
 * @openapi
 * /ssh/folders:
 *   get:
 *     summary: Get all folders
 *     description: Retrieves all folders for the authenticated user.
 *     tags:
 *       - SSH
 *     responses:
 *       200:
 *         description: A list of folders.
 *       400:
 *         description: Invalid user ID.
 *       500:
 *         description: Failed to fetch folders.
 */
router.get("/folders", authenticateJWT, async (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!isNonEmptyString(userId)) {
    return res.status(400).json({ error: "Invalid user ID" });
  }

  try {
    const folders = await db
      .select()
      .from(sshFolders)
      .where(eq(sshFolders.userId, userId));

    res.json(folders);
  } catch (err) {
    sshLogger.error("Failed to fetch folders", err, {
      operation: "fetch_folders",
      userId,
    });
    res.status(500).json({ error: "Failed to fetch folders" });
  }
});

/**
 * @openapi
 * /ssh/folders/metadata:
 *   put:
 *     summary: Update folder metadata
 *     description: Updates the metadata (color, icon) of a folder.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               color:
 *                 type: string
 *               icon:
 *                 type: string
 *     responses:
 *       200:
 *         description: Folder metadata updated successfully.
 *       400:
 *         description: Folder name is required.
 *       500:
 *         description: Failed to update folder metadata.
 */
router.put(
  "/folders/metadata",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { name, color, icon } = req.body;

    if (!isNonEmptyString(userId) || !name) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    try {
      const existing = await db
        .select()
        .from(sshFolders)
        .where(and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)))
        .limit(1);

      if (existing.length > 0) {
        databaseLogger.info("Updating SSH folder", {
          operation: "folder_update",
          userId,
          folderId: existing[0].id,
        });
        await db
          .update(sshFolders)
          .set({
            color,
            icon,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)));
      } else {
        databaseLogger.info("Creating SSH folder", {
          operation: "folder_create",
          userId,
          name,
        });
        await db.insert(sshFolders).values({
          userId,
          name,
          color,
          icon,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      DatabaseSaveTrigger.triggerSave("folder_metadata_update");

      res.json({ message: "Folder metadata updated successfully" });
    } catch (err) {
      sshLogger.error("Failed to update folder metadata", err, {
        operation: "update_folder_metadata",
        userId,
        name,
      });
      res.status(500).json({ error: "Failed to update folder metadata" });
    }
  },
);

/**
 * @openapi
 * /ssh/folders/{name}/hosts:
 *   delete:
 *     summary: Delete all hosts in folder
 *     description: Deletes all SSH hosts within a specific folder.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: name
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Hosts deleted successfully.
 *       400:
 *         description: Invalid folder name.
 *       500:
 *         description: Failed to delete hosts in folder.
 */
router.delete(
  "/folders/:name/hosts",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const folderName = Array.isArray(req.params.name)
      ? req.params.name[0]
      : req.params.name;

    if (!isNonEmptyString(userId) || !folderName) {
      return res.status(400).json({ error: "Invalid folder name" });
    }
    databaseLogger.info("Deleting SSH folder", {
      operation: "folder_delete",
      userId,
      folderId: folderName,
    });

    try {
      const hostsToDelete = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.userId, userId), eq(sshData.folder, folderName)));

      if (hostsToDelete.length === 0) {
        return res.json({
          message: "No hosts found in folder",
          deletedCount: 0,
        });
      }

      const hostIds = hostsToDelete.map((host) => host.id);

      if (hostIds.length > 0) {
        await db
          .delete(fileManagerRecent)
          .where(inArray(fileManagerRecent.hostId, hostIds));

        await db
          .delete(fileManagerPinned)
          .where(inArray(fileManagerPinned.hostId, hostIds));

        await db
          .delete(fileManagerShortcuts)
          .where(inArray(fileManagerShortcuts.hostId, hostIds));

        await db
          .delete(commandHistory)
          .where(inArray(commandHistory.hostId, hostIds));

        await db
          .delete(sshCredentialUsage)
          .where(inArray(sshCredentialUsage.hostId, hostIds));

        await db
          .delete(recentActivity)
          .where(inArray(recentActivity.hostId, hostIds));

        await db.delete(hostAccess).where(inArray(hostAccess.hostId, hostIds));

        await db
          .delete(sessionRecordings)
          .where(inArray(sessionRecordings.hostId, hostIds));
      }

      await db
        .delete(sshData)
        .where(and(eq(sshData.userId, userId), eq(sshData.folder, folderName)));

      await db
        .delete(sshFolders)
        .where(
          and(eq(sshFolders.userId, userId), eq(sshFolders.name, folderName)),
        );

      DatabaseSaveTrigger.triggerSave("folder_hosts_delete");

      try {
        const axios = (await import("axios")).default;
        const statsPort = process.env.STATS_PORT || 30005;
        for (const host of hostsToDelete) {
          try {
            await axios.post(
              `http://localhost:${statsPort}/host-deleted`,
              { hostId: host.id },
              {
                headers: {
                  Authorization: req.headers.authorization || "",
                  Cookie: req.headers.cookie || "",
                },
                timeout: 5000,
              },
            );
          } catch (err) {
            sshLogger.warn("Failed to notify stats server of host deletion", {
              operation: "folder_hosts_delete",
              hostId: host.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } catch (err) {
        sshLogger.warn("Failed to notify stats server of folder deletion", {
          operation: "folder_hosts_delete",
          folderName,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      res.json({
        message: "All hosts in folder deleted successfully",
        deletedCount: hostsToDelete.length,
      });
    } catch (err) {
      sshLogger.error("Failed to delete hosts in folder", err, {
        operation: "delete_folder_hosts",
        userId,
        folderName,
      });
      res.status(500).json({ error: "Failed to delete hosts in folder" });
    }
  },
);

/**
 * @openapi
 * /ssh/bulk-import:
 *   post:
 *     summary: Bulk import SSH hosts
 *     description: Bulk imports multiple SSH hosts.
 *     tags:
 *       - SSH
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hosts:
 *                 type: array
 *                 items:
 *                   type: object
 *     responses:
 *       200:
 *         description: Import completed.
 *       400:
 *         description: Invalid request body.
 */
router.post(
  "/bulk-import",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hosts } = req.body;

    if (!Array.isArray(hosts) || hosts.length === 0) {
      return res
        .status(400)
        .json({ error: "Hosts array is required and must not be empty" });
    }

    if (hosts.length > 100) {
      return res
        .status(400)
        .json({ error: "Maximum 100 hosts allowed per import" });
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
    };

    for (let i = 0; i < hosts.length; i++) {
      const hostData = hosts[i];

      try {
        if (
          !isNonEmptyString(hostData.ip) ||
          !isValidPort(hostData.port) ||
          !isNonEmptyString(hostData.username)
        ) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Missing required fields (ip, port, username)`,
          );
          continue;
        }

        if (
          !["password", "key", "credential", "none", "opkssh"].includes(
            hostData.authType,
          )
        ) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Invalid authType. Must be 'password', 'key', 'credential', 'none', or 'opkssh'`,
          );
          continue;
        }

        if (
          hostData.authType === "password" &&
          !isNonEmptyString(hostData.password)
        ) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Password required for password authentication`,
          );
          continue;
        }

        if (hostData.authType === "key" && !isNonEmptyString(hostData.key)) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Key required for key authentication`,
          );
          continue;
        }

        if (hostData.authType === "credential" && !hostData.credentialId) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: credentialId required for credential authentication`,
          );
          continue;
        }

        const sshDataObj: Record<string, unknown> = {
          userId: userId,
          name: hostData.name || `${hostData.username}@${hostData.ip}`,
          folder: hostData.folder || "Default",
          tags: Array.isArray(hostData.tags) ? hostData.tags.join(",") : "",
          ip: hostData.ip,
          port: hostData.port,
          username: hostData.username,
          password: hostData.authType === "password" ? hostData.password : null,
          authType: hostData.authType,
          credentialId:
            hostData.authType === "credential" ? hostData.credentialId : null,
          key: hostData.authType === "key" ? hostData.key : null,
          keyPassword:
            hostData.authType === "key"
              ? hostData.keyPassword || hostData.key_password || null
              : null,
          keyType:
            hostData.authType === "key" ? hostData.keyType || "auto" : null,
          pin: hostData.pin || false,
          enableTerminal: hostData.enableTerminal !== false,
          enableTunnel: hostData.enableTunnel !== false,
          enableFileManager: hostData.enableFileManager !== false,
          enableDocker: hostData.enableDocker || false,
          defaultPath: hostData.defaultPath || "/",
          tunnelConnections: hostData.tunnelConnections
            ? JSON.stringify(hostData.tunnelConnections)
            : "[]",
          jumpHosts: hostData.jumpHosts
            ? JSON.stringify(hostData.jumpHosts)
            : null,
          quickActions: hostData.quickActions
            ? JSON.stringify(hostData.quickActions)
            : null,
          statsConfig: hostData.statsConfig
            ? JSON.stringify(hostData.statsConfig)
            : null,
          terminalConfig: hostData.terminalConfig
            ? JSON.stringify(hostData.terminalConfig)
            : null,
          forceKeyboardInteractive: hostData.forceKeyboardInteractive
            ? "true"
            : "false",
          notes: hostData.notes || null,
          useSocks5: hostData.useSocks5 ? 1 : 0,
          socks5Host: hostData.socks5Host || null,
          socks5Port: hostData.socks5Port || null,
          socks5Username: hostData.socks5Username || null,
          socks5Password: hostData.socks5Password || null,
          socks5ProxyChain: hostData.socks5ProxyChain
            ? JSON.stringify(hostData.socks5ProxyChain)
            : null,
          overrideCredentialUsername: hostData.overrideCredentialUsername
            ? 1
            : 0,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        await SimpleDBOps.insert(sshData, "ssh_data", sshDataObj, userId);
        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push(
          `Host ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    res.json({
      message: `Import completed: ${results.success} successful, ${results.failed} failed`,
      success: results.success,
      failed: results.failed,
      errors: results.errors,
    });
  },
);

/**
 * @openapi
 * /ssh/autostart/enable:
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

      const sshConfig = await db
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, sshConfigId), eq(sshData.userId, userId)));

      if (sshConfig.length === 0) {
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

      const config = sshConfig[0];

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

          const resolvedConnections = await Promise.all(
            tunnelConnections.map(async (tunnel: Record<string, unknown>) => {
              if (
                tunnel.autoStart &&
                tunnel.endpointHost &&
                !tunnel.endpointPassword &&
                !tunnel.endpointKey
              ) {
                const endpointHosts = await db
                  .select()
                  .from(sshData)
                  .where(eq(sshData.userId, userId));

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
                    endpointKeyPassword: decryptedEndpoint.key_password || null,
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

      await db
        .update(sshData)
        .set({
          autostartPassword: decryptedConfig.password || null,
          autostartKey: decryptedConfig.key || null,
          autostartKeyPassword: decryptedConfig.key_password || null,
          tunnelConnections: updatedTunnelConnections,
        })
        .where(eq(sshData.id, sshConfigId));

      try {
        await DatabaseSaveTrigger.triggerSave();
      } catch (saveError) {
        sshLogger.warn("Database save failed after autostart", {
          operation: "autostart_db_save_failed",
          error:
            saveError instanceof Error ? saveError.message : "Unknown error",
        });
      }

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
 * /ssh/autostart/disable:
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
      await db
        .update(sshData)
        .set({
          autostartPassword: null,
          autostartKey: null,
          autostartKeyPassword: null,
        })
        .where(and(eq(sshData.id, sshConfigId), eq(sshData.userId, userId)));

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
 * /ssh/autostart/status:
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
      const autostartConfigs = await db
        .select()
        .from(sshData)
        .where(
          and(
            eq(sshData.userId, userId),
            or(
              isNotNull(sshData.autostartPassword),
              isNotNull(sshData.autostartKey),
            ),
          ),
        );

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

/**
 * @openapi
 * /ssh/opkssh/token/{hostId}:
 *   get:
 *     summary: Get OPKSSH token status for a host
 *     tags: [SSH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: hostId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: Host ID
 *     responses:
 *       200:
 *         description: Token status retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 exists:
 *                   type: boolean
 *                   description: Whether a valid token exists
 *                 expiresAt:
 *                   type: string
 *                   format: date-time
 *                   description: Token expiration timestamp
 *                 email:
 *                   type: string
 *                   description: User email from OIDC identity
 *       404:
 *         description: No valid token found
 *       500:
 *         description: Internal server error
 */
router.get(
  "/ssh/opkssh/token/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId;
    const hostId = parseInt(
      Array.isArray(req.params.hostId)
        ? req.params.hostId[0]
        : req.params.hostId,
    );

    if (!userId || isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const { opksshTokens } = await import("../db/schema.js");
      const token = await db
        .select()
        .from(opksshTokens)
        .where(
          and(eq(opksshTokens.userId, userId), eq(opksshTokens.hostId, hostId)),
        )
        .limit(1);

      if (!token || token.length === 0) {
        return res.status(404).json({ exists: false });
      }

      const tokenData = token[0];
      const expiresAt = new Date(tokenData.expiresAt);

      if (expiresAt < new Date()) {
        await db
          .delete(opksshTokens)
          .where(
            and(
              eq(opksshTokens.userId, userId),
              eq(opksshTokens.hostId, hostId),
            ),
          );
        return res.status(404).json({ exists: false });
      }

      res.json({
        exists: true,
        expiresAt: tokenData.expiresAt,
        email: tokenData.email,
      });
    } catch (error) {
      sshLogger.error("Error retrieving OPKSSH token status", error, {
        operation: "opkssh_token_status_error",
        userId,
        hostId,
      });
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @openapi
 * /ssh/opkssh/token/{hostId}:
 *   delete:
 *     summary: Delete OPKSSH token for a host
 *     tags: [SSH]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - name: hostId
 *         in: path
 *         required: true
 *         schema:
 *           type: integer
 *         description: Host ID
 *     responses:
 *       200:
 *         description: Token deleted successfully
 *       500:
 *         description: Internal server error
 */
router.delete(
  "/ssh/opkssh/token/:hostId",
  authenticateJWT,
  requireDataAccess,
  async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.userId;
    const hostId = parseInt(
      Array.isArray(req.params.hostId)
        ? req.params.hostId[0]
        : req.params.hostId,
    );

    if (!userId || isNaN(hostId)) {
      return res.status(400).json({ error: "Invalid request" });
    }

    try {
      const { deleteOPKSSHToken } = await import("../../ssh/opkssh-auth.js");
      await deleteOPKSSHToken(userId, hostId);
      res.json({ success: true });
    } catch (error) {
      sshLogger.error("Error deleting OPKSSH token", error, {
        operation: "opkssh_token_delete_error",
        userId,
        hostId,
      });
      res.status(500).json({ error: "Internal server error" });
    }
  },
);

/**
 * @openapi
 * /opkssh-chooser/{requestId}:
 *   get:
 *     summary: Proxy OPKSSH provider chooser page and all related resources
 *     tags: [SSH]
 *     parameters:
 *       - name: requestId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Authentication request ID
 *     responses:
 *       200:
 *         description: Chooser page content
 *       404:
 *         description: Session not found
 *       500:
 *         description: Proxy error
 */

router.use(
  "/opkssh-chooser/:requestId",
  async (req: Request, res: Response) => {
    const requestId = Array.isArray(req.params.requestId)
      ? req.params.requestId[0]
      : req.params.requestId;

    try {
      const { getActiveAuthSession } = await import("../../ssh/opkssh-auth.js");
      const session = getActiveAuthSession(requestId);

      if (!session) {
        res.status(404).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Session Not Found</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .container { text-align: center; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
              h1 { color: #ef4444; }
              p { color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✗ Session Not Found</h1>
              <p>This authentication session has expired or is invalid.</p>
            </div>
          </body>
          </html>
        `);
        return;
      }

      const axios = (await import("axios")).default;

      const fullPath = req.originalUrl || req.url;
      const pathAfterRequestId =
        fullPath.split(`/ssh/opkssh-chooser/${requestId}`)[1] || "";
      const targetPath = pathAfterRequestId || "/chooser";
      const finalPath = targetPath.startsWith("/chooser")
        ? targetPath
        : `/chooser${targetPath}`;

      const targetUrl = `http://localhost:${session.localPort}${finalPath}`;

      const response = await axios({
        method: req.method,
        url: targetUrl,
        headers: {
          ...req.headers,
          host: `localhost:${session.localPort}`,
        },
        data: req.body,
        timeout: 10000,
        validateStatus: () => true,
        maxRedirects: 0,
        responseType: "arraybuffer",
      });

      Object.entries(response.headers).forEach(([key, value]) => {
        if (key.toLowerCase() !== "transfer-encoding") {
          res.setHeader(key, value as string);
        }
      });

      const contentType = response.headers["content-type"] || "";
      if (contentType.includes("text/html")) {
        let html = response.data.toString("utf-8");

        const baseTag = `<base href="/ssh/opkssh-chooser/${requestId}/">`;
        html = html.replace(/<head>/i, `<head>${baseTag}`);

        res.status(response.status).send(html);
      } else {
        res.status(response.status).send(response.data);
      }
    } catch (error) {
      sshLogger.error("Error proxying OPKSSH chooser", error, {
        operation: "opkssh_chooser_proxy_error",
        requestId,
      });
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #ef4444; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Error</h1>
            <p>Failed to load authentication page. Please try again.</p>
          </div>
        </body>
        </html>
      `);
    }
  },
);

/**
 * @openapi
 * /opkssh-callback/{requestId}:
 *   get:
 *     summary: OAuth callback from OIDC provider for OPKSSH authentication
 *     tags: [SSH]
 *     parameters:
 *       - name: requestId
 *         in: path
 *         required: true
 *         schema:
 *           type: string
 *         description: Authentication request ID
 *     responses:
 *       200:
 *         description: Callback processed successfully
 *       404:
 *         description: Invalid authentication session
 *       500:
 *         description: Authentication failed
 */
router.get(
  "/opkssh-callback/:requestId",
  async (req: Request, res: Response) => {
    const requestId = Array.isArray(req.params.requestId)
      ? req.params.requestId[0]
      : req.params.requestId;
    const queryString = req.url.split("?")[1] || "";

    try {
      const { handleOAuthCallback } = await import("../../ssh/opkssh-auth.js");
      const result = await handleOAuthCallback(requestId, queryString);

      if (result.success) {
        res.send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Authentication Successful</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .container { text-align: center; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
              h1 { color: #22c55e; }
              p { color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✓ Authentication Successful</h1>
              <p>You can now close this window and return to Termix.</p>
            </div>
          </body>
          </html>
        `);
      } else {
        res.status(500).send(`
          <!DOCTYPE html>
          <html>
          <head>
            <title>Authentication Failed</title>
            <style>
              body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
              .container { text-align: center; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
              h1 { color: #ef4444; }
              p { color: #666; }
            </style>
          </head>
          <body>
            <div class="container">
              <h1>✗ Authentication Failed</h1>
              <p>${result.message || "An error occurred during authentication."}</p>
              <p>Please close this window and try again.</p>
            </div>
          </body>
          </html>
        `);
      }
    } catch (error) {
      sshLogger.error("Error handling OPKSSH OAuth callback", error, {
        operation: "opkssh_oauth_callback_error",
        requestId,
      });
      res.status(500).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Error</title>
          <style>
            body { font-family: system-ui, -apple-system, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: #f5f5f5; }
            .container { text-align: center; background: white; padding: 2rem; border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
            h1 { color: #ef4444; }
            p { color: #666; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✗ Error</h1>
            <p>An unexpected error occurred. Please try again.</p>
          </div>
        </body>
        </html>
      `);
    }
  },
);

export default router;
