import type { AuthenticatedRequest } from "../../../types/index.js";
import express from "express";
import type { Request, Response } from "express";
import axios from "axios";
import multer from "multer";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { parseSSHKey } from "../../utils/ssh-key-utils.js";
import {
  pickResolvedPassword,
  pickResolvedUsername,
} from "../../hosts/credential-username.js";
import {
  createCurrentCommandHistoryRepository,
  createCurrentCredentialRepository,
  createCurrentFileManagerBookmarkRepository,
  createCurrentOpksshTokenRepository,
  createCurrentRecentActivityRepository,
  createCurrentSshCredentialUsageRepository,
  createCurrentSessionRecordingRepository,
  createCurrentTransferRecentRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentHostResolutionRepository,
  createCurrentHostRepository,
  createCurrentUserRepository,
  createCurrentSyncTombstoneRepository,
} from "../repositories/factory.js";
import {
  isNonEmptyString,
  isValidPort,
  sanitizeHostForRecipient,
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
import {
  applyHostEnrollmentDefaults,
  requireHostEnrollmentAccessForPath,
} from "./host-enrollment-auth.js";
import { logAudit, getRequestMeta } from "../../utils/audit-logger.js";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

const STATS_SERVER_URL = "http://localhost:30005";

async function getAuditUsername(userId: string): Promise<string> {
  const actor = await createCurrentUserRepository().findById(userId);
  return actor?.username ?? userId;
}

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
  ["/db/host", "/enroll"],
  authenticateJWT,
  requireDataAccess,
  requireHostEnrollmentAccessForPath,
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

    if (req.path === "/enroll") {
      hostData = applyHostEnrollmentDefaults(hostData);
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
      vaultProfileId,
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
      allowSessionSharing,
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
      connectionOrigin,
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
      rdpAuthType,
      rdpCredentialId,
      rdpUser,
      rdpPassword,
      rdpDomain,
      rdpSecurity,
      rdpIgnoreCert,
      vncAuthType,
      vncCredentialId,
      vncPassword,
      vncUser,
      telnetAuthType,
      telnetCredentialId,
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
      vaultProfileId: vaultProfileId || null,
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
      allowSessionSharing: allowSessionSharing === false ? 0 : 1,
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
      connectionOrigin:
        connectionOrigin === "local" || connectionOrigin === "remote"
          ? connectionOrigin
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
      rdpAuthType: enableRdp ? rdpAuthType || null : null,
      rdpCredentialId:
        enableRdp && rdpAuthType === "credential" && rdpCredentialId
          ? rdpCredentialId
          : null,
      rdpUser: rdpUser || null,
      rdpDomain: rdpDomain || null,
      rdpSecurity: rdpSecurity || null,
      rdpIgnoreCert: rdpIgnoreCert ? 1 : 0,
      vncAuthType: enableVnc ? vncAuthType || null : null,
      vncCredentialId:
        enableVnc && vncAuthType === "credential" && vncCredentialId
          ? vncCredentialId
          : null,
      vncUser: vncUser || null,
      telnetAuthType: enableTelnet ? telnetAuthType || null : null,
      telnetCredentialId:
        enableTelnet && telnetAuthType === "credential" && telnetCredentialId
          ? telnetCredentialId
          : null,
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
      sshDataObj.password = password || null;
    } else if (effectiveAuthType === "credential") {
      sshDataObj.password = password || null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "agent") {
      sshDataObj.password = null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
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
      const result = await createCurrentHostRepository().createEncryptedForUser(
        userId,
        sshDataObj,
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
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
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
 * /host/enroll:
 *   post:
 *     summary: Enroll a host with an API key
 *     description: Creates a host owned by the user assigned to the API key. The user's encrypted data must be unlocked by an active sign-in.
 *     tags:
 *       - Host Enrollment
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [ip]
 *             properties:
 *               name:
 *                 type: string
 *               ip:
 *                 type: string
 *               port:
 *                 type: integer
 *                 minimum: 1
 *                 maximum: 65535
 *                 default: 22
 *               username:
 *                 type: string
 *               authType:
 *                 type: string
 *                 enum: [none, password, key, credential, agent]
 *                 default: none
 *               password:
 *                 type: string
 *               folder:
 *                 type: string
 *               tags:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *               enableTerminal:
 *                 type: boolean
 *               enableFileManager:
 *                 type: boolean
 *               enableTunnel:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: Host enrolled successfully.
 *       400:
 *         description: Invalid host data.
 *       401:
 *         description: Missing or invalid API key.
 *       423:
 *         description: The API key user's encrypted data is locked.
 *       500:
 *         description: Failed to enroll the host.
 */
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
        const cred =
          await createCurrentHostResolutionRepository().findCredentialByIdForUser(
            Number(credentialId),
            userId,
          );

        if (!cred) {
          return res.status(404).json({ error: "Credential not found" });
        }

        resolvedPassword = pickResolvedPassword(password, cred.password) as
          | string
          | undefined;
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
      vaultProfileId,
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
      allowSessionSharing,
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
      connectionOrigin,
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
      rdpAuthType,
      rdpCredentialId,
      rdpUser,
      rdpPassword,
      rdpDomain,
      rdpSecurity,
      rdpIgnoreCert,
      vncAuthType,
      vncCredentialId,
      vncPassword,
      vncUser,
      telnetAuthType,
      telnetCredentialId,
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
      vaultProfileId: vaultProfileId || null,
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
      allowSessionSharing: allowSessionSharing === false ? 0 : 1,
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
      connectionOrigin:
        connectionOrigin === "local" || connectionOrigin === "remote"
          ? connectionOrigin
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
      rdpAuthType: enableRdp ? rdpAuthType || null : null,
      rdpCredentialId:
        enableRdp && rdpAuthType === "credential" && rdpCredentialId
          ? rdpCredentialId
          : null,
      rdpUser: rdpUser || null,
      rdpDomain: rdpDomain || null,
      rdpSecurity: rdpSecurity || null,
      rdpIgnoreCert: rdpIgnoreCert ? 1 : 0,
      vncAuthType: enableVnc ? vncAuthType || null : null,
      vncCredentialId:
        enableVnc && vncAuthType === "credential" && vncCredentialId
          ? vncCredentialId
          : null,
      vncUser: vncUser || null,
      telnetAuthType: enableTelnet ? telnetAuthType || null : null,
      telnetCredentialId:
        enableTelnet && telnetAuthType === "credential" && telnetCredentialId
          ? telnetCredentialId
          : null,
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
      sshDataObj.password = password || null;
    } else if (effectiveAuthType === "credential") {
      sshDataObj.password = password || null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "agent") {
      sshDataObj.password = null;
      sshDataObj.key = null;
      sshDataObj.keyPassword = null;
      sshDataObj.keyType = null;
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
        "edit",
      );

      if (!accessInfo.hasAccess) {
        sshLogger.warn("User does not have permission to update host", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(403).json({ error: "Access denied" });
      }

      const hostRecord =
        await createCurrentHostResolutionRepository().findHostUpdateState(
          Number(hostId),
        );

      if (!hostRecord) {
        sshLogger.warn("Host not found for update", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "Host not found" });
      }

      const ownerId = hostRecord.userId;

      if (!accessInfo.isOwner) {
        // Shared editors work on the owner's real record but may never
        // repoint it at credential/vault references (those live in the
        // owner's personal vault) or switch the authentication type.
        const referenceViolations: Array<[unknown, number | null, string]> = [
          [sshDataObj.credentialId, hostRecord.credentialId, "credential"],
          [
            sshDataObj.rdpCredentialId,
            hostRecord.rdpCredentialId,
            "RDP credential",
          ],
          [
            sshDataObj.vncCredentialId,
            hostRecord.vncCredentialId,
            "VNC credential",
          ],
          [
            sshDataObj.telnetCredentialId,
            hostRecord.telnetCredentialId,
            "Telnet credential",
          ],
          [
            sshDataObj.vaultProfileId,
            hostRecord.vaultProfileId,
            "Vault profile",
          ],
        ];

        for (const [incoming, current, label] of referenceViolations) {
          if (incoming !== undefined && (incoming ?? null) !== current) {
            return res.status(403).json({
              error: `Only the host owner can change the ${label}`,
            });
          }
        }

        if (
          sshDataObj.authType !== undefined &&
          sshDataObj.authType !== hostRecord.authType
        ) {
          return res.status(403).json({
            error: "Only the host owner can change the authentication type",
          });
        }
      }

      await createCurrentHostRepository().updateEncryptedForUser(
        ownerId,
        Number(hostId),
        sshDataObj,
      );

      // Keep every recipient's re-encrypted secret snapshots in sync with
      // the updated host record.
      try {
        const { SharedHostSecretsManager } =
          await import("../../utils/shared-host-secrets-manager.js");
        await SharedHostSecretsManager.getInstance().resyncHost(Number(hostId));
      } catch (resyncError) {
        sshLogger.warn("Failed to resync shared host secrets after update", {
          operation: "host_update_resync",
          hostId: parseInt(hostId),
          error:
            resyncError instanceof Error
              ? resyncError.message
              : "Unknown error",
        });
      }

      const updatedHost =
        await createCurrentHostResolutionRepository().findHostById(
          Number(hostId),
          ownerId,
        );

      if (!updatedHost) {
        sshLogger.warn("Updated host not found after update", {
          operation: "host_update",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "Host not found after update" });
      }

      const baseHost = transformHostResponse(updatedHost);

      const resolvedHost =
        (await resolveHostCredentials(baseHost, userId)) || baseHost;
      databaseLogger.success("SSH host updated", {
        operation: "host_update_success",
        userId,
        hostId: parseInt(hostId),
      });

      const { ipAddress: uhIp, userAgent: uhUa } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
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

      const roleIds =
        await createCurrentRoleRepository().listUserRoleIds(userId);
      const accessEntries =
        await createCurrentRbacAccessRepository().listVisibleHostAccessEntries(
          userId,
          roleIds,
          now,
        );

      const rawData =
        await createCurrentHostResolutionRepository().listHostRowsForAccessList(
          userId,
          accessEntries,
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

      const ownerUsernames = new Map<string, string>();
      const userRepository = createCurrentUserRepository();
      for (const sharedHost of sharedHosts) {
        const ownerId = sharedHost.userId as string;
        if (!ownerUsernames.has(ownerId)) {
          try {
            const owner = await userRepository.findById(ownerId);
            ownerUsernames.set(ownerId, owner?.username ?? "");
          } catch {
            ownerUsernames.set(ownerId, "");
          }
        }
      }

      const data = [...decryptedOwnHosts, ...sharedHosts];

      const result = await Promise.all(
        data.map(async (row: Record<string, unknown>) => {
          const baseHost = {
            ...transformHostResponse(row),
            isShared: !!row.isShared,
            permissionLevel: row.permissionLevel || undefined,
            sharedExpiresAt: row.expiresAt || undefined,
            ownerUsername: row.isShared
              ? ownerUsernames.get(row.userId as string) || undefined
              : undefined,
          };

          const resolved =
            (await resolveHostCredentials(baseHost, userId)) || baseHost;
          return resolved;
        }),
      );

      const sanitized = result.map((host) =>
        host.isShared
          ? sanitizeHostForRecipient(
              host,
              host.permissionLevel as string | undefined,
            )
          : stripSensitiveFields(host),
      );
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
      const hostResolutionRepository = createCurrentHostResolutionRepository();
      const host = await hostResolutionRepository.findHostByIdForUser(
        Number(hostId),
        userId,
      );

      if (host) {
        const result = transformHostResponse(host);
        const resolved =
          (await resolveHostCredentials(result, userId)) || result;

        return res.json(stripSensitiveFields(resolved));
      }

      // Not the owner: shared recipients get a sanitized view of the host.
      const accessInfo = await permissionManager.canAccessHost(
        userId,
        Number(hostId),
        "connect",
      );

      if (!accessInfo.hasAccess) {
        sshLogger.warn("SSH host not found", {
          operation: "host_fetch_by_id",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "SSH host not found" });
      }

      const ownerId = await hostResolutionRepository.findHostOwnerId(
        Number(hostId),
      );
      const sharedHost = ownerId
        ? await hostResolutionRepository.findHostById(Number(hostId), ownerId)
        : null;

      if (!sharedHost) {
        return res.status(404).json({ error: "SSH host not found" });
      }

      let ownerUsername: string | undefined;
      try {
        const owner = ownerId
          ? await createCurrentUserRepository().findById(ownerId)
          : null;
        ownerUsername = owner?.username ?? undefined;
      } catch {
        ownerUsername = undefined;
      }

      const sharedResult = {
        ...transformHostResponse(sharedHost),
        isShared: true,
        permissionLevel: accessInfo.permissionLevel,
        sharedExpiresAt: accessInfo.expiresAt || undefined,
        ownerUsername,
      };

      res.json(
        sanitizeHostForRecipient(sharedResult, accessInfo.permissionLevel),
      );
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
 *           enum: [password, sudoPassword, vncPassword, key, keyPassword]
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

    if (
      ![
        "password",
        "sudoPassword",
        "vncPassword",
        "key",
        "keyPassword",
      ].includes(field)
    ) {
      return res.status(400).json({ error: "Invalid field" });
    }

    try {
      const host = await createCurrentHostResolutionRepository().findHostById(
        hostId,
        userId,
      );

      if (!host) {
        return res.status(404).json({ error: "Host not found" });
      }

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
      const host =
        await createCurrentHostResolutionRepository().findHostByIdForUser(
          Number(hostId),
          userId,
        );

      if (!host) {
        return res.status(404).json({ error: "SSH host not found" });
      }

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
            rdpAuthType: resolvedHost.rdpAuthType || null,
            rdpCredentialId: resolvedHost.rdpCredentialId || null,
            rdpUser: resolvedHost.rdpUser || null,
            rdpPassword: resolvedHost.rdpPassword || null,
            rdpDomain: resolvedHost.rdpDomain || null,
            rdpSecurity: resolvedHost.rdpSecurity || null,
            rdpIgnoreCert: !!resolvedHost.rdpIgnoreCert,
            vncAuthType: resolvedHost.vncAuthType || null,
            vncCredentialId: resolvedHost.vncCredentialId || null,
            vncUser: resolvedHost.vncUser || null,
            vncPassword: resolvedHost.vncPassword || null,
            telnetAuthType: resolvedHost.telnetAuthType || null,
            telnetCredentialId: resolvedHost.telnetCredentialId || null,
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
 *     description: Exports all SSH hosts for the current user. By default credentials are decrypted and embedded. With `share=1`, secrets are omitted and credential-authenticated hosts instead reference a scrubbed `credentials` array by alias, suitable for handing off to another user.
 *     tags:
 *       - SSH
 *     parameters:
 *       - in: query
 *         name: share
 *         required: false
 *         schema:
 *           type: string
 *         description: Set to "1" to export without embedded secrets.
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
    const shareMode = req.query.share === "1" || req.query.share === "true";

    if (!isNonEmptyString(userId)) {
      return res.status(400).json({ error: "Invalid userId" });
    }

    try {
      const allHosts =
        await createCurrentHostResolutionRepository().findHostsByUserId(userId);

      const exportedHosts = [];
      const usedCredentialIds = new Set<number>();

      for (const host of allHosts) {
        const resolvedHost = shareMode
          ? host
          : (await resolveHostCredentials(host, userId)) || host;

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
          password: shareMode ? null : resolvedHost.password || null,
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
              key: shareMode ? null : resolvedHost.key || null,
              keyPassword: shareMode ? null : resolvedHost.keyPassword || null,
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
              sudoPassword: shareMode
                ? null
                : resolvedHost.sudoPassword || null,
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
              socks5Password: shareMode
                ? null
                : resolvedHost.socks5Password || null,
              socks5ProxyChain: resolvedHost.socks5ProxyChain
                ? JSON.parse(resolvedHost.socks5ProxyChain as string)
                : null,
            };

        if (
          shareMode &&
          !isRemoteDesktop &&
          resolvedHost.authType === "credential" &&
          resolvedHost.credentialId
        ) {
          usedCredentialIds.add(resolvedHost.credentialId as number);
        }

        exportedHosts.push(exportData);
      }

      if (!shareMode) {
        sshLogger.success("All hosts exported with decrypted credentials", {
          operation: "hosts_export_all",
          count: exportedHosts.length,
          userId,
        });

        return res.json({ hosts: exportedHosts });
      }

      const exportedCredentials: Record<string, unknown>[] = [];
      if (usedCredentialIds.size > 0) {
        const credentialRepository = createCurrentCredentialRepository();
        const ownedCredentials =
          await credentialRepository.listDecryptedByUserId(userId);
        const credentialById = new Map(
          ownedCredentials.map((credential) => [credential.id, credential]),
        );

        for (const host of exportedHosts as Record<string, unknown>[]) {
          const credentialId = host.credentialId as number | null;
          if (!credentialId) continue;
          const credential = credentialById.get(credentialId);
          if (!credential) continue;

          host.credentialAlias = credential.name;

          if (
            !exportedCredentials.some(
              (entry) => entry.alias === credential.name,
            )
          ) {
            exportedCredentials.push({
              alias: credential.name,
              name: credential.name,
              description: credential.description || null,
              folder: credential.folder || null,
              tags:
                typeof credential.tags === "string"
                  ? credential.tags.split(",").filter(Boolean)
                  : [],
              authType: credential.authType,
              username: credential.username || null,
              keyType: credential.keyType || null,
            });
          }
        }
      }

      for (const host of exportedHosts as Record<string, unknown>[]) {
        delete host.credentialId;
      }

      sshLogger.success("All hosts exported for sharing without secrets", {
        operation: "hosts_export_all_share",
        count: exportedHosts.length,
        credentialCount: exportedCredentials.length,
        userId,
      });

      res.json({
        version: "1",
        exportedAt: new Date().toISOString(),
        credentials: exportedCredentials,
        hosts: exportedHosts,
      });
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
      const hostToDelete =
        await createCurrentHostResolutionRepository().findHostByIdForUser(
          Number(hostId),
          userId,
        );

      if (!hostToDelete) {
        sshLogger.warn("SSH host not found for deletion", {
          operation: "host_delete",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "SSH host not found" });
      }

      const numericHostId = Number(hostId);

      await createCurrentFileManagerBookmarkRepository().deleteByHostId(
        numericHostId,
      );

      await createCurrentTransferRecentRepository().deleteByHostId(
        numericHostId,
      );

      await createCurrentCommandHistoryRepository().deleteByHostId(
        numericHostId,
      );

      await createCurrentSshCredentialUsageRepository().deleteByHostId(
        numericHostId,
      );

      await createCurrentRecentActivityRepository().deleteByHostId(
        numericHostId,
      );

      await createCurrentRbacAccessRepository().deleteHostAccessForHost(
        numericHostId,
      );

      await createCurrentSessionRecordingRepository().deleteByHostId(
        numericHostId,
      );

      await createCurrentHostRepository().deleteForUser(userId, numericHostId);
      if (hostToDelete.syncId) {
        await createCurrentSyncTombstoneRepository().record(
          userId,
          "hosts",
          hostToDelete.syncId,
        );
      }

      databaseLogger.success("SSH host deleted", {
        operation: "host_delete_success",
        userId,
        hostId: parseInt(hostId),
      });

      const { ipAddress: dhIp, userAgent: dhUa } = getRequestMeta(req);
      await logAudit({
        userId,
        username: await getAuditUsername(userId),
        action: "delete_host",
        resourceType: "host",
        resourceId: hostId,
        resourceName: hostToDelete.name ?? hostToDelete.ip,
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
      const recent =
        await createCurrentTransferRecentRepository().listBySourceHost(
          userId,
          sourceHostId,
          10,
        );

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
      const transferRecentRepository = createCurrentTransferRecentRepository();
      await transferRecentRepository.upsertForDestination(userId, {
        sourceHostId,
        destHostId,
        destPath,
        destPathLabel,
      });

      await transferRecentRepository.pruneSourceHost(userId, sourceHostId, 10);

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
          const { SharedHostSecretsManager } =
            await import("../../utils/shared-host-secrets-manager.js");
          const sharedCred =
            await SharedHostSecretsManager.getInstance().getSecretForUser(
              host.id as number,
              requestingUserId,
              "ssh",
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

      const credential =
        await createCurrentHostResolutionRepository().findCredentialByIdForUser(
          credentialId,
          ownerId,
        );

      if (credential) {
        const resolvedHost: Record<string, unknown> = {
          ...host,
          password: pickResolvedPassword(host.password, credential.password),
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
      const opksshTokenRepository = createCurrentOpksshTokenRepository();
      const tokenData = await opksshTokenRepository.findByUserAndHost(
        userId,
        hostId,
      );

      if (!tokenData) {
        return res.status(404).json({ exists: false });
      }

      const expiresAt = new Date(tokenData.expiresAt);

      if (expiresAt < new Date()) {
        await opksshTokenRepository.deleteByUserAndHost(userId, hostId);
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
      const { deleteOPKSSHToken } = await import("../../hosts/opkssh-auth.js");
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
