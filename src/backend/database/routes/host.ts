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
  transferRecent,
  commandHistory,
  recentActivity,
  hostAccess,
  userRoles,
  sessionRecordings,
} from "../db/schema.js";
import { eq, and, or, isNull, gte, sql, inArray, desc } from "drizzle-orm";
import type { Request, Response } from "express";
import axios from "axios";
import multer from "multer";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { parseSSHKey } from "../../utils/ssh-key-utils.js";
import { pickResolvedUsername } from "../../ssh/credential-username.js";
import {
  isNonEmptyString,
  isValidPort,
  stripSensitiveFields,
  transformHostResponse,
} from "./host-normalizers.js";
import { registerHostOpksshRoutes } from "./host-opkssh-routes.js";
import { registerHostFolderRoutes } from "./host-folder-routes.js";
import { registerHostFileManagerBookmarkRoutes } from "./host-file-manager-bookmark-routes.js";
import { registerHostCommandHistoryRoutes } from "./host-command-history-routes.js";
import { registerHostAutostartRoutes } from "./host-autostart-routes.js";
import { registerHostInternalRoutes } from "./host-internal-routes.js";
import { registerHostNetworkRoutes } from "./host-network-routes.js";
import { registerHostBulkRoutes } from "./host-bulk-routes.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const STATS_SERVER_URL = "http://localhost:30005";

function notifyStatsHostUpdated(
  hostId: number,
  headers: Pick<Request["headers"], "authorization" | "cookie">,
  operation: string,
): void {
  axios
    .post(
      `${STATS_SERVER_URL}/host-updated`,
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

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

registerHostInternalRoutes(router);

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
      useWarpgate,
      credentialId,
      key,
      keyPassword,
      keyType,
      sudoPassword,
      pin,
      enableTerminal,
      enableTunnel,
      enableFileManager,
      scpLegacy,
      enableDocker,
      enableProxmox,
      enableTmuxMonitor,
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
      proxmoxConfig,
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
      wolBroadcastAddress,
      enableSsh,
      enableRdp,
      enableVnc,
      enableTelnet,
      sshPort,
      rdpPort,
      vncPort,
      telnetPort,
      rdpUser,
      rdpPassword,
      rdpDomain,
      rdpSecurity,
      rdpIgnoreCert,
      vncPassword,
      vncUser,
      telnetUser,
      telnetPassword,
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
    const effectiveUsername =
      username || rdpUser || vncUser || telnetUser || "";
    const effectiveName =
      name || (effectiveUsername ? `${effectiveUsername}@${ip}` : String(ip));
    const sshDataObj: Record<string, unknown> = {
      userId: userId,
      connectionType: effectiveConnectionType,
      name: effectiveName,
      folder: folder || null,
      tags: Array.isArray(tags) ? tags.join(",") : tags || "",
      ip,
      port,
      username: effectiveUsername,
      authType: effectiveAuthType,
      useWarpgate: useWarpgate ? 1 : 0,
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
      scpLegacy: scpLegacy ? 1 : 0,
      enableDocker: enableDocker ? 1 : 0,
      enableProxmox: enableProxmox ? 1 : 0,
      enableTmuxMonitor: enableTmuxMonitor ? 1 : 0,
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
      proxmoxConfig: proxmoxConfig
        ? typeof proxmoxConfig === "string"
          ? proxmoxConfig
          : JSON.stringify(proxmoxConfig)
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
      wolBroadcastAddress: wolBroadcastAddress || null,
      portKnockSequence: portKnockSequence
        ? JSON.stringify(portKnockSequence)
        : null,
      enableSsh: enableSsh ? 1 : 0,
      enableRdp: enableRdp ? 1 : 0,
      enableVnc: enableVnc ? 1 : 0,
      enableTelnet: enableTelnet ? 1 : 0,
      sshPort: sshPort || port || 22,
      rdpPort: rdpPort || 3389,
      vncPort: vncPort || 5900,
      telnetPort: telnetPort || 23,
      rdpUser: rdpUser || null,
      rdpDomain: rdpDomain || null,
      rdpSecurity: rdpSecurity || null,
      rdpIgnoreCert: rdpIgnoreCert ? 1 : 0,
      vncUser: vncUser || null,
      telnetUser: telnetUser || null,
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

    sshDataObj.rdpPassword = rdpPassword || null;
    sshDataObj.vncPassword = vncPassword || null;
    sshDataObj.telnetPassword = telnetPassword || null;

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

      const { ipAddress: chIp, userAgent: chUa } = getRequestMeta(req);
      const { users: usersTable } = await import("../db/schema.js");
      const chActor = await db
        .select({ username: usersTable.username })
        .from(usersTable)
        .where(eq(usersTable.id, userId))
        .limit(1);
      await logAudit({
        userId,
        username: chActor[0]?.username ?? userId,
        action: "create_host",
        resourceType: "host",
        resourceId: String(createdHost.id),
        resourceName: String(name ?? ip),
        ipAddress: chIp,
        userAgent: chUa,
        success: true,
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
        enableProxmox: false,
        enableTmuxMonitor: false,
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
      useWarpgate,
      credentialId,
      key,
      keyPassword,
      keyType,
      sudoPassword,
      pin,
      enableTerminal,
      enableTunnel,
      enableFileManager,
      scpLegacy,
      enableDocker,
      enableProxmox,
      enableTmuxMonitor,
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
      proxmoxConfig,
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
      wolBroadcastAddress,
      enableSsh,
      enableRdp,
      enableVnc,
      enableTelnet,
      sshPort,
      rdpPort,
      vncPort,
      telnetPort,
      rdpUser,
      rdpPassword,
      rdpDomain,
      rdpSecurity,
      rdpIgnoreCert,
      vncPassword,
      vncUser,
      telnetUser,
      telnetPassword,
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
    const effectiveUsername =
      username || rdpUser || vncUser || telnetUser || "";
    const effectiveName =
      name || (effectiveUsername ? `${effectiveUsername}@${ip}` : String(ip));
    const sshDataObj: Record<string, unknown> = {
      connectionType: connectionType || "ssh",
      name: effectiveName,
      folder,
      tags: Array.isArray(tags) ? tags.join(",") : tags || "",
      ip,
      port,
      username: effectiveUsername,
      authType: effectiveAuthType,
      useWarpgate: useWarpgate ? 1 : 0,
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
      scpLegacy: scpLegacy ? 1 : 0,
      enableDocker: enableDocker ? 1 : 0,
      enableProxmox: enableProxmox ? 1 : 0,
      enableTmuxMonitor: enableTmuxMonitor ? 1 : 0,
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
      proxmoxConfig: proxmoxConfig
        ? typeof proxmoxConfig === "string"
          ? proxmoxConfig
          : JSON.stringify(proxmoxConfig)
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
      wolBroadcastAddress: wolBroadcastAddress || null,
      portKnockSequence: portKnockSequence
        ? JSON.stringify(portKnockSequence)
        : null,
      enableSsh: enableSsh ? 1 : 0,
      enableRdp: enableRdp ? 1 : 0,
      enableVnc: enableVnc ? 1 : 0,
      enableTelnet: enableTelnet ? 1 : 0,
      sshPort: sshPort || port || 22,
      rdpPort: rdpPort || 3389,
      vncPort: vncPort || 5900,
      telnetPort: telnetPort || 23,
      rdpUser: rdpUser || null,
      rdpDomain: rdpDomain || null,
      rdpSecurity: rdpSecurity || null,
      rdpIgnoreCert: rdpIgnoreCert ? 1 : 0,
      vncUser: vncUser || null,
      telnetUser: telnetUser || null,
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

    if (rdpPassword) sshDataObj.rdpPassword = rdpPassword;
    if (vncPassword) sshDataObj.vncPassword = vncPassword;
    if (telnetPassword) sshDataObj.telnetPassword = telnetPassword;

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
          rdpCredentialId: hosts.rdpCredentialId,
          vncCredentialId: hosts.vncCredentialId,
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

      {
        const newCredId =
          sshDataObj.credentialId !== undefined
            ? sshDataObj.credentialId
            : hostRecord[0].credentialId;
        const newRdpCredId =
          sshDataObj.rdpCredentialId !== undefined
            ? sshDataObj.rdpCredentialId
            : hostRecord[0].rdpCredentialId;
        const newVncCredId =
          sshDataObj.vncCredentialId !== undefined
            ? sshDataObj.vncCredentialId
            : hostRecord[0].vncCredentialId;
        const hadCredential =
          hostRecord[0].credentialId !== null ||
          hostRecord[0].rdpCredentialId !== null ||
          hostRecord[0].vncCredentialId !== null;
        const willHaveCredential =
          newCredId !== null || newRdpCredId !== null || newVncCredId !== null;
        if (hadCredential && !willHaveCredential) {
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

      const { ipAddress: uhIp, userAgent: uhUa } = getRequestMeta(req);
      const { users: usersTableUpd } = await import("../db/schema.js");
      const uhActor = await db
        .select({ username: usersTableUpd.username })
        .from(usersTableUpd)
        .where(eq(usersTableUpd.id, userId))
        .limit(1);
      await logAudit({
        userId,
        username: uhActor[0]?.username ?? userId,
        action: "update_host",
        resourceType: "host",
        resourceId: hostId,
        resourceName: String(name ?? ip),
        ipAddress: uhIp,
        userAgent: uhUa,
        success: true,
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
          scpLegacy: hosts.scpLegacy,
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
          enableProxmox: hosts.enableProxmox,
          enableTmuxMonitor: hosts.enableTmuxMonitor,
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
          wolBroadcastAddress: hosts.wolBroadcastAddress,
          dockerConfig: hosts.dockerConfig,
          proxmoxConfig: hosts.proxmoxConfig,
          enableSsh: hosts.enableSsh,
          enableRdp: hosts.enableRdp,
          enableVnc: hosts.enableVnc,
          enableTelnet: hosts.enableTelnet,
          sshPort: hosts.sshPort,
          rdpPort: hosts.rdpPort,
          vncPort: hosts.vncPort,
          telnetPort: hosts.telnetPort,
          rdpCredentialId: hosts.rdpCredentialId,
          rdpUser: hosts.rdpUser,
          rdpPassword: hosts.rdpPassword,
          rdpDomain: hosts.rdpDomain,
          rdpSecurity: hosts.rdpSecurity,
          rdpIgnoreCert: hosts.rdpIgnoreCert,
          vncCredentialId: hosts.vncCredentialId,
          vncUser: hosts.vncUser,
          vncPassword: hosts.vncPassword,
          telnetUser: hosts.telnetUser,
          telnetPassword: hosts.telnetPassword,

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

      const decryptedOwnHosts: Record<string, unknown>[] = [];
      const userDataKey = DataCrypto.getUserDataKey(userId);
      if (userDataKey) {
        for (const host of ownHosts) {
          try {
            decryptedOwnHosts.push(
              DataCrypto.decryptRecord("ssh_data", host, userId, userDataKey),
            );
          } catch (decryptError) {
            sshLogger.warn("Skipping host with invalid encrypted fields", {
              operation: "host_fetch_own_decrypt_failed",
              userId,
              hostId: host.id,
              error:
                decryptError instanceof Error
                  ? decryptError.message
                  : "Unknown error",
            });
          }
        }
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
        db.select().from(hosts).where(eq(hosts.id, hostId)),
        "ssh_data",
        userId,
      );

      if (data.length === 0) {
        return res.status(404).json({ error: "Host not found" });
      }

      const host = data[0];
      const resolved = (await resolveHostCredentials(host, userId)) || host;
      let value = resolved[field];

      if (!value && field === "sudoPassword" && resolved.terminalConfig) {
        try {
          const tc =
            typeof resolved.terminalConfig === "string"
              ? JSON.parse(resolved.terminalConfig)
              : resolved.terminalConfig;
          value = tc?.sudoPassword || null;
        } catch {
          // malformed JSON — leave value null
        }
      }

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
            enableRdp: !!resolvedHost.enableRdp,
            enableVnc: !!resolvedHost.enableVnc,
            enableTelnet: !!resolvedHost.enableTelnet,
            rdpPort: resolvedHost.rdpPort || 3389,
            vncPort: resolvedHost.vncPort || 5900,
            telnetPort: resolvedHost.telnetPort || 23,
            rdpUser: resolvedHost.rdpUser || null,
            rdpPassword: resolvedHost.rdpPassword || null,
            rdpDomain: resolvedHost.rdpDomain || null,
            rdpSecurity: resolvedHost.rdpSecurity || null,
            rdpIgnoreCert: !!resolvedHost.rdpIgnoreCert,
            vncUser: resolvedHost.vncUser || null,
            vncPassword: resolvedHost.vncPassword || null,
            telnetUser: resolvedHost.telnetUser || null,
            telnetPassword: resolvedHost.telnetPassword || null,
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
            enableFileManager: resolvedHost.enableFileManager !== false,
            scpLegacy: !!resolvedHost.scpLegacy,
            enableDocker: !!resolvedHost.enableDocker,
            enableProxmox: !!resolvedHost.enableProxmox,
            enableTmuxMonitor: !!resolvedHost.enableTmuxMonitor,
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
            proxmoxConfig: resolvedHost.proxmoxConfig
              ? JSON.parse(resolvedHost.proxmoxConfig as string)
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
 * /host/db/hosts/export:
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
              enableFileManager: resolvedHost.enableFileManager !== false,
              enableDocker: !!resolvedHost.enableDocker,
              enableProxmox: !!resolvedHost.enableProxmox,
              enableTmuxMonitor: !!resolvedHost.enableTmuxMonitor,
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
              proxmoxConfig: resolvedHost.proxmoxConfig
                ? JSON.parse(resolvedHost.proxmoxConfig as string)
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
 * /host/db/host/{id}:
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
        .delete(transferRecent)
        .where(
          or(
            eq(transferRecent.sourceHostId, numericHostId),
            eq(transferRecent.destHostId, numericHostId),
          ),
        );

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

      const { ipAddress: dhIp, userAgent: dhUa } = getRequestMeta(req);
      const { users: usersTableDel } = await import("../db/schema.js");
      const dhActor = await db
        .select({ username: usersTableDel.username })
        .from(usersTableDel)
        .where(eq(usersTableDel.id, userId))
        .limit(1);
      await logAudit({
        userId,
        username: dhActor[0]?.username ?? userId,
        action: "delete_host",
        resourceType: "host",
        resourceId: hostId,
        resourceName: hostToDelete[0].name ?? hostToDelete[0].ip,
        ipAddress: dhIp,
        userAgent: dhUa,
        success: true,
      });

      try {
        const axios = (await import("axios")).default;
        await axios.post(
          `${STATS_SERVER_URL}/host-deleted`,
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

registerHostFileManagerBookmarkRoutes(router, authenticateJWT);

router.get(
  "/transfer/recent",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const sourceHostIdQuery = Array.isArray(req.query.sourceHostId)
      ? req.query.sourceHostId[0]
      : req.query.sourceHostId;
    const sourceHostId = sourceHostIdQuery
      ? parseInt(sourceHostIdQuery as string)
      : null;

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    if (!sourceHostId) {
      return res.status(400).json({ error: "Source host ID is required" });
    }

    try {
      const recent = await db
        .select()
        .from(transferRecent)
        .where(
          and(
            eq(transferRecent.userId, userId),
            eq(transferRecent.sourceHostId, sourceHostId),
          ),
        )
        .orderBy(desc(transferRecent.lastUsed))
        .limit(10);

      res.json(recent);
    } catch (err) {
      sshLogger.error("Failed to fetch transfer recent destinations", err);
      res.status(500).json({ error: "Failed to fetch recent destinations" });
    }
  },
);

router.post(
  "/transfer/recent",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const { sourceHostId, destHostId, destPath, destPathLabel } = req.body;

    if (
      !isNonEmptyString(userId) ||
      !sourceHostId ||
      !destHostId ||
      !destPath
    ) {
      return res.status(400).json({ error: "Invalid data" });
    }

    try {
      const existing = await db
        .select()
        .from(transferRecent)
        .where(
          and(
            eq(transferRecent.userId, userId),
            eq(transferRecent.sourceHostId, sourceHostId),
            eq(transferRecent.destHostId, destHostId),
            eq(transferRecent.destPath, destPath),
          ),
        );

      if (existing.length > 0) {
        await db
          .update(transferRecent)
          .set({ lastUsed: new Date().toISOString() })
          .where(eq(transferRecent.id, existing[0].id));
      } else {
        await db.insert(transferRecent).values({
          userId,
          sourceHostId,
          destHostId,
          destPath,
          destPathLabel: destPathLabel || destPath,
          lastUsed: new Date().toISOString(),
        });
      }

      const allRecent = await db
        .select()
        .from(transferRecent)
        .where(
          and(
            eq(transferRecent.userId, userId),
            eq(transferRecent.sourceHostId, sourceHostId),
          ),
        )
        .orderBy(desc(transferRecent.lastUsed));

      if (allRecent.length > 10) {
        const toDelete = allRecent.slice(10);
        for (const entry of toDelete) {
          await db
            .delete(transferRecent)
            .where(eq(transferRecent.id, entry.id));
        }
      }

      res.json({ message: "Recent destination saved" });
    } catch (err) {
      sshLogger.error("Failed to save transfer recent destination", err);
      res.status(500).json({ error: "Failed to save recent destination" });
    }
  },
);
registerHostCommandHistoryRoutes(router, authenticateJWT);

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

            const resolvedUsername = pickResolvedUsername(
              host.username,
              sharedCred.username,
              host.overrideCredentialUsername,
            );
            if (resolvedUsername !== undefined) {
              resolvedHost.username = resolvedUsername;
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

        const resolvedUsername = pickResolvedUsername(
          host.username,
          credential.username,
          host.overrideCredentialUsername,
        );
        if (resolvedUsername !== undefined) {
          resolvedHost.username = resolvedUsername;
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

registerHostFolderRoutes(router, {
  authenticateJWT,
  statsServerUrl: STATS_SERVER_URL,
});

registerHostBulkRoutes(router, authenticateJWT);

registerHostAutostartRoutes(router, {
  authenticateJWT,
  requireDataAccess,
});

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

registerHostOpksshRoutes(router);

registerHostNetworkRoutes(router, {
  authenticateJWT,
  requireDataAccess,
});

export default router;
