import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import { db } from "../db/index.js";
import {
  hosts,
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
import axios from "axios";
import multer from "multer";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { DatabaseSaveTrigger } from "../db/index.js";
import { parseSSHKey } from "../../utils/ssh-key-utils.js";
import { sendWakeOnLan, isValidMac } from "../../utils/wake-on-lan.js";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

function notifyStatsHostUpdated(
  hostId: number,
  headers: Pick<Request["headers"], "authorization" | "cookie">,
  operation: string,
): void {
  axios
    .post(
      "http://localhost:30005/host-updated",
      { hostId },
      {
        headers: {
          Authorization: headers.authorization || "",
          Cookie: headers.cookie || "",
        },
        timeout: 5000,
      },
    )
    .catch((err) => {
      sshLogger.warn("Failed to notify stats server of host update", {
        operation,
        hostId,
        error: err instanceof Error ? err.message : String(err),
      });
    });
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && port > 0 && port <= 65535;
}

const SENSITIVE_FIELDS = [
  "password",
  "key",
  "keyPassword",
  "sudoPassword",
  "autostartPassword",
  "autostartKey",
  "autostartKeyPassword",
  "socks5Password",
];

function stripSensitiveFields(
  host: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...host };
  result.hasPassword = !!host.password;
  result.hasKey = !!host.key;
  result.hasSudoPassword = !!host.sudoPassword;
  for (const field of SENSITIVE_FIELDS) {
    delete result[field];
  }
  return result;
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
    portKnockSequence: host.portKnockSequence
      ? JSON.parse(host.portKnockSequence as string)
      : [],
    domain: host.domain || undefined,
    security: host.security || undefined,
    ignoreCert: !!host.ignoreCert,
    guacamoleConfig: host.guacamoleConfig
      ? JSON.parse(host.guacamoleConfig as string)
      : undefined,
  };
}

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

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

/**
 * @openapi
 * /host/db/host:
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
      connectionType,
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
      dockerConfig,
      terminalConfig,
      forceKeyboardInteractive,
      domain,
      security,
      ignoreCert,
      guacamoleConfig,
      notes,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
      portKnockSequence,
      overrideCredentialUsername,
      macAddress,
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

    const effectiveConnectionType = connectionType || "ssh";
    const effectiveAuthType =
      authType ||
      authMethod ||
      (effectiveConnectionType !== "ssh" ? "password" : undefined);
    const sshDataObj: Record<string, unknown> = {
      userId: userId,
      connectionType: effectiveConnectionType,
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
      statsConfig: statsConfig
        ? typeof statsConfig === "string"
          ? statsConfig
          : JSON.stringify(statsConfig)
        : null,
      dockerConfig: dockerConfig
        ? typeof dockerConfig === "string"
          ? dockerConfig
          : JSON.stringify(dockerConfig)
        : null,
      terminalConfig: terminalConfig
        ? typeof terminalConfig === "string"
          ? terminalConfig
          : JSON.stringify(terminalConfig)
        : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
      domain: domain || null,
      security: security || null,
      ignoreCert: ignoreCert ? 1 : 0,
      guacamoleConfig: guacamoleConfig ? JSON.stringify(guacamoleConfig) : null,
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
      macAddress: macAddress || null,
      portKnockSequence: portKnockSequence
        ? JSON.stringify(portKnockSequence)
        : null,
    };

    // For non-SSH hosts (RDP, VNC, Telnet), always save password if provided
    if (effectiveConnectionType !== "ssh") {
      sshDataObj.password = password || null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "password") {
      sshDataObj.password = password || null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
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
      sshDataObj.keyPassword = keyPassword || null;
      sshDataObj.keyType = keyType;
      sshDataObj.password = null;
    } else {
      sshDataObj.password = null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    }

    try {
      const result = await SimpleDBOps.insert(
        hosts,
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

      res.json(resolvedHost);
      notifyStatsHostUpdated(
        createdHost.id as number,
        req.headers,
        "host_create",
      );
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
 * /host/quick-connect:
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
        resolvedKey = cred.privateKey as string | undefined;
        resolvedKeyPassword = cred.keyPassword as string | undefined;
        resolvedKeyType = cred.keyType as string | undefined;
        resolvedAuthType = cred.authType as string | undefined;

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
 * /host/db/host/{id}:
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
      connectionType,
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
      dockerConfig,
      terminalConfig,
      forceKeyboardInteractive,
      domain,
      security,
      ignoreCert,
      guacamoleConfig,
      notes,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
      portKnockSequence,
      overrideCredentialUsername,
      macAddress,
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
      connectionType: connectionType || "ssh",
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
      statsConfig: statsConfig
        ? typeof statsConfig === "string"
          ? statsConfig
          : JSON.stringify(statsConfig)
        : null,
      dockerConfig: dockerConfig
        ? typeof dockerConfig === "string"
          ? dockerConfig
          : JSON.stringify(dockerConfig)
        : null,
      terminalConfig: terminalConfig
        ? typeof terminalConfig === "string"
          ? terminalConfig
          : JSON.stringify(terminalConfig)
        : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
      domain: domain || null,
      security: security || null,
      ignoreCert: ignoreCert ? 1 : 0,
      guacamoleConfig: guacamoleConfig ? JSON.stringify(guacamoleConfig) : null,
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
      macAddress: macAddress || null,
      portKnockSequence: portKnockSequence
        ? JSON.stringify(portKnockSequence)
        : null,
    };

    // For non-SSH hosts (RDP, VNC, Telnet), always save password if provided
    if ((connectionType || "ssh") !== "ssh") {
      if (password) {
        sshDataObj.password = password;
      }
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "password") {
      if (password) {
        sshDataObj.password = password;
      }
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
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
        sshDataObj.keyPassword = keyPassword || null;
      }
      if (keyType) {
        sshDataObj.keyType = keyType;
      }
      sshDataObj.password = null;
    } else {
      sshDataObj.password = null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
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
          userId: hosts.userId,
          credentialId: hosts.credentialId,
          authType: hosts.authType,
        })
        .from(hosts)
        .where(eq(hosts.id, Number(hostId)))
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
          await db
            .delete(hostAccess)
            .where(eq(hostAccess.hostId, Number(hostId)));
        }
      }

      await SimpleDBOps.update(
        hosts,
        "ssh_data",
        eq(hosts.id, Number(hostId)),
        sshDataObj,
        ownerId,
      );

      const updatedHosts = await SimpleDBOps.select(
        db
          .select()
          .from(hosts)
          .where(eq(hosts.id, Number(hostId))),
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

      res.json(resolvedHost);
      notifyStatsHostUpdated(parseInt(hostId), req.headers, "host_update");
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
 * /host/db/host:
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
          id: hosts.id,
          userId: hosts.userId,
          connectionType: hosts.connectionType,
          name: hosts.name,
          ip: hosts.ip,
          port: hosts.port,
          username: hosts.username,
          folder: hosts.folder,
          tags: hosts.tags,
          pin: hosts.pin,
          authType: hosts.authType,
          password: hosts.password,
          key: hosts.key,
          keyPassword: hosts.keyPassword,
          keyType: hosts.keyType,
          enableTerminal: hosts.enableTerminal,
          enableTunnel: hosts.enableTunnel,
          tunnelConnections: hosts.tunnelConnections,
          jumpHosts: hosts.jumpHosts,
          enableFileManager: hosts.enableFileManager,
          defaultPath: hosts.defaultPath,
          autostartPassword: hosts.autostartPassword,
          autostartKey: hosts.autostartKey,
          autostartKeyPassword: hosts.autostartKeyPassword,
          forceKeyboardInteractive: hosts.forceKeyboardInteractive,
          statsConfig: hosts.statsConfig,
          terminalConfig: hosts.terminalConfig,
          sudoPassword: hosts.sudoPassword,
          createdAt: hosts.createdAt,
          updatedAt: hosts.updatedAt,
          credentialId: hosts.credentialId,
          overrideCredentialUsername: hosts.overrideCredentialUsername,
          quickActions: hosts.quickActions,
          notes: hosts.notes,
          enableDocker: hosts.enableDocker,
          showTerminalInSidebar: hosts.showTerminalInSidebar,
          showFileManagerInSidebar: hosts.showFileManagerInSidebar,
          showTunnelInSidebar: hosts.showTunnelInSidebar,
          showDockerInSidebar: hosts.showDockerInSidebar,
          showServerStatsInSidebar: hosts.showServerStatsInSidebar,
          useSocks5: hosts.useSocks5,
          socks5Host: hosts.socks5Host,
          socks5Port: hosts.socks5Port,
          socks5Username: hosts.socks5Username,
          socks5Password: hosts.socks5Password,
          socks5ProxyChain: hosts.socks5ProxyChain,
          portKnockSequence: hosts.portKnockSequence,
          domain: hosts.domain,
          security: hosts.security,
          ignoreCert: hosts.ignoreCert,
          guacamoleConfig: hosts.guacamoleConfig,
          macAddress: hosts.macAddress,
          dockerConfig: hosts.dockerConfig,

          ownerId: hosts.userId,
          isShared: sql<boolean>`${hostAccess.id} IS NOT NULL AND ${hosts.userId} != ${userId}`,
          permissionLevel: hostAccess.permissionLevel,
          expiresAt: hostAccess.expiresAt,
        })
        .from(hosts)
        .leftJoin(
          hostAccess,
          and(
            eq(hostAccess.hostId, hosts.id),
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
            eq(hosts.userId, userId),
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

      let decryptedOwnHosts: Record<string, unknown>[] = [];
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

      const sanitized = result.map((host) => stripSensitiveFields(host));
      res.json(sanitized);
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
 * /host/db/host/{id}:
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
      const data = await SimpleDBOps.select(
        db
          .select()
          .from(hosts)
          .where(and(eq(hosts.id, Number(hostId)), eq(hosts.userId, userId))),
        "ssh_data",
        userId,
      );

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
      const resolved = (await resolveHostCredentials(result, userId)) || result;

      res.json(stripSensitiveFields(resolved));
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
 * /host/db/host/{id}/password:
 *   get:
 *     summary: Get host password for clipboard copy
 *     description: Returns the password for a specific host. Used by the copy-password feature.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *       - in: query
 *         name: field
 *         schema:
 *           type: string
 *           enum: [password, sudoPassword]
 *     responses:
 *       200:
 *         description: The requested password value.
 *       404:
 *         description: Host not found or no password set.
 */
router.get(
  "/db/host/:id/password",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = Number(req.params.id);
    const userId = (req as AuthenticatedRequest).userId;
    const field = (req.query.field as string) || "password";

    if (!["password", "sudoPassword"].includes(field)) {
      return res.status(400).json({ error: "Invalid field" });
    }

    try {
      const data = await SimpleDBOps.select(
        db
          .select()
          .from(hosts)
          .where(and(eq(hosts.id, hostId), eq(hosts.userId, userId))),
        "ssh_data",
        userId,
      );

      if (data.length === 0) {
        return res.status(404).json({ error: "Host not found" });
      }

      const host = data[0];
      const resolved = (await resolveHostCredentials(host, userId)) || host;
      const value = resolved[field];

      if (!value) {
        return res.status(404).json({ error: "No password set" });
      }

      res.json({ value });
    } catch (err) {
      sshLogger.error("Failed to fetch host password", err, {
        operation: "host_password_fetch",
        hostId,
        userId,
      });
      res.status(500).json({ error: "Failed to fetch password" });
    }
  },
);

/**
 * @openapi
 * /host/db/host/{id}/export:
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
      const hostResults = await SimpleDBOps.select(
        db
          .select()
          .from(hosts)
          .where(and(eq(hosts.id, Number(hostId)), eq(hosts.userId, userId))),
        "ssh_data",
        userId,
      );

      if (hostResults.length === 0) {
        return res.status(404).json({ error: "SSH host not found" });
      }

      const host = hostResults[0];

      const resolvedHost = (await resolveHostCredentials(host, userId)) || host;

      const exportedConnectionType =
        (resolvedHost.connectionType as string) || "ssh";
      const isRemoteDesktop = ["rdp", "vnc", "telnet"].includes(
        exportedConnectionType,
      );

      const baseExportData = {
        connectionType: exportedConnectionType,
        name: resolvedHost.name,
        ip: resolvedHost.ip,
        port: resolvedHost.port,
        username: resolvedHost.username,
        password: resolvedHost.password || null,
        folder: resolvedHost.folder,
        tags:
          typeof resolvedHost.tags === "string"
            ? resolvedHost.tags.split(",").filter(Boolean)
            : resolvedHost.tags || [],
        pin: !!resolvedHost.pin,
        notes: resolvedHost.notes || null,
      };

      const exportData = isRemoteDesktop
        ? {
            ...baseExportData,
            domain: resolvedHost.domain || null,
            security: resolvedHost.security || null,
            ignoreCert: !!resolvedHost.ignoreCert,
            guacamoleConfig: resolvedHost.guacamoleConfig
              ? JSON.parse(resolvedHost.guacamoleConfig as string)
              : null,
          }
        : {
            ...baseExportData,
            authType: resolvedHost.authType,
            key: resolvedHost.key || null,
            keyPassword: resolvedHost.keyPassword || null,
            keyType: resolvedHost.keyType || null,
            credentialId: resolvedHost.credentialId || null,
            overrideCredentialUsername:
              !!resolvedHost.overrideCredentialUsername,
            enableTerminal: !!resolvedHost.enableTerminal,
            enableTunnel: !!resolvedHost.enableTunnel,
            enableFileManager: !!resolvedHost.enableFileManager,
            enableDocker: !!resolvedHost.enableDocker,
            showTerminalInSidebar: !!resolvedHost.showTerminalInSidebar,
            showFileManagerInSidebar: !!resolvedHost.showFileManagerInSidebar,
            showTunnelInSidebar: !!resolvedHost.showTunnelInSidebar,
            showDockerInSidebar: !!resolvedHost.showDockerInSidebar,
            showServerStatsInSidebar: !!resolvedHost.showServerStatsInSidebar,
            defaultPath: resolvedHost.defaultPath,
            sudoPassword: resolvedHost.sudoPassword || null,
            tunnelConnections: resolvedHost.tunnelConnections
              ? JSON.parse(resolvedHost.tunnelConnections as string)
              : [],
            jumpHosts: resolvedHost.jumpHosts
              ? JSON.parse(resolvedHost.jumpHosts as string)
              : null,
            quickActions: resolvedHost.quickActions
              ? JSON.parse(resolvedHost.quickActions as string)
              : null,
            statsConfig: resolvedHost.statsConfig
              ? JSON.parse(resolvedHost.statsConfig as string)
              : null,
            dockerConfig: resolvedHost.dockerConfig
              ? JSON.parse(resolvedHost.dockerConfig as string)
              : null,
            terminalConfig: resolvedHost.terminalConfig
              ? JSON.parse(resolvedHost.terminalConfig as string)
              : null,
            forceKeyboardInteractive:
              resolvedHost.forceKeyboardInteractive === "true",
            useSocks5: !!resolvedHost.useSocks5,
            socks5Host: resolvedHost.socks5Host || null,
            socks5Port: resolvedHost.socks5Port || null,
            socks5Username: resolvedHost.socks5Username || null,
            socks5Password: resolvedHost.socks5Password || null,
            socks5ProxyChain: resolvedHost.socks5ProxyChain
              ? JSON.parse(resolvedHost.socks5ProxyChain as string)
              : null,
            portKnockSequence: resolvedHost.portKnockSequence
              ? JSON.parse(resolvedHost.portKnockSequence as string)
              : null,
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
 * /ssh/db/hosts/export:
 *   get:
 *     summary: Export all SSH hosts
 *     description: Exports all SSH hosts for the current user with decrypted credentials.
 *     tags:
 *       - SSH
 *     responses:
 *       200:
 *         description: All exported SSH hosts.
 *       400:
 *         description: Invalid userId.
 *       500:
 *         description: Failed to export SSH hosts.
 */
router.get(
  "/db/hosts/export",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const allHosts = await SimpleDBOps.select(
        db.select().from(hosts).where(eq(hosts.userId, userId)),
        "ssh_data",
        userId,
      );

      const exportedHosts = [];

      for (const host of allHosts) {
        const resolvedHost =
          (await resolveHostCredentials(host, userId)) || host;

        const exportedConnectionType =
          (resolvedHost.connectionType as string) || "ssh";
        const isRemoteDesktop = ["rdp", "vnc", "telnet"].includes(
          exportedConnectionType,
        );

        const baseExportData = {
          connectionType: exportedConnectionType,
          name: resolvedHost.name,
          ip: resolvedHost.ip,
          port: resolvedHost.port,
          username: resolvedHost.username,
          password: resolvedHost.password || null,
          folder: resolvedHost.folder,
          tags:
            typeof resolvedHost.tags === "string"
              ? resolvedHost.tags.split(",").filter(Boolean)
              : resolvedHost.tags || [],
          pin: !!resolvedHost.pin,
          notes: resolvedHost.notes || null,
        };

        const exportData = isRemoteDesktop
          ? {
              ...baseExportData,
              domain: resolvedHost.domain || null,
              security: resolvedHost.security || null,
              ignoreCert: !!resolvedHost.ignoreCert,
              guacamoleConfig: resolvedHost.guacamoleConfig
                ? JSON.parse(resolvedHost.guacamoleConfig as string)
                : null,
            }
          : {
              ...baseExportData,
              authType: resolvedHost.authType,
              key: resolvedHost.key || null,
              keyPassword: resolvedHost.keyPassword || null,
              keyType: resolvedHost.keyType || null,
              credentialId: resolvedHost.credentialId || null,
              overrideCredentialUsername:
                !!resolvedHost.overrideCredentialUsername,
              enableTerminal: !!resolvedHost.enableTerminal,
              enableTunnel: !!resolvedHost.enableTunnel,
              enableFileManager: !!resolvedHost.enableFileManager,
              enableDocker: !!resolvedHost.enableDocker,
              showTerminalInSidebar: !!resolvedHost.showTerminalInSidebar,
              showFileManagerInSidebar: !!resolvedHost.showFileManagerInSidebar,
              showTunnelInSidebar: !!resolvedHost.showTunnelInSidebar,
              showDockerInSidebar: !!resolvedHost.showDockerInSidebar,
              showServerStatsInSidebar: !!resolvedHost.showServerStatsInSidebar,
              defaultPath: resolvedHost.defaultPath,
              sudoPassword: resolvedHost.sudoPassword || null,
              tunnelConnections: resolvedHost.tunnelConnections
                ? JSON.parse(resolvedHost.tunnelConnections as string)
                : [],
              jumpHosts: resolvedHost.jumpHosts
                ? JSON.parse(resolvedHost.jumpHosts as string)
                : null,
              quickActions: resolvedHost.quickActions
                ? JSON.parse(resolvedHost.quickActions as string)
                : null,
              statsConfig: resolvedHost.statsConfig
                ? JSON.parse(resolvedHost.statsConfig as string)
                : null,
              dockerConfig: resolvedHost.dockerConfig
                ? JSON.parse(resolvedHost.dockerConfig as string)
                : null,
              terminalConfig: resolvedHost.terminalConfig
                ? JSON.parse(resolvedHost.terminalConfig as string)
                : null,
              forceKeyboardInteractive:
                resolvedHost.forceKeyboardInteractive === "true",
              useSocks5: !!resolvedHost.useSocks5,
              socks5Host: resolvedHost.socks5Host || null,
              socks5Port: resolvedHost.socks5Port || null,
              socks5Username: resolvedHost.socks5Username || null,
              socks5Password: resolvedHost.socks5Password || null,
              socks5ProxyChain: resolvedHost.socks5ProxyChain
                ? JSON.parse(resolvedHost.socks5ProxyChain as string)
                : null,
            };

        exportedHosts.push(exportData);
      }

      sshLogger.success("All hosts exported with decrypted credentials", {
        operation: "hosts_export_all",
        count: exportedHosts.length,
        userId,
      });

      res.json({ hosts: exportedHosts });
    } catch (err) {
      sshLogger.error("Failed to export all SSH hosts", err, {
        operation: "hosts_export_all",
        userId,
      });
      res.status(500).json({ error: "Failed to export SSH hosts" });
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
        .from(hosts)
        .where(and(eq(hosts.id, Number(hostId)), eq(hosts.userId, userId)));

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
        .delete(hosts)
        .where(and(eq(hosts.id, numericHostId), eq(hosts.userId, userId)));

      databaseLogger.success("SSH host deleted", {
        operation: "host_delete_success",
        userId,
        hostId: parseInt(hostId),
      });

      try {
        const axios = (await import("axios")).default;
        const statsPort = 30005;
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
 * /host/file_manager/recent:
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
 * /host/file_manager/recent:
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
 * /host/file_manager/recent:
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
 * /host/file_manager/pinned:
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
 * /host/file_manager/pinned:
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
 * /host/file_manager/pinned:
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
 * /host/file_manager/shortcuts:
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
 * /host/file_manager/shortcuts:
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
 * /host/file_manager/shortcuts:
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
 * /host/command-history/{hostId}:
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
 * /host/command-history:
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
          keyPassword: credential.keyPassword,
          keyType: credential.keyType,
        };

        if (!host.overrideCredentialUsername) {
          resolvedHost.username = credential.username;
        }

        return resolvedHost;
      }
    }

    return { ...host };
  } catch (error) {
    sshLogger.warn(
      `Failed to resolve credentials for host ${host.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return host;
  }
}

/**
 * @openapi
 * /host/folders/rename:
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
        hosts,
        "ssh_data",
        and(eq(hosts.userId, userId), eq(hosts.folder, oldName)),
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
 * /host/folders:
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
 * /host/folders/metadata:
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
 * /host/folders/{name}/hosts:
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
        .from(hosts)
        .where(and(eq(hosts.userId, userId), eq(hosts.folder, folderName)));

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
        .delete(hosts)
        .where(and(eq(hosts.userId, userId), eq(hosts.folder, folderName)));

      await db
        .delete(sshFolders)
        .where(
          and(eq(sshFolders.userId, userId), eq(sshFolders.name, folderName)),
        );

      DatabaseSaveTrigger.triggerSave("folder_hosts_delete");

      try {
        const axios = (await import("axios")).default;
        const statsPort = 30005;
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
 * /host/bulk-import:
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

/**
 * @swagger
 * /host/bulk-update:
 *   patch:
 *     summary: Bulk update partial fields on multiple SSH hosts
 *     tags: [SSH]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostIds:
 *                 type: array
 *                 items:
 *                   type: number
 *               updates:
 *                 type: object
 *     responses:
 *       200:
 *         description: Bulk update completed.
 *       400:
 *         description: Invalid request body.
 */
router.patch(
  "/bulk-update",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hostIds, updates } = req.body;

    if (!Array.isArray(hostIds) || hostIds.length === 0) {
      return res
        .status(400)
        .json({ error: "hostIds array is required and must not be empty" });
    }

    if (hostIds.length > 1000) {
      return res
        .status(400)
        .json({ error: "Maximum 1000 hosts allowed per bulk update" });
    }

    if (
      !updates ||
      typeof updates !== "object" ||
      Object.keys(updates).length === 0
    ) {
      return res.status(400).json({
        error: "updates object is required and must contain at least one field",
      });
    }

    try {
      const ownedHosts = await db
        .select({ id: hosts.id, statsConfig: hosts.statsConfig })
        .from(hosts)
        .where(and(inArray(hosts.id, hostIds), eq(hosts.userId, userId)));

      const ownedIds = ownedHosts.map((h) => h.id);
      const unauthorizedIds = hostIds.filter(
        (id: number) => !ownedIds.includes(id),
      );

      if (ownedIds.length === 0) {
        return res.status(404).json({ error: "No matching hosts found" });
      }

      const errors: string[] = [];
      if (unauthorizedIds.length > 0) {
        errors.push(`${unauthorizedIds.length} host(s) not found or not owned`);
      }

      const simpleUpdates: Record<string, unknown> = {};
      if (typeof updates.pin === "boolean") simpleUpdates.pin = updates.pin;
      if (typeof updates.folder === "string")
        simpleUpdates.folder = updates.folder || null;
      if (typeof updates.enableTerminal === "boolean")
        simpleUpdates.enableTerminal = updates.enableTerminal;
      if (typeof updates.enableTunnel === "boolean")
        simpleUpdates.enableTunnel = updates.enableTunnel;
      if (typeof updates.enableFileManager === "boolean")
        simpleUpdates.enableFileManager = updates.enableFileManager;
      if (typeof updates.enableDocker === "boolean")
        simpleUpdates.enableDocker = updates.enableDocker;

      if (Object.keys(simpleUpdates).length > 0) {
        await db
          .update(hosts)
          .set(simpleUpdates)
          .where(and(inArray(hosts.id, ownedIds), eq(hosts.userId, userId)));
      }

      if (updates.statsConfig && typeof updates.statsConfig === "object") {
        for (const host of ownedHosts) {
          try {
            const existing = host.statsConfig
              ? JSON.parse(host.statsConfig as string)
              : {};
            const merged = { ...existing, ...updates.statsConfig };
            await db
              .update(hosts)
              .set({ statsConfig: JSON.stringify(merged) })
              .where(and(eq(hosts.id, host.id), eq(hosts.userId, userId)));
          } catch {
            errors.push(`Failed to update statsConfig for host ${host.id}`);
          }
        }
      }

      DatabaseSaveTrigger.triggerSave("bulk_update");

      return res.json({
        updated: ownedIds.length,
        failed: unauthorizedIds.length,
        errors,
      });
    } catch (error) {
      sshLogger.error("Failed to bulk update hosts:", error);
      return res.status(500).json({ error: "Failed to bulk update hosts" });
    }
  },
);

router.post(
  "/bulk-import",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { hosts: hostsToImport, overwrite } = req.body;

    if (!Array.isArray(hostsToImport) || hostsToImport.length === 0) {
      return res
        .status(400)
        .json({ error: "Hosts array is required and must not be empty" });
    }

    if (hostsToImport.length > 100) {
      return res
        .status(400)
        .json({ error: "Maximum 100 hosts allowed per import" });
    }

    const results = {
      success: 0,
      updated: 0,
      skipped: 0,
      failed: 0,
      errors: [] as string[],
    };

    let existingHostMap: Map<string, { id: number }> | undefined;
    if (overwrite) {
      try {
        const allHosts = await SimpleDBOps.select<Record<string, unknown>>(
          db.select().from(hosts).where(eq(hosts.userId, userId)),
          "ssh_data",
          userId,
        );
        existingHostMap = new Map();
        for (const h of allHosts) {
          const key = `${h.ip}:${h.port}:${h.username}`;
          existingHostMap.set(key, { id: h.id as number });
        }
      } catch {
        existingHostMap = undefined;
      }
    }

    for (let i = 0; i < hostsToImport.length; i++) {
      const hostData = hostsToImport[i];

      try {
        const effectiveConnectionType = hostData.connectionType || "ssh";

        if (!isNonEmptyString(hostData.ip) || !isValidPort(hostData.port)) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Missing required fields (ip, port)`,
          );
          continue;
        }

        if (
          effectiveConnectionType === "ssh" &&
          !isNonEmptyString(hostData.username)
        ) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Username required for SSH connections`,
          );
          continue;
        }

        if (
          effectiveConnectionType === "ssh" &&
          hostData.authType &&
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
          effectiveConnectionType === "ssh" &&
          hostData.authType === "password" &&
          !isNonEmptyString(hostData.password)
        ) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Password required for password authentication`,
          );
          continue;
        }

        if (
          effectiveConnectionType === "ssh" &&
          hostData.authType === "key" &&
          !isNonEmptyString(hostData.key)
        ) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Key required for key authentication`,
          );
          continue;
        }

        if (
          effectiveConnectionType === "ssh" &&
          hostData.authType === "credential" &&
          !hostData.credentialId
        ) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: credentialId required for credential authentication`,
          );
          continue;
        }

        if (
          effectiveConnectionType === "ssh" &&
          hostData.authType === "credential" &&
          hostData.credentialId
        ) {
          const cred = await db
            .select({ id: sshCredentials.id })
            .from(sshCredentials)
            .where(
              and(
                eq(sshCredentials.id, hostData.credentialId),
                eq(sshCredentials.userId, userId),
              ),
            )
            .limit(1);

          if (cred.length === 0) {
            const fallback = await db
              .select({ id: sshCredentials.id })
              .from(sshCredentials)
              .where(eq(sshCredentials.userId, userId))
              .limit(1);

            if (fallback.length > 0) {
              hostData.credentialId = fallback[0].id;
            } else {
              results.failed++;
              results.errors.push(
                `Host ${i + 1}: credentialId ${hostData.credentialId} not found and no fallback credential available`,
              );
              continue;
            }
          }
        }

        const sshDataObj: Record<string, unknown> = {
          userId: userId,
          connectionType: effectiveConnectionType,
          name: hostData.name || `${hostData.username || ""}@${hostData.ip}`,
          folder: hostData.folder || "Default",
          tags: Array.isArray(hostData.tags) ? hostData.tags.join(",") : "",
          ip: hostData.ip,
          port: hostData.port,
          username: hostData.username || null,
          pin: hostData.pin || false,
          enableTerminal: hostData.enableTerminal !== false,
          enableTunnel: hostData.enableTunnel !== false,
          enableFileManager: hostData.enableFileManager !== false,
          enableDocker: hostData.enableDocker || false,
          showTerminalInSidebar: hostData.showTerminalInSidebar ? 1 : 0,
          showFileManagerInSidebar: hostData.showFileManagerInSidebar ? 1 : 0,
          showTunnelInSidebar: hostData.showTunnelInSidebar ? 1 : 0,
          showDockerInSidebar: hostData.showDockerInSidebar ? 1 : 0,
          showServerStatsInSidebar: hostData.showServerStatsInSidebar ? 1 : 0,
          defaultPath: hostData.defaultPath || "/",
          sudoPassword: hostData.sudoPassword || null,
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
          dockerConfig: hostData.dockerConfig
            ? JSON.stringify(hostData.dockerConfig)
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
          portKnockSequence: hostData.portKnockSequence
            ? JSON.stringify(hostData.portKnockSequence)
            : null,
          overrideCredentialUsername: hostData.overrideCredentialUsername
            ? 1
            : 0,
          updatedAt: new Date().toISOString(),
        };

        if (effectiveConnectionType !== "ssh") {
          sshDataObj.password = hostData.password || null;
          sshDataObj.authType = "password";
          sshDataObj.credentialId = null;
          sshDataObj.key = null;
          sshDataObj.keyPassword = null;
          sshDataObj.keyType = null;
          sshDataObj.domain = hostData.domain || null;
          sshDataObj.security = hostData.security || null;
          sshDataObj.ignoreCert = hostData.ignoreCert ? 1 : 0;
          sshDataObj.guacamoleConfig = hostData.guacamoleConfig
            ? JSON.stringify(hostData.guacamoleConfig)
            : null;
        } else {
          sshDataObj.password =
            hostData.authType === "password" ? hostData.password : null;
          sshDataObj.authType = hostData.authType || "password";
          sshDataObj.credentialId =
            hostData.authType === "credential" ? hostData.credentialId : null;
          sshDataObj.key = hostData.authType === "key" ? hostData.key : null;
          sshDataObj.keyPassword =
            hostData.authType === "key" ? hostData.keyPassword || null : null;
          sshDataObj.keyType =
            hostData.authType === "key" ? hostData.keyType || "auto" : null;
          sshDataObj.domain = null;
          sshDataObj.security = null;
          sshDataObj.ignoreCert = 0;
          sshDataObj.guacamoleConfig = null;
        }

        const lookupKey = `${hostData.ip}:${hostData.port}:${hostData.username}`;
        const existing = existingHostMap?.get(lookupKey);

        if (existing) {
          await SimpleDBOps.update(
            hosts,
            "ssh_data",
            eq(hosts.id, existing.id),
            sshDataObj,
            userId,
          );
          results.updated++;
        } else {
          sshDataObj.createdAt = new Date().toISOString();
          await SimpleDBOps.insert(hosts, "ssh_data", sshDataObj, userId);
          results.success++;
        }
      } catch (error) {
        results.failed++;
        results.errors.push(
          `Host ${i + 1}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
      }
    }

    res.json({
      message: `Import completed: ${results.success} created, ${results.updated} updated, ${results.failed} failed`,
      success: results.success,
      updated: results.updated,
      skipped: results.skipped,
      failed: results.failed,
      errors: results.errors,
    });
  },
);

/**
 * @openapi
 * /host/folders/{folderName}/hosts:
 *   delete:
 *     summary: Delete all hosts in a folder
 *     description: Deletes all hosts within a specific folder.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: path
 *         name: folderName
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: All hosts deleted successfully.
 *       400:
 *         description: Invalid folder name.
 *       500:
 *         description: Failed to delete hosts.
 */
router.delete(
  "/folders/:folderName/hosts",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const folderName = decodeURIComponent(
      Array.isArray(req.params.folderName)
        ? req.params.folderName[0]
        : req.params.folderName,
    );

    if (!folderName) {
      return res.status(400).json({ error: "Folder name is required" });
    }

    try {
      const hostsToDelete = await db
        .select({ id: hosts.id })
        .from(hosts)
        .where(and(eq(hosts.userId, userId), eq(hosts.folder, folderName)));

      if (hostsToDelete.length === 0) {
        return res.json({ deletedCount: 0 });
      }

      const hostIds = hostsToDelete.map((h) => h.id);

      for (const hostId of hostIds) {
        await db
          .delete(fileManagerRecent)
          .where(eq(fileManagerRecent.hostId, hostId));
        await db
          .delete(fileManagerPinned)
          .where(eq(fileManagerPinned.hostId, hostId));
        await db
          .delete(fileManagerShortcuts)
          .where(eq(fileManagerShortcuts.hostId, hostId));
        await db
          .delete(commandHistory)
          .where(eq(commandHistory.hostId, hostId));
        await db
          .delete(sshCredentialUsage)
          .where(eq(sshCredentialUsage.hostId, hostId));
        await db
          .delete(recentActivity)
          .where(eq(recentActivity.hostId, hostId));
        await db.delete(hostAccess).where(eq(hostAccess.hostId, hostId));
        await db
          .delete(sessionRecordings)
          .where(eq(sessionRecordings.hostId, hostId));
      }

      await db
        .delete(hosts)
        .where(and(eq(hosts.userId, userId), eq(hosts.folder, folderName)));

      databaseLogger.success("All hosts in folder deleted", {
        operation: "delete_folder_hosts",
        userId,
        folderName,
        deletedCount: hostsToDelete.length,
      });

      res.json({ deletedCount: hostsToDelete.length });
    } catch (error) {
      sshLogger.error("Failed to delete hosts in folder", error, {
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

      const sshConfig = await db
        .select()
        .from(hosts)
        .where(and(eq(hosts.id, sshConfigId), eq(hosts.userId, userId)));

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
                  .from(hosts)
                  .where(eq(hosts.userId, userId));

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
                    endpointKeyPassword: decryptedEndpoint.keyPassword || null,
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
        .update(hosts)
        .set({
          autostartPassword: decryptedConfig.password || null,
          autostartKey: decryptedConfig.key || null,
          autostartKeyPassword: decryptedConfig.keyPassword || null,
          tunnelConnections: updatedTunnelConnections,
        })
        .where(eq(hosts.id, sshConfigId));

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
      await db
        .update(hosts)
        .set({
          autostartPassword: null,
          autostartKey: null,
          autostartKeyPassword: null,
        })
        .where(and(eq(hosts.id, sshConfigId), eq(hosts.userId, userId)));

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
      const autostartConfigs = await db
        .select()
        .from(hosts)
        .where(
          and(
            eq(hosts.userId, userId),
            or(
              isNotNull(hosts.autostartPassword),
              isNotNull(hosts.autostartKey),
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
 * /host/opkssh/token/{hostId}:
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
 * /host/opkssh/token/{hostId}:
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Replicates openpubkey's client/choosers/web_chooser.go IssuerToName().
// OPKSSH's /select handler keys its providerMap by this derived name, NOT by the
// `alias` field in config.yml. We need the same mapping so we can normalize any
// `op=` query param we receive (which can be alias, issuer with protocol, or
// issuer without protocol depending on client version) to what OPKSSH expects.
function opksshIssuerToName(issuer: string): string | null {
  if (!issuer) return null;
  const withScheme =
    issuer.startsWith("http://") || issuer.startsWith("https://")
      ? issuer
      : `https://${issuer}`;
  if (withScheme.startsWith("https://accounts.google.com")) return "google";
  if (withScheme.startsWith("https://login.microsoftonline.com"))
    return "azure";
  if (withScheme.startsWith("https://gitlab.com")) return "gitlab";
  if (withScheme.startsWith("https://issuer.hello.coop")) return "hello";
  if (withScheme.startsWith("https://")) {
    const host = withScheme.slice("https://".length).split("/")[0];
    return host || null;
  }
  return null;
}

function normalizeSelectOpParam(
  rawOp: string,
  providers: Array<{ alias: string; issuer: string }>,
): string {
  if (!rawOp) return rawOp;
  const knownNames = new Set(
    providers
      .map((p) => opksshIssuerToName(p.issuer))
      .filter((n): n is string => typeof n === "string" && n.length > 0),
  );
  if (knownNames.has(rawOp)) return rawOp;

  const derivedFromRaw = opksshIssuerToName(rawOp);
  if (derivedFromRaw && knownNames.has(derivedFromRaw)) return derivedFromRaw;

  const matchByAlias = providers.find((p) => p.alias === rawOp);
  if (matchByAlias) {
    const name = opksshIssuerToName(matchByAlias.issuer);
    if (name) return name;
  }

  return rawOp;
}

interface OpksshErrorPageOptions {
  title: string;
  heading: string;
  message: string;
  details?: string;
  requestId?: string;
  statusCode?: number;
}

function renderOpksshErrorPage(opts: OpksshErrorPageOptions): string {
  const title = escapeHtml(opts.title);
  const heading = escapeHtml(opts.heading);
  const message = escapeHtml(opts.message);
  const detailsBlock = opts.details
    ? `<pre class="details">${escapeHtml(opts.details)}</pre>`
    : "";
  const requestIdBlock = opts.requestId
    ? `<p class="request-id">Request ID: ${escapeHtml(opts.requestId)}</p>`
    : "";

  return `<!DOCTYPE html>
<html>
<head>
  <title>${title}</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      min-height: 100vh;
      background: #18181b;
      color: #fafafa;
      padding: 1rem;
    }
    .container {
      text-align: center;
      background: #27272a;
      padding: 3rem 2rem;
      border-radius: 0.625rem;
      border: 1px solid rgba(255, 255, 255, 0.1);
      max-width: 720px;
      width: 100%;
    }
    h1 {
      color: #fafafa;
      font-size: 1.5rem;
      font-weight: 600;
      margin-bottom: 0.75rem;
    }
    p {
      color: #9ca3af;
      font-size: 0.95rem;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-word;
    }
    p + p { margin-top: 0.5rem; }
    .details {
      color: #d4d4d8;
      text-align: left;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      font-size: 0.8rem;
      line-height: 1.45;
      margin-top: 1.25rem;
      padding: 0.875rem 1rem;
      background: #0f0f11;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 0.5rem;
      white-space: pre-wrap;
      word-break: break-word;
      overflow-x: auto;
    }
    .request-id {
      color: #6b7280;
      font-size: 0.75rem;
      margin-top: 1rem;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>${heading}</h1>
    <p>${message}</p>
    ${detailsBlock}
    ${requestIdBlock}
  </div>
</body>
</html>`;
}

function rewriteOPKSSHHtml(
  html: string,
  requestId: string,
  routePrefix: "opkssh-chooser" | "opkssh-callback",
): string {
  const basePath = `/host/${routePrefix}/${requestId}`;
  const localHostPattern = "(?:localhost|127\\.0\\.0\\.1)";

  const attrPatterns = ["action", "href", "src", "formaction"];
  for (const attr of attrPatterns) {
    html = html.replace(
      new RegExp(`${attr}="(/[^"]*)`, "g"),
      `${attr}="${basePath}$1`,
    );
    html = html.replace(
      new RegExp(`${attr}='(/[^']*)`, "g"),
      `${attr}='${basePath}$1`,
    );
  }

  for (const attr of ["href", "action", "src", "formaction"]) {
    html = html.replace(
      new RegExp(
        `${attr}=["']?http:\\/\\/${localHostPattern}:\\d+\\/([^"'\\s]*)`,
        "g",
      ),
      `${attr}="${basePath}/$1`,
    );
  }

  html = html.replace(
    new RegExp(
      `(window\\.location\\.href\\s*=\\s*["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );
  html = html.replace(
    new RegExp(
      `(window\\.location\\s*=\\s*["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );
  html = html.replace(
    new RegExp(
      `(fetch\\(["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );

  html = html.replace(
    new RegExp(
      `(location\\.assign\\(["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["']\\))`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );
  html = html.replace(
    new RegExp(
      `(location\\.replace\\(["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["']\\))`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );

  // XMLHttpRequest.open("GET", "http://localhost:PORT/path", ...)
  html = html.replace(
    new RegExp(
      `(\\.open\\(["']\\w+["']\\s*,\\s*["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );

  html = html.replace(
    new RegExp(
      `(<meta[^>]+http-equiv=["']refresh["'][^>]+content=["'][^;]+;\\s*url=)http:\\/\\/${localHostPattern}:\\d+\\/([^"']+)(["'][^>]*>)`,
      "gi",
    ),
    `$1${basePath}/$2$3`,
  );

  html = html.replace(
    new RegExp(
      `(data-[\\w-]+=["'])http:\\/\\/${localHostPattern}:\\d+\\/([^"']*)(["'])`,
      "g",
    ),
    `$1${basePath}/$2$3`,
  );

  const baseTag = `<base href="${basePath}/">`;

  if (html.includes("<base")) {
    sshLogger.info("Replacing existing base tag", {
      operation: "opkssh_html_rewrite_base_tag",
      requestId,
      basePath,
    });
    html = html.replace(/<base[^>]*>/i, baseTag);
  } else if (html.includes("<head>")) {
    sshLogger.info("Inserting base tag into head", {
      operation: "opkssh_html_rewrite_base_tag_insert",
      requestId,
      basePath,
    });
    html = html.replace(/<head>/i, `<head>${baseTag}`);
  } else {
    sshLogger.warn("No <head> tag found, wrapping HTML", {
      operation: "opkssh_html_rewrite_no_head",
      requestId,
      htmlLength: html.length,
      htmlPreview: html.substring(0, 200),
    });
    html = `<!DOCTYPE html><html><head>${baseTag}</head><body>${html}</body></html>`;
  }

  sshLogger.info("HTML rewrite complete", {
    operation: "opkssh_html_rewrite_complete",
    requestId,
    routePrefix,
    hasBaseTag: html.includes("<base href="),
    staticAssetCount: (html.match(/\/static\//g) || []).length,
  });

  return html;
}

/**
 * @openapi
 * /host/opkssh-chooser/{requestId}:
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

    const fullPath = req.originalUrl || req.url;
    const pathAfterRequestIdTemp =
      fullPath.split(`/host/opkssh-chooser/${requestId}`)[1] || "";

    sshLogger.info("OPKSSH chooser proxy request", {
      operation: "opkssh_chooser_proxy_request",
      requestId,
      url: req.url,
      originalUrl: req.originalUrl,
      fullPath,
      pathAfterRequestId: pathAfterRequestIdTemp,
      method: req.method,
    });

    try {
      const { getActiveAuthSession, registerOAuthState } =
        await import("../../ssh/opkssh-auth.js");
      const session = getActiveAuthSession(requestId);

      if (!session) {
        sshLogger.error("Session not found for chooser request", {
          operation: "opkssh_chooser_session_not_found",
          requestId,
        });
        res.status(404).send(
          renderOpksshErrorPage({
            title: "Session Not Found",
            heading: "Session Not Found",
            message: "This authentication session has expired or is invalid.",
            requestId,
          }),
        );
        return;
      }

      const axios = (await import("axios")).default;

      const fullPath = req.originalUrl || req.url;
      const pathAfterRequestId =
        fullPath.split(`/host/opkssh-chooser/${requestId}`)[1] || "";
      const targetPath = pathAfterRequestId || "/chooser";

      if (!session.localPort || session.localPort === 0) {
        sshLogger.error("OPKSSH session has no local port", {
          operation: "opkssh_chooser_proxy",
          requestId,
          sessionStatus: session.status,
        });
        res.status(500).send(
          renderOpksshErrorPage({
            title: "Error",
            heading: "Authentication Error",
            message:
              "Failed to load authentication page. OPKSSH process may not be ready yet. Please try again.",
            requestId,
          }),
        );
        return;
      }

      // /select on OPKSSH's chooser redirects (possibly via multiple local hops) to the
      // external OAuth provider URL. The hops we may see:
      //   1. /select -> /select/ (Go ServeMux canonicalization, same chooser port)
      //   2. /select/?op=ALIAS -> http://localhost:CALLBACK_PORT/login (OPKSSH's separate callback listener)
      //   3. /login on the callback listener -> https://<provider>/authorize?... (external OAuth URL)
      if (targetPath.startsWith("/select")) {
        const selectaxios = (await import("axios")).default;
        const rawQs = targetPath.includes("?")
          ? targetPath.slice(targetPath.indexOf("?"))
          : "";

        let qs = rawQs;
        let opMappedFrom: string | undefined;
        if (rawQs) {
          try {
            const params = new URLSearchParams(rawQs.replace(/^\?/, ""));
            const rawOp = params.get("op");
            if (rawOp) {
              const mappedOp = normalizeSelectOpParam(
                rawOp,
                session.providers || [],
              );
              if (mappedOp !== rawOp) {
                params.set("op", mappedOp);
                qs = `?${params.toString()}`;
                opMappedFrom = rawOp;
              }
            }
          } catch {
            /* keep rawQs if parsing fails */
          }
        }

        const chooserHost = `127.0.0.1:${session.localPort}`;
        const startUrl = `http://${chooserHost}/select/${qs}`;

        sshLogger.info("Proxying OPKSSH /select", {
          operation: "opkssh_select_proxy",
          requestId,
          targetUrl: startUrl,
          opMappedFrom,
        });

        const isLocalHostname = (host: string): boolean => {
          const bare = host.split(":")[0];
          return (
            bare === "127.0.0.1" || bare === "localhost" || bare === "[::1]"
          );
        };

        interface UpstreamResponse {
          status: number;
          location?: string;
          contentType: string;
          body: string;
          targetUrl: string;
          elapsedMs: number;
        }

        const fetchUpstream = async (
          url: string,
        ): Promise<UpstreamResponse> => {
          const started = Date.now();
          let hostHeader = chooserHost;
          try {
            hostHeader = new URL(url).host;
          } catch {
            /* fall back to chooser host */
          }
          const r = await selectaxios({
            method: "GET",
            url,
            maxRedirects: 0,
            validateStatus: () => true,
            timeout: 10000,
            responseType: "text",
            transformResponse: (v) => v,
            headers: { host: hostHeader },
          });
          const locHeader = r.headers["location"];
          const location = Array.isArray(locHeader) ? locHeader[0] : locHeader;
          const ctHeader = r.headers["content-type"];
          const ctRaw = Array.isArray(ctHeader) ? ctHeader[0] : ctHeader;
          const contentType = typeof ctRaw === "string" ? ctRaw : "";
          const body =
            typeof r.data === "string" ? r.data : String(r.data ?? "");
          return {
            status: r.status,
            location: typeof location === "string" ? location : undefined,
            contentType,
            body,
            targetUrl: url,
            elapsedMs: Date.now() - started,
          };
        };

        const logResponse = (response: UpstreamResponse): void => {
          sshLogger.info("OPKSSH /select upstream response", {
            operation: "opkssh_select_upstream_response",
            requestId,
            targetUrl: response.targetUrl,
            status: response.status,
            location: response.location,
            contentType: response.contentType,
            elapsedMs: response.elapsedMs,
            bodyPreview: response.body.slice(0, 256),
          });
        };

        const MAX_HOPS = 4;

        try {
          let response = await fetchUpstream(startUrl);
          logResponse(response);

          for (let hop = 0; hop < MAX_HOPS; hop++) {
            if (
              response.status < 300 ||
              response.status >= 400 ||
              !response.location
            ) {
              break;
            }
            const loc = response.location;

            // Relative path: resolve against the current upstream.
            if (loc.startsWith("/")) {
              let currentHost = chooserHost;
              try {
                currentHost = new URL(response.targetUrl).host;
              } catch {
                /* keep default */
              }
              response = await fetchUpstream(`http://${currentHost}${loc}`);
              logResponse(response);
              continue;
            }

            // Absolute URL: if it points to a localhost OPKSSH endpoint, capture
            // the port. Then redirect the BROWSER to the proxied path so that
            // Set-Cookie headers from OPKSSH's /login handler reach the browser
            // directly — following them server-side would swallow the cookie.
            if (/^https?:\/\//i.test(loc)) {
              try {
                const parsed = new URL(loc);
                if (isLocalHostname(parsed.host)) {
                  // Capture callback listener port if not yet known.
                  if (!session.callbackPort) {
                    const port = parseInt(parsed.port, 10);
                    if (!Number.isNaN(port)) {
                      session.callbackPort = port;
                      sshLogger.info(
                        "Captured OPKSSH callback listener port from /select redirect",
                        {
                          operation: "opkssh_select_callback_port_detected",
                          requestId,
                          callbackPort: port,
                        },
                      );
                    }
                  }
                  // Redirect browser through the chooser proxy so it can receive
                  // the state cookie that OPKSSH sets on /login.
                  const browserPath = `/host/opkssh-chooser/${requestId}${parsed.pathname}${parsed.search}`;
                  sshLogger.info(
                    "Redirecting browser to OPKSSH callback listener via proxy",
                    {
                      operation: "opkssh_select_browser_redirect_to_login",
                      requestId,
                      browserPath,
                      callbackPort: session.callbackPort,
                    },
                  );
                  res.redirect(302, browserPath);
                  return;
                }
                // External OAuth provider URL — done, handled below.
                break;
              } catch {
                break;
              }
            }

            break;
          }

          const isExternalRedirect =
            response.status >= 300 &&
            response.status < 400 &&
            !!response.location &&
            /^https?:\/\//i.test(response.location) &&
            (() => {
              try {
                return !isLocalHostname(
                  new URL(response.location as string).host,
                );
              } catch {
                return false;
              }
            })();

          if (isExternalRedirect) {
            const oauthUrl = response.location as string;
            try {
              const parsed = new URL(oauthUrl);
              const oauthState = parsed.searchParams.get("state");
              if (oauthState) registerOAuthState(oauthState, requestId);
            } catch {
              /* already validated above */
            }
            sshLogger.info(
              "OPKSSH /select redirecting browser to OAuth provider",
              {
                operation: "opkssh_select_redirect",
                requestId,
                oauthUrl,
              },
            );
            res.redirect(302, oauthUrl);
            return;
          }

          const bodyPreview = response.body.slice(0, 512);
          const detailLines = [
            `Upstream: ${response.targetUrl}`,
            `Status: ${response.status}`,
            response.location ? `Location: ${response.location}` : undefined,
            `Content-Type: ${response.contentType || "(none)"}`,
            `Elapsed: ${response.elapsedMs}ms`,
            "",
            bodyPreview
              ? `Body (first 512 chars):\n${bodyPreview}`
              : "Body: (empty)",
          ].filter(Boolean) as string[];

          sshLogger.error("OPKSSH /select did not produce an OAuth redirect", {
            operation: "opkssh_select_no_oauth_redirect",
            requestId,
            status: response.status,
            location: response.location,
            contentType: response.contentType,
            bodyPreview,
          });

          res.status(502).send(
            renderOpksshErrorPage({
              title: "OPKSSH error",
              heading: "Failed to get OAuth redirect",
              message:
                "OPKSSH did not return an external OAuth provider URL. " +
                "This typically indicates a configuration mismatch between the provider's redirect_uris " +
                "and the Termix callback path. Check the server log for the OPKSSH response body.",
              details: detailLines.join("\n"),
              requestId,
            }),
          );
        } catch (err) {
          sshLogger.error("Error proxying OPKSSH /select", err, {
            operation: "opkssh_select_proxy_error",
            requestId,
            targetUrl: startUrl,
          });
          const errMsg = err instanceof Error ? err.message : String(err);
          res.status(502).send(
            renderOpksshErrorPage({
              title: "OPKSSH error",
              heading: "Failed to reach OPKSSH service",
              message:
                "Termix could not connect to the local OPKSSH authentication service. " +
                "The OPKSSH process may have exited or is not listening yet.",
              details: `Upstream: ${startUrl}\nError: ${errMsg}`,
              requestId,
            }),
          );
        }
        return;
      }

      // Paths served by the callback listener, not the chooser.
      // The browser is redirected here so it receives Set-Cookie from OPKSSH.
      const isCallbackListenerPath =
        targetPath === "/login" ||
        targetPath.startsWith("/login?") ||
        targetPath === "/login-callback" ||
        targetPath.startsWith("/login-callback?");

      const upstreamPort =
        isCallbackListenerPath && session.callbackPort
          ? session.callbackPort
          : session.localPort;

      const targetUrl = `http://127.0.0.1:${upstreamPort}${targetPath}`;

      sshLogger.info("Proxying to OPKSSH chooser", {
        operation: "opkssh_chooser_proxy_request_to_opkssh",
        requestId,
        targetUrl,
        upstreamPort,
        targetPath,
      });

      const response = await axios({
        method: req.method,
        url: targetUrl,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${upstreamPort}`,
        },
        data: req.body,
        timeout: 10000,
        validateStatus: () => true,
        maxRedirects: 0,
        responseType: "arraybuffer",
      });

      sshLogger.info("OPKSSH chooser response received", {
        operation: "opkssh_chooser_proxy_response",
        requestId,
        statusCode: response.status,
        contentType: response.headers["content-type"],
        contentLength: response.headers["content-length"],
        hasLocation: !!response.headers.location,
      });

      Object.entries(response.headers).forEach(([key, value]) => {
        if (key.toLowerCase() === "transfer-encoding") {
          return;
        }
        if (key.toLowerCase() === "location") {
          const location = value as string;
          if (location.startsWith("/")) {
            res.setHeader(key, `/host/opkssh-chooser/${requestId}${location}`);
          } else {
            const localhostMatch = location.match(
              /^http:\/\/(?:localhost|127\.0\.0\.1):(\d+)(\/.*)?$/,
            );
            if (localhostMatch) {
              const port = parseInt(localhostMatch[1], 10);
              const path = localhostMatch[2] || "/";
              if (session.callbackPort && port === session.callbackPort) {
                res.setHeader(key, `/host/opkssh-callback/${requestId}${path}`);
              } else if (port === session.localPort) {
                res.setHeader(key, `/host/opkssh-chooser/${requestId}${path}`);
              } else {
                const isCallback =
                  path.includes("login") || path.includes("callback");
                const prefix = isCallback
                  ? "opkssh-callback"
                  : "opkssh-chooser";
                res.setHeader(key, `/host/${prefix}/${requestId}${path}`);
              }
            } else {
              // External redirect (e.g. to OIDC provider) — capture OAuth state for session binding
              try {
                const redirectUrl = new URL(location);
                const oauthState = redirectUrl.searchParams.get("state");
                if (oauthState) {
                  registerOAuthState(oauthState, requestId);
                }
              } catch {
                // Not a valid URL, skip state capture
              }
              res.setHeader(key, value as string);
            }
          }
        } else if (key.toLowerCase() === "set-cookie") {
          // Rewrite cookies from OPKSSH's internal listener so they are scoped
          // to the Termix proxy path instead of OPKSSH's internal path.
          // The state cookie set by /login must survive to /login-callback.
          const cookies = Array.isArray(value) ? value : [value as string];
          const rewritten = cookies.map((cookie) => {
            return cookie
              .replace(/;\s*domain=[^;]*/gi, "")
              .replace(/;\s*path=[^;]*/gi, "; Path=/host/opkssh-callback/")
              .concat(
                cookie.match(/;\s*path=/i)
                  ? ""
                  : "; Path=/host/opkssh-callback/",
              );
          });
          res.setHeader(key, rewritten);
        } else {
          res.setHeader(key, value as string);
        }
      });

      // Set a cookie to correlate this browser with the requestId.
      // OAuth state capture from Location headers only works for 3xx redirects;
      // if OPKSSH redirects via JavaScript, the state is never registered.
      // This cookie survives the OIDC round-trip and identifies the session on callback.
      res.cookie("opkssh_request_id", requestId, {
        path: "/host/",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 5 * 60 * 1000,
      });

      const contentType = String(response.headers["content-type"] || "");
      if (contentType.includes("text/html")) {
        const html = rewriteOPKSSHHtml(
          response.data.toString("utf-8"),
          requestId,
          "opkssh-chooser",
        );
        res.status(response.status).send(html);
      } else {
        res.status(response.status).send(response.data);
      }
    } catch (error) {
      sshLogger.error("Error proxying OPKSSH chooser", error, {
        operation: "opkssh_chooser_proxy_error",
        requestId,
      });
      res.status(500).send(
        renderOpksshErrorPage({
          title: "Error",
          heading: "Error",
          message: "Failed to load authentication page. Please try again.",
          requestId,
        }),
      );
    }
  },
);

/**
 * @openapi
 * /host/opkssh-callback:
 *   get:
 *     summary: Static OAuth callback from OIDC provider for OPKSSH authentication
 *     tags: [SSH]
 *     responses:
 *       200:
 *         description: Callback processed successfully
 *       404:
 *         description: No active authentication session found
 *       500:
 *         description: Authentication failed
 */
router.get("/opkssh-callback", async (req: Request, res: Response) => {
  try {
    sshLogger.info("OAuth callback received", {
      operation: "opkssh_static_callback_received",
      host: req.headers.host,
    });

    const {
      getUserIdFromRequest,
      getActiveSessionsForUser,
      getActiveAuthSession,
      getRequestIdByOAuthState,
      clearOAuthState,
    } = await import("../../ssh/opkssh-auth.js");

    const userId = await getUserIdFromRequest({
      cookies: req.cookies,
      headers: req.headers as Record<string, string | undefined>,
    });

    sshLogger.info("User ID resolved", {
      operation: "opkssh_callback_user_lookup",
      userId: userId || "null",
      hasCookies: !!req.cookies?.jwt,
      cookieKeys: Object.keys(req.cookies || {}),
    });

    let userSessions: Awaited<ReturnType<typeof getActiveSessionsForUser>> = [];

    if (userId) {
      userSessions = getActiveSessionsForUser(userId);
    } else {
      // No JWT cookie (e.g. OAuth redirect landed in external browser).
      // Try to find the correct session via the OAuth state parameter.
      const oauthState = req.query.state as string | undefined;

      if (oauthState) {
        const mappedRequestId = getRequestIdByOAuthState(oauthState);
        if (mappedRequestId) {
          const mappedSession = getActiveAuthSession(mappedRequestId);
          if (mappedSession) {
            userSessions = [mappedSession];
            clearOAuthState(oauthState);
            sshLogger.info("Resolved session via OAuth state parameter", {
              operation: "opkssh_callback_state_lookup",
              requestId: mappedRequestId,
            });
          }
        }
      }

      // Fallback: use the opkssh_request_id cookie set by the chooser proxy.
      // State capture only works for 3xx redirects; if OPKSSH redirects via
      // JavaScript in the HTML, the state is never registered in the map.
      if (userSessions.length === 0) {
        const cookieRequestId = req.cookies?.opkssh_request_id;
        if (cookieRequestId) {
          const cookieSession = getActiveAuthSession(cookieRequestId);
          if (cookieSession) {
            userSessions = [cookieSession];
            res.clearCookie("opkssh_request_id", { path: "/host/" });
            sshLogger.info("Resolved session via opkssh_request_id cookie", {
              operation: "opkssh_callback_cookie_lookup",
              requestId: cookieRequestId,
            });
          }
        }
      }

      if (userSessions.length === 0) {
        sshLogger.warn(
          "OAuth callback with no JWT, no matching state, and no session cookie",
          {
            operation: "opkssh_callback_no_session_match",
            hasState: !!oauthState,
            hasCookie: !!req.cookies?.opkssh_request_id,
          },
        );
        res
          .status(401)
          .send("Authentication callback failed: unable to identify session");
        return;
      }
    }

    sshLogger.info("Active sessions for user", {
      operation: "opkssh_callback_session_lookup",
      userId,
      sessionCount: userSessions.length,
      sessions: userSessions.map((s) => ({
        requestId: s.requestId,
        status: s.status,
        hasCallbackPort: !!s.callbackPort,
        callbackPort: s.callbackPort,
        hasLocalPort: !!s.localPort,
        localPort: s.localPort,
      })),
    });

    if (userSessions.length === 0) {
      sshLogger.error("No active sessions for callback", {
        operation: "opkssh_callback_no_sessions",
        userId,
      });
      res.status(404).send("No active authentication session found");
      return;
    }

    const session = userSessions[userSessions.length - 1];

    if (!session.callbackPort) {
      sshLogger.error("Session callback port not ready", {
        operation: "opkssh_callback_port_not_ready",
        userId,
        requestId: session.requestId,
        sessionStatus: session.status,
        hasLocalPort: !!session.localPort,
      });
      res.status(503).send("OPKSSH callback listener not ready yet");
      return;
    }

    const queryString = req.url.includes("?")
      ? req.url.substring(req.url.indexOf("?"))
      : "";
    // OPKSSH's internal callback listener handles `/login-callback` regardless of the
    // path used in --remote-redirect-uri. The dynamic route below defaults to that path.
    const redirectUrl = `/host/opkssh-callback/${session.requestId}${queryString}`;

    sshLogger.info("Redirecting OAuth callback to dynamic route", {
      operation: "opkssh_static_callback_redirect",
      userId,
      requestId: session.requestId,
      callbackPort: session.callbackPort,
      queryParams: Object.keys(req.query),
      redirectUrl,
    });

    res.redirect(302, redirectUrl);
  } catch (error) {
    sshLogger.error("Error handling OPKSSH static callback", error, {
      operation: "opkssh_static_callback_error",
      url: req.url,
      originalUrl: req.originalUrl,
    });
    res.status(500).send("Authentication callback failed");
  }
});

/**
 * @openapi
 * /host/opkssh-callback/{requestId}:
 *   get:
 *     summary: OAuth callback from OIDC provider for OPKSSH authentication (handles all sub-paths)
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
router.use(
  "/opkssh-callback/:requestId",
  async (req: Request, res: Response) => {
    const requestId = Array.isArray(req.params.requestId)
      ? req.params.requestId[0]
      : req.params.requestId;

    try {
      const { getActiveAuthSession } = await import("../../ssh/opkssh-auth.js");
      const session = getActiveAuthSession(requestId);

      if (!session) {
        res.status(404).send(
          renderOpksshErrorPage({
            title: "Session Not Found",
            heading: "Session Not Found",
            message:
              "Authentication session expired or invalid. Please close this window and try again.",
            requestId,
          }),
        );
        return;
      }

      const axios = (await import("axios")).default;
      const fullPath = req.originalUrl || req.url;
      const pathAfterRequestId =
        fullPath.split(`/host/opkssh-callback/${requestId}`)[1] || "";
      // pathAfterRequestId may be "", "?query=...", "/subpath", or "/subpath?query=..."
      // OPKSSH's internal listener serves /login-callback, so when no sub-path is present
      // (query-only or empty), prepend it.
      const targetPath =
        pathAfterRequestId === "" || pathAfterRequestId.startsWith("?")
          ? `/login-callback${pathAfterRequestId}`
          : pathAfterRequestId;

      if (!session.callbackPort || session.callbackPort === 0) {
        sshLogger.error("OPKSSH callback session has no callback port", {
          operation: "opkssh_callback_proxy",
          requestId,
          sessionStatus: session.status,
        });
        res.status(500).send(
          renderOpksshErrorPage({
            title: "Error",
            heading: "Callback Error",
            message:
              "OPKSSH callback listener not ready. Please try authenticating again.",
            requestId,
          }),
        );
        return;
      }

      const targetUrl = `http://127.0.0.1:${session.callbackPort}${targetPath}`;

      const response = await axios({
        method: req.method,
        url: targetUrl,
        headers: {
          ...req.headers,
          host: `127.0.0.1:${session.callbackPort}`,
        },
        data: req.body,
        timeout: 10000,
        validateStatus: () => true,
        maxRedirects: 0,
        responseType: "arraybuffer",
      });

      Object.entries(response.headers).forEach(([key, value]) => {
        if (key.toLowerCase() === "transfer-encoding") {
          return;
        }
        if (key.toLowerCase() === "location") {
          const location = value as string;
          if (location.startsWith("/")) {
            res.setHeader(key, `/host/opkssh-callback/${requestId}${location}`);
          } else {
            res.setHeader(key, value as string);
          }
        } else {
          res.setHeader(key, value as string);
        }
      });

      const contentType = String(response.headers["content-type"] || "");
      if (contentType.includes("text/html")) {
        const html = rewriteOPKSSHHtml(
          response.data.toString("utf-8"),
          requestId,
          "opkssh-callback",
        );
        res.status(response.status).send(html);
      } else {
        res.status(response.status).send(response.data);
      }
    } catch (error) {
      sshLogger.error("Error handling OPKSSH OAuth callback", error, {
        operation: "opkssh_oauth_callback_error",
        requestId,
      });

      res.status(500).send(
        renderOpksshErrorPage({
          title: "Error",
          heading: "Error",
          message: "An unexpected error occurred. Please try again.",
          requestId,
        }),
      );
    }
  },
);

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
          error instanceof Error ? error.message : "Failed to send WoL packet",
      });
    }
  },
);

export default router;
