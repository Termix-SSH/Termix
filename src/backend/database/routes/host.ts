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
  commandHistory,
  recentActivity,
  hostAccess,
  userRoles,
  sessionRecordings,
} from "../db/schema.js";
import { eq, and, or, isNull, gte, sql, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import axios from "axios";
import multer from "multer";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { DatabaseSaveTrigger } from "../db/index.js";
import { parseSSHKey } from "../../utils/ssh-key-utils.js";
import {
  isNonEmptyString,
  isValidPort,
  normalizeImportedHost,
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

    if (rdpPassword !== undefined) sshDataObj.rdpPassword = rdpPassword || null;
    if (vncPassword !== undefined) sshDataObj.vncPassword = vncPassword || null;
    if (telnetPassword !== undefined)
      sshDataObj.telnetPassword = telnetPassword || null;

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
          enableSsh: hosts.enableSsh,
          enableRdp: hosts.enableRdp,
          enableVnc: hosts.enableVnc,
          enableTelnet: hosts.enableTelnet,
          sshPort: hosts.sshPort,
          rdpPort: hosts.rdpPort,
          vncPort: hosts.vncPort,
          telnetPort: hosts.telnetPort,
          rdpUser: hosts.rdpUser,
          rdpPassword: hosts.rdpPassword,
          rdpDomain: hosts.rdpDomain,
          rdpSecurity: hosts.rdpSecurity,
          rdpIgnoreCert: hosts.rdpIgnoreCert,
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
        const ownerData = await db
          .select({ userId: hosts.userId })
          .from(hosts)
          .where(eq(hosts.id, hostId));
        if (ownerData.length === 0) {
          return res.status(404).json({ error: "Host not found" });
        }
        const ownerId = ownerData[0].userId as string;
        const ownerDecrypted = await SimpleDBOps.select(
          db.select().from(hosts).where(eq(hosts.id, hostId)),
          "ssh_data",
          ownerId,
        );
        if (ownerDecrypted.length === 0) {
          return res.status(404).json({ error: "Host not found" });
        }
        const host = ownerDecrypted[0];
        const resolved = (await resolveHostCredentials(host, ownerId)) || host;
        const value = resolved[field];
        if (!value) {
          return res.status(404).json({ error: "No password set" });
        }
        return res.json({ value });
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

registerHostFolderRoutes(router, {
  authenticateJWT,
  statsServerUrl: STATS_SERVER_URL,
});

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
      const hostData = normalizeImportedHost(hostsToImport[i]);

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
          enableSsh: hostData.enableSsh ?? false,
          enableRdp: hostData.enableRdp ?? false,
          enableVnc: hostData.enableVnc ?? false,
          enableTelnet: hostData.enableTelnet ?? false,
          updatedAt: new Date().toISOString(),
        };

        if (effectiveConnectionType !== "ssh") {
          sshDataObj.password = hostData.password || null;
          sshDataObj.authType = "password";
          sshDataObj.credentialId = null;
          sshDataObj.key = null;
          sshDataObj.keyPassword = null;
          sshDataObj.keyType = null;
          sshDataObj.rdpUser = hostData.rdpUser || null;
          sshDataObj.rdpPassword = hostData.rdpPassword || null;
          sshDataObj.rdpDomain = hostData.rdpDomain || null;
          sshDataObj.rdpSecurity = hostData.rdpSecurity || null;
          sshDataObj.rdpIgnoreCert = hostData.rdpIgnoreCert ? 1 : 0;
          sshDataObj.rdpPort = hostData.rdpPort || 3389;
          sshDataObj.vncUser = hostData.vncUser || null;
          sshDataObj.vncPassword = hostData.vncPassword || null;
          sshDataObj.vncPort = hostData.vncPort || 5900;
          sshDataObj.telnetUser = hostData.telnetUser || null;
          sshDataObj.telnetPassword = hostData.telnetPassword || null;
          sshDataObj.telnetPort = hostData.telnetPort || 23;
          sshDataObj.enableRdp = hostData.enableRdp ? 1 : 0;
          sshDataObj.enableVnc = hostData.enableVnc ? 1 : 0;
          sshDataObj.enableTelnet = hostData.enableTelnet ? 1 : 0;
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
