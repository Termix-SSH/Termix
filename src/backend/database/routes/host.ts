import { getErrorMessage } from "../../utils/error-message.js";
import { isQuickConnectAuthType } from "../../hosts/connect/auth-provider-registry.js";
import { ensureCoreSshAuthProviders } from "../../hosts/connect/core-providers.js";
import { applyFolderAccessRules } from "../../utils/folder-access-inheritance.js";
import { findUsableCredential } from "../../hosts/usable-credential.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import express, { type Request, type Response } from "express";
import multer from "multer";
import { sshLogger, databaseLogger } from "../../utils/logger.js";
import { pluginEvents, TOPICS } from "../../plugins/events.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { PermissionManager } from "../../utils/permission-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { parseKeyForStorage } from "../../hosts/stored-ssh-key.js";
import {
  pickResolvedPassword,
  pickResolvedUsername,
} from "../../hosts/credential-username.js";
import { emitInternalEvent } from "../../hosts/internal-events.js";
import { deleteOwnedHost } from "../../hosts/delete-host.js";
import {
  createCurrentCredentialRepository,
  createCurrentRbacAccessRepository,
  createCurrentRoleRepository,
  createCurrentHostResolutionRepository,
  createCurrentHostRepository,
  createCurrentUserRepository,
  createCurrentSharedHostAuthOverrideRepository,
  createCurrentHostDefaultsRepository,
} from "../repositories/factory.js";
import {
  applyHostKeyTypeUpdate,
  containsOwnerPrivateAuthUpdate,
  isNonEmptyString,
  isOptionalBoolean,
  isValidPort,
  normalizeProtocolEnableFields,
  OWNER_PRIVATE_AUTH_FIELDS,
  OWNER_PRIVATE_SSH_OPTION_FIELDS,
  OWNER_PRIVATE_TERMINAL_CONFIG_FIELDS,
  hostTerminalExport,
  sanitizeHostForRecipient,
  stripSensitiveFields,
  transformHostResponse,
} from "./host-normalizers.js";
import {
  attachHostPluginSettings,
  loadHostPluginSettings,
  withHostPluginSettings,
} from "./host-plugin-settings.js";
import { validateParentHostId } from "./host-parent-validation.js";
import { registerHostFolderRoutes } from "./host-folder-routes.js";
import { registerHostNetworkRoutes } from "./host-network-routes.js";
import { registerHostBulkRoutes } from "./host-bulk-routes.js";
import { registerHostDefaultsRoutes } from "./host-defaults-routes.js";
import { registerHostTagRoutes } from "./host-tag-routes.js";
import { registerHostStatusRoutes } from "./host-status-routes.js";
import {
  applyHostEnrollmentDefaults,
  requireHostEnrollmentAccessForPath,
} from "./host-enrollment-auth.js";
import {
  logAudit,
  getAuditUsername,
  getRequestMeta,
} from "../../utils/audit-logger.js";
import type {
  HostResolutionCredentialRecord,
  HostResolutionHostRecord,
} from "../repositories/host-resolution-repository.js";
import {
  requiresPersonalHostAuthentication,
  resolveRecipientSharedHostAuthentication,
} from "../../utils/shared-host-auth-resolver.js";
import { rejectSharedCopyWrites } from "../../sync/shared-copy-guard.js";
import { sshOptionsForWrite } from "../../hosts/ssh-options.js";
import {
  applyDefaultsAfterHostWrite,
  applyHostDefaultsToWrite,
} from "../../hosts/defaults/index.js";
import { applyPersonalHostValues } from "../../hosts/defaults/personal.js";
import {
  applyProtocolAuthPlan,
  attachProtocolAuth,
  firstProtocolUsername,
  listProtocolLogins,
  loadProtocolAuthSummaries,
  planProtocolAuthWrite,
  ProtocolAuthWriteError,
  readProtocolAuthPayload,
  toPortableLogins,
  withProtocolAuth,
  writeProtocolAuth,
  type PlannedProtocolAuth,
} from "../../hosts/protocol-auth/protocol-auth.js";
import {
  findHostProtocol,
  listHostProtocols,
} from "../../hosts/protocol-auth/registry.js";
import {
  mergeStoredTerminalFields,
  parseTerminalConfig,
} from "./host-terminal-fields.js";

const router = express.Router();
router.use(rejectSharedCopyWrites("host", /^\/db\/host\/(\d+)$/));

const upload = multer({ storage: multer.memoryStorage() });

/**
 * Tells whoever is polling this host that its details changed.
 *
 * An event, so whichever plugin polls the host can listen for it. Fire and
 * forget, so a subscriber that throws cannot fail the host update that
 * caused it.
 */
function notifyStatsHostUpdated(
  hostId: number,
  userId: string,
  operation: string,
): void {
  try {
    // The user travels with the event: a subscriber re-reading the host needs
    // a data key, and the bus carries no session of its own.
    pluginEvents.emit(TOPICS.hostUpdated, { hostId, userId });
  } catch (err) {
    sshLogger.warn("Failed to publish host update event", {
      operation,
      hostId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

registerHostTagRoutes(
  router,
  authenticateJWT,
  permissionManager.requirePermission("admin.settings.manage"),
);

registerHostStatusRoutes(router, {
  authenticateJWT,
  requireAdmin: authManager.createAdminMiddleware(),
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
  ["/db/host", "/enroll"],
  authenticateJWT,
  permissionManager.requirePermission("hosts.create"),
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
      parentHostId,
      tags,
      ip,
      port,
      username,
      password,
      authMethod,
      authType,
      shareSshAuth,
      credentialId,
      key,
      keyPassword,
      keyType,
      sudoPassword,
      pin,
      jumpHosts,
      statusCheckEnabled,
      statusCheckInterval,
      terminalConfig,
      sshOptions,
      forceKeyboardInteractive,
      notes,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
      connectionOrigin,
      localOnly,
      portKnockSequence,
      overrideCredentialUsername,
      enableSsh,
      sshPort,
    } = hostData;
    const protocolAuthPatch = readProtocolAuthPayload(hostData);
    databaseLogger.info("Creating SSH host", {
      operation: "host_create",
      userId,
      name,
      ip,
    });

    if (
      !isNonEmptyString(userId) ||
      !isNonEmptyString(ip) ||
      !isValidPort(port) ||
      !isOptionalBoolean(shareSshAuth) ||
      !isOptionalBoolean(enableSsh)
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

    let validatedParentHostId: number | null = null;
    if (parentHostId !== undefined && parentHostId !== null) {
      const numericParentHostId = Number(parentHostId);
      if (!Number.isInteger(numericParentHostId)) {
        return res.status(400).json({ error: "Invalid parent host" });
      }
      const parentError = await validateParentHostId(
        userId,
        null,
        numericParentHostId,
      );
      if (parentError) {
        return res.status(400).json({ error: parentError });
      }
      validatedParentHostId = numericParentHostId;
    }

    const effectiveConnectionType = connectionType || "ssh";
    const effectiveAuthType =
      authType ||
      authMethod ||
      (effectiveConnectionType !== "ssh" ? "password" : undefined);
    const effectiveUsername =
      username || firstProtocolUsername(protocolAuthPatch);
    const effectiveName =
      name || (effectiveUsername ? `${effectiveUsername}@${ip}` : String(ip));
    const sshDataObj: Record<string, unknown> = {
      userId: userId,
      connectionType: effectiveConnectionType,
      name: effectiveName,
      // A host is either placed in a folder or nested under a parent host,
      // never both -- setting one clears the other.
      folder: validatedParentHostId ? null : folder || null,
      parentHostId: validatedParentHostId,
      tags: Array.isArray(tags) ? tags.join(",") : tags || "",
      ip,
      port,
      username: effectiveUsername,
      authType: effectiveAuthType,
      shareSshAuth: shareSshAuth === true ? 1 : 0,
      credentialId: credentialId || null,
      overrideCredentialUsername: overrideCredentialUsername ? 1 : 0,
      pin: pin ? 1 : 0,
      jumpHosts: Array.isArray(jumpHosts) ? JSON.stringify(jumpHosts) : null,
      statusCheckEnabled: statusCheckEnabled === false ? 0 : 1,
      statusCheckInterval: normalizeStatusInterval(statusCheckInterval),
      terminalConfig: terminalConfig
        ? typeof terminalConfig === "string"
          ? terminalConfig
          : JSON.stringify(terminalConfig)
        : null,
      sshOptions: sshOptionsForWrite({ sshOptions, terminalConfig }) ?? null,
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
      connectionOrigin:
        connectionOrigin === "local" || connectionOrigin === "remote"
          ? connectionOrigin
          : null,
      ...(typeof localOnly === "boolean" ? { localOnly } : {}),
      portKnockSequence: portKnockSequence
        ? JSON.stringify(portKnockSequence)
        : null,
      ...normalizeProtocolEnableFields(hostData),
      sshPort: sshPort || port || 22,
    };

    // A host whose main protocol is a plugin's keeps any password it is given.
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
        const keyValidation = parseKeyForStorage(
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

    try {
      sshDataObj.defaultOverrides = JSON.stringify(
        await applyHostDefaultsToWrite({
          ownerId: userId,
          hostId: null,
          columns: sshDataObj,
          body: hostData,
        }),
      );
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
      await applyDefaultsAfterHostWrite(createdHost.id as number);
      if (protocolAuthPatch) {
        await writeProtocolAuth(
          userId,
          createdHost.id as number,
          protocolAuthPatch,
          { isOwner: true },
        );
      }

      // Standing folder shares apply to the newcomer.
      try {
        await applyFolderAccessRules(
          createdHost.id,
          userId!,
          createdHost.folder,
        );
      } catch (folderAccessError) {
        sshLogger.warn("Failed to inherit folder access on host create", {
          operation: "host_create_folder_access",
          hostId: createdHost.id,
          error: getErrorMessage(folderAccessError),
        });
      }
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

      emitInternalEvent("host_added", userId, createdHost.id as number, {
        name: String(name ?? ip),
      });

      res.json(await withProtocolAuth(stripSensitiveFields(resolvedHost)));
      notifyStatsHostUpdated(createdHost.id as number, userId, "host_create");
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
 *                 description: Any registered SSH auth type that works for an unsaved host (password, key, credential, agent, none, or one a plugin marks for Quick Connect).
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

    ensureCoreSshAuthProviders();
    if (!isQuickConnectAuthType(String(authType))) {
      return res
        .status(400)
        .json({ error: "That auth type cannot be used for Quick Connect" });
    }

    try {
      let resolvedPassword = password;
      let resolvedKey = key;
      let resolvedKeyPassword = keyPassword;
      let resolvedKeyType = keyType;
      let resolvedAuthType = authType;
      let resolvedUsername = username;

      if (authType === "credential" && credentialId) {
        const cred = await findUsableCredential(Number(credentialId), userId);

        if (!cred) {
          return res.status(404).json({ error: "Credential not found" });
        }

        resolvedPassword = pickResolvedPassword(password, cred.password) as
          string | undefined;
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
        jumpHosts: [],
        statusCheckEnabled: true,
        statusCheckInterval: null,
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
  permissionManager.requirePermission("hosts.edit"),
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
      parentHostId,
      tags,
      ip,
      port,
      username,
      password,
      authMethod,
      authType,
      shareSshAuth,
      credentialId,
      key,
      keyPassword,
      keyType,
      sudoPassword,
      pin,
      jumpHosts,
      statusCheckEnabled,
      statusCheckInterval,
      terminalConfig,
      sshOptions,
      forceKeyboardInteractive,
      notes,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
      connectionOrigin,
      localOnly,
      portKnockSequence,
      overrideCredentialUsername,
      enableSsh,
      sshPort,
    } = hostData;
    const protocolAuthPatch = readProtocolAuthPayload(hostData);
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
      !isOptionalBoolean(shareSshAuth) ||
      !isOptionalBoolean(enableSsh) ||
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

    let validatedParentHostId: number | null | undefined = undefined;
    if (parentHostId !== undefined) {
      if (parentHostId === null) {
        validatedParentHostId = null;
      } else {
        const numericParentHostId = Number(parentHostId);
        if (!Number.isInteger(numericParentHostId)) {
          return res.status(400).json({ error: "Invalid parent host" });
        }
        const parentError = await validateParentHostId(
          userId,
          Number(hostId),
          numericParentHostId,
        );
        if (parentError) {
          return res.status(400).json({ error: parentError });
        }
        validatedParentHostId = numericParentHostId;
      }
    }

    const effectiveAuthType = authType || authMethod;
    const effectiveUsername =
      username || firstProtocolUsername(protocolAuthPatch);
    const effectiveName =
      name || (effectiveUsername ? `${effectiveUsername}@${ip}` : String(ip));
    const sshDataObj: Record<string, unknown> = {
      connectionType: connectionType || "ssh",
      name: effectiveName,
      // A host is either placed in a folder or nested under a parent host,
      // never both. When the caller is assigning a parent, clear folder;
      // when the caller is assigning a folder, clear parentHostId.
      folder: validatedParentHostId ? null : folder,
      tags: Array.isArray(tags) ? tags.join(",") : tags || "",
      ip,
      port,
      username: effectiveUsername,
      authType: effectiveAuthType,
      shareSshAuth: shareSshAuth === true ? 1 : 0,
      credentialId: credentialId || null,
      overrideCredentialUsername: overrideCredentialUsername ? 1 : 0,
      pin: pin ? 1 : 0,
      jumpHosts: Array.isArray(jumpHosts) ? JSON.stringify(jumpHosts) : null,
      statusCheckEnabled: statusCheckEnabled === false ? 0 : 1,
      statusCheckInterval: normalizeStatusInterval(statusCheckInterval),
      terminalConfig: terminalConfig
        ? typeof terminalConfig === "string"
          ? terminalConfig
          : JSON.stringify(terminalConfig)
        : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
      notes: notes || null,
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
      ...(typeof localOnly === "boolean" ? { localOnly } : {}),
      portKnockSequence: portKnockSequence
        ? JSON.stringify(portKnockSequence)
        : null,
      ...normalizeProtocolEnableFields(hostData),
      sshPort: sshPort || port || 22,
    };

    const nextSshOptions = sshOptionsForWrite({ sshOptions, terminalConfig });
    if (nextSshOptions !== undefined) sshDataObj.sshOptions = nextSshOptions;
    // The editor leaves sudoPassword out when the user did not touch it.
    if (sudoPassword !== undefined) {
      sshDataObj.sudoPassword = sudoPassword || null;
    }

    // A host whose main protocol is a plugin's keeps any password it is given.
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
        const keyValidation = parseKeyForStorage(
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
      applyHostKeyTypeUpdate(sshDataObj, keyType);
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

    if (validatedParentHostId !== undefined) {
      sshDataObj.parentHostId = validatedParentHostId;
    } else if (folder !== undefined) {
      // Caller is assigning a folder (including clearing it back to root)
      // without touching parentHostId -- folder placement replaces
      // parent-host placement either way.
      sshDataObj.parentHostId = null;
    }

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
        // Shared editors work on the owner's real record, but the owner's SSH
        // authentication is private and can only be changed by that owner.
        if (containsOwnerPrivateAuthUpdate(hostData, "ssh")) {
          return res.status(403).json({
            error:
              "Only the host owner can change the host's SSH authentication",
          });
        }

        const incomingTerminalConfig = parseTerminalConfig(
          hostData.terminalConfig,
        );
        const protectedTerminalConfigField =
          OWNER_PRIVATE_TERMINAL_CONFIG_FIELDS.find((field) =>
            Object.prototype.hasOwnProperty.call(
              incomingTerminalConfig ?? {},
              field,
            ),
          );
        const incomingSshOptions = parseTerminalConfig(hostData.sshOptions);
        const protectedSshOptionField = OWNER_PRIVATE_SSH_OPTION_FIELDS.find(
          (field) =>
            Object.prototype.hasOwnProperty.call(
              incomingSshOptions ?? {},
              field,
            ),
        );
        if (protectedTerminalConfigField || protectedSshOptionField) {
          return res.status(403).json({
            error:
              "Only the host owner can change private SSH authentication settings",
          });
        }

        for (const field of OWNER_PRIVATE_AUTH_FIELDS.ssh) {
          delete sshDataObj[field];
        }
      }

      let protocolAuthPlan: PlannedProtocolAuth | null = null;
      if (protocolAuthPatch) {
        try {
          protocolAuthPlan = await planProtocolAuthWrite(
            ownerId,
            Number(hostId),
            protocolAuthPatch,
            { isOwner: accessInfo.isOwner },
          );
        } catch (error) {
          if (error instanceof ProtocolAuthWriteError) {
            return res.status(error.status).json({ error: error.message });
          }
          throw error;
        }
      }

      const terminalFieldsError = await mergeStoredTerminalFields(
        sshDataObj,
        hostData,
        Number(hostId),
        ownerId,
        accessInfo.isOwner,
      );
      if (terminalFieldsError) {
        return res.status(400).json({ error: terminalFieldsError });
      }

      const storedRow = (
        await createCurrentHostDefaultsRepository().listHosts({
          hostIds: [Number(hostId)],
        })
      )[0];
      sshDataObj.defaultOverrides = JSON.stringify(
        await applyHostDefaultsToWrite({
          ownerId,
          hostId: Number(hostId),
          columns: sshDataObj,
          body: hostData,
          stored: storedRow,
          lockedKeys: accessInfo.isOwner ? [] : ["auth"],
        }),
      );

      await createCurrentHostRepository().updateEncryptedForUser(
        ownerId,
        Number(hostId),
        sshDataObj,
      );
      await applyDefaultsAfterHostWrite(Number(hostId), {
        moved:
          !!storedRow &&
          ((sshDataObj.folder !== undefined &&
            (sshDataObj.folder ?? null) !== (storedRow.folder ?? null)) ||
            (sshDataObj.parentHostId !== undefined &&
              (sshDataObj.parentHostId ?? null) !==
                (storedRow.parentHostId ?? null))),
        ownerId,
      });
      if (protocolAuthPlan) {
        await applyProtocolAuthPlan(ownerId, Number(hostId), protocolAuthPlan);
      }

      // A host that moved into a folder inherits that folder's standing shares.
      try {
        await applyFolderAccessRules(
          Number(hostId),
          ownerId,
          sshDataObj.folder as string | null | undefined,
        );
      } catch (folderAccessError) {
        sshLogger.warn("Failed to inherit folder access on host update", {
          operation: "host_update_folder_access",
          hostId: parseInt(hostId),
          error: getErrorMessage(folderAccessError),
        });
      }

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
          error: getErrorMessage(resyncError),
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

      res.json(await withProtocolAuth(stripSensitiveFields(resolvedHost)));
      notifyStatsHostUpdated(parseInt(hostId), userId, "host_update");
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
  permissionManager.requirePermission("hosts.view"),
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
              error: getErrorMessage(decryptError),
            });
          }
        }
      }

      // One lookup for every owner rather than one per shared host.
      const ownerUsernames = new Map<string, string>();
      const ownerIds = Array.from(
        new Set(sharedHosts.map((host) => host.userId as string)),
      );
      if (ownerIds.length > 0) {
        try {
          const owners =
            await createCurrentUserRepository().listByIds(ownerIds);
          for (const owner of owners) {
            ownerUsernames.set(owner.id, owner.username ?? "");
          }
        } catch {
          // Falls through to an undefined ownerUsername below.
        }
      }

      const data = [...decryptedOwnHosts, ...sharedHosts];

      // Own hosts all resolve against the caller's own credentials, so they can
      // be fetched and decrypted in one batch instead of once per host.
      const ownCredentialIds = decryptedOwnHosts
        .map((host) => host.credentialId)
        .filter((id): id is number => typeof id === "number");
      const credentialsById = await createCurrentHostResolutionRepository()
        .listCredentialsByIdsForUser(ownCredentialIds, userId)
        .catch(() => new Map<number, HostResolutionCredentialRecord>());

      const result = await Promise.all(
        data.map(async (row: Record<string, unknown>) => {
          const transformed = transformHostResponse(row);
          const baseHost = {
            ...transformed,
            isShared: !!row.isShared || !!transformed.sharedCopy,
            permissionLevel:
              row.permissionLevel || transformed.permissionLevel || undefined,
            sharedExpiresAt: row.expiresAt || undefined,
            ownerUsername: row.isShared
              ? ownerUsernames.get(row.userId as string) || undefined
              : transformed.ownerUsername,
          };

          const resolved =
            (await resolveHostCredentials(baseHost, userId, credentialsById)) ||
            baseHost;
          return resolved;
        }),
      );

      attachProtocolAuth(result, await loadProtocolAuthSummaries(result));
      const sanitized = result.map((host) =>
        host.isShared
          ? sanitizeHostForRecipient(
              host,
              host.permissionLevel as string | undefined,
            )
          : stripSensitiveFields(host),
      );

      // After sanitizing: the connect-level projection reduces a shared host
      // to an allowlist, which would drop this again. One query for the list.
      const pluginSettingsByHost = await loadHostPluginSettings(
        sanitized
          .map((host) => Number(host.id))
          .filter((id) => Number.isInteger(id)),
      );
      await applyPersonalHostValues(pluginSettingsByHost, userId).catch(
        () => {},
      );
      attachHostPluginSettings(sanitized, pluginSettingsByHost);

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
  permissionManager.requirePermission("hosts.view"),
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

        return res.json(
          await withHostPluginSettings(
            await withProtocolAuth(stripSensitiveFields(resolved)),
          ),
        );
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
      const resolvedSharedResult = await withProtocolAuth(
        (await resolveHostCredentials(sharedResult, userId)) || sharedResult,
      );

      res.json(
        await withHostPluginSettings(
          sanitizeHostForRecipient(
            resolvedSharedResult,
            accessInfo.permissionLevel,
          ),
          userId,
        ),
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
 * /host/db/host/{id}/local-connection-auth:
 *   get:
 *     summary: Get the login a desktop needs to reach a shared host itself
 *     description: The minimum authentication material for connecting to a shared host from the recipient's own network. Transient; callers must not store or log it.
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
 *         description: The connection auth.
 *       400:
 *         description: Invalid id.
 *       404:
 *         description: Shared host not found.
 */
router.get(
  "/db/host/:id/local-connection-auth",
  authenticateJWT,
  permissionManager.requirePermission("hosts.view"),
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = Number(req.params.id);
    const userId = (req as AuthenticatedRequest).userId;

    if (!isNonEmptyString(userId) || !Number.isInteger(hostId) || hostId <= 0) {
      return res.status(400).json({ error: "Invalid userId or hostId" });
    }

    try {
      const access = await permissionManager.canAccessHost(
        userId,
        hostId,
        "connect",
      );
      if (!access.hasAccess || !access.isShared) {
        return res.status(404).json({ error: "Shared host not found" });
      }

      const repository = createCurrentHostResolutionRepository();
      const ownerId = await repository.findHostOwnerId(hostId);
      const host = ownerId
        ? await repository.findHostById(hostId, ownerId)
        : null;
      if (!host) {
        return res.status(404).json({ error: "Shared host not found" });
      }

      const resolved = await resolveHostCredentials(
        {
          ...transformHostResponse(host),
          isShared: true,
          permissionLevel: access.permissionLevel,
        },
        userId,
      );

      res.setHeader("Cache-Control", "no-store");
      return res.json({
        username: resolved.username,
        authType: resolved.authType,
        password: resolved.password || null,
        key: resolved.key || null,
        keyPassword: resolved.keyPassword || null,
        keyType: resolved.keyType || null,
      });
    } catch (error) {
      sshLogger.error(
        "Failed to resolve shared host local authentication",
        error,
        {
          operation: "shared_host_local_auth_resolve",
          hostId,
          userId,
        },
      );
      return res
        .status(500)
        .json({ error: "Failed to resolve shared host authentication" });
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
 *           enum: [password, sudoPassword, key, keyPassword]
 *       - in: query
 *         name: protocol
 *         schema:
 *           type: string
 *         description: A plugin protocol id; returns that protocol's saved password instead of field.
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
    const coreField = [
      "password",
      "sudoPassword",
      "key",
      "keyPassword",
    ].includes(field);
    // 2.8 clients ask for "<protocol>Password".
    const protocol =
      typeof req.query.protocol === "string"
        ? req.query.protocol
        : coreField
          ? undefined
          : /^([a-z][a-zA-Z0-9]*)Password$/.exec(field)?.[1];
    const protocolId = protocol ? findHostProtocol(protocol)?.id : undefined;

    if (!protocolId && (protocol || !coreField)) {
      return res.status(400).json({ error: "Invalid field" });
    }

    try {
      const host =
        await createCurrentHostResolutionRepository().findHostByIdForUser(
          hostId,
          userId,
        );

      if (!host) {
        return res.status(404).json({ error: "Host not found" });
      }

      if (protocolId) {
        const login = (await listProtocolLogins(hostId, userId)).find(
          (entry) => entry.protocol === protocolId,
        );
        if (!login?.password) {
          return res.status(404).json({ error: "No password set" });
        }
        return res.json({ value: login.password });
      }

      const resolved = (await resolveHostCredentials(host, userId)) || host;
      let value = resolved[field];

      if (!value && field === "sudoPassword") {
        value = hostTerminalExport(resolved).sudoPassword || null;
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
      const hostPluginSettings = (
        await loadHostPluginSettings([Number(hostId)])
      ).get(Number(hostId));

      const exportedConnectionType =
        (resolvedHost.connectionType as string) || "ssh";
      const isRemoteDesktop = exportedConnectionType !== "ssh";

      const baseExportData = {
        exportId: resolvedHost.id,
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
        // Every plugin's host settings, secrets redacted, for import to hand back.
        pluginSettings: hostPluginSettings ?? {},
        // Each plugin protocol's login, secrets included like the SSH ones.
        protocolAuth: toPortableLogins(
          await listProtocolLogins(Number(hostId), userId),
        ),
      };

      const exportData = isRemoteDesktop
        ? baseExportData
        : {
            ...baseExportData,
            authType: resolvedHost.authType,
            key: resolvedHost.key || null,
            keyPassword: resolvedHost.keyPassword || null,
            keyType: resolvedHost.keyType || null,
            credentialId: resolvedHost.credentialId || null,
            overrideCredentialUsername:
              !!resolvedHost.overrideCredentialUsername,
            sudoPassword:
              resolvedHost.sudoPassword ||
              hostTerminalExport(resolvedHost).sudoPassword ||
              null,
            jumpHosts: resolvedHost.jumpHosts
              ? JSON.parse(resolvedHost.jumpHosts as string)
              : null,
            terminalConfig:
              hostTerminalExport(resolvedHost).terminalConfig ?? null,
            sshOptions: hostTerminalExport(resolvedHost).sshOptions,
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
      const pluginSettingsByHost = await loadHostPluginSettings(
        allHosts.map((h) => h.id as number),
      );

      const exportedHosts = [];
      const usedCredentialIds = new Set<number>();

      for (const host of allHosts) {
        const resolvedHost = shareMode
          ? host
          : (await resolveHostCredentials(host, userId)) || host;
        const hostPluginSettings = pluginSettingsByHost.get(host.id as number);

        const exportedConnectionType =
          (resolvedHost.connectionType as string) || "ssh";
        const isRemoteDesktop = exportedConnectionType !== "ssh";

        const baseExportData = {
          exportId: resolvedHost.id,
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
          // Every plugin's host settings, secrets redacted, for import to hand back.
          pluginSettings: hostPluginSettings ?? {},
          protocolAuth: shareableLogins(
            toPortableLogins(
              await listProtocolLogins(host.id as number, userId),
            ),
            shareMode,
          ),
        };

        const exportData = isRemoteDesktop
          ? baseExportData
          : {
              ...baseExportData,
              authType: resolvedHost.authType,
              key: shareMode ? null : resolvedHost.key || null,
              keyPassword: shareMode ? null : resolvedHost.keyPassword || null,
              keyType: resolvedHost.keyType || null,
              credentialId: resolvedHost.credentialId || null,
              overrideCredentialUsername:
                !!resolvedHost.overrideCredentialUsername,
              sudoPassword: shareMode
                ? null
                : resolvedHost.sudoPassword ||
                  hostTerminalExport(resolvedHost).sudoPassword ||
                  null,
              jumpHosts: resolvedHost.jumpHosts
                ? JSON.parse(resolvedHost.jumpHosts as string)
                : null,
              terminalConfig:
                hostTerminalExport(resolvedHost).terminalConfig ?? null,
              sshOptions: hostTerminalExport(resolvedHost).sshOptions,
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
  permissionManager.requirePermission("hosts.delete"),
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
      const deleted = await deleteOwnedHost(userId, Number(hostId));

      if (!deleted) {
        sshLogger.warn("SSH host not found for deletion", {
          operation: "host_delete",
          hostId: parseInt(hostId),
          userId,
        });
        return res.status(404).json({ error: "SSH host not found" });
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
        resourceName: deleted.name,
        ipAddress: dhIp,
        userAgent: dhUa,
        success: true,
      });

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

// File manager recent/pinned/shortcuts and transfer/recent routes moved to
// the file-manager plugin, under /plugin-api/file-manager/, and command
// history to the ssh-terminal plugin, under /plugin-api/ssh-terminal/.

/**
 * A share export leaves out every secret and credential link, the same as
 * it does for SSH.
 */
function shareableLogins(
  logins: ReturnType<typeof toPortableLogins>,
  shareMode: boolean,
): ReturnType<typeof toPortableLogins> {
  if (!shareMode) return logins;
  const out: ReturnType<typeof toPortableLogins> = {};
  for (const [protocol, login] of Object.entries(logins)) {
    const declared = findHostProtocol(protocol);
    const secret = new Set(
      (declared?.credentialFields ?? [])
        .filter((field) => field.secret)
        .map((field) => field.key),
    );
    out[protocol] = {
      authType: login.authType === "credential" ? "direct" : login.authType,
      credentialId: null,
      username: login.username,
      password: null,
      fields: Object.fromEntries(
        Object.entries(login.fields).filter(
          ([key]) => declared && !secret.has(key),
        ),
      ),
    };
  }
  return out;
}

async function resolveHostCredentials(
  host: Record<string, unknown>,
  requestingUserId?: string,
  /**
   * Credentials already fetched for this request, keyed by id. The host list
   * preloads them in one query; single-host callers omit it and fall back to
   * fetching the one credential they need.
   */
  preloadedCredentials?: Map<number, HostResolutionCredentialRecord>,
): Promise<Record<string, unknown>> {
  try {
    const ownerId = (host.ownerId || host.userId) as string | undefined;
    if (
      requestingUserId &&
      ownerId &&
      requestingUserId !== ownerId &&
      typeof host.id === "number"
    ) {
      const authHost = host as unknown as HostResolutionHostRecord;
      const needsPersonalCredential = requiresPersonalHostAuthentication(
        authHost,
        "ssh",
      );
      const baseSshOverrideState = {
        required: needsPersonalCredential,
        ownerAuthShared: !!host.shareSshAuth,
      };
      // Owner auth for the remote desktop protocols is always snapshotted
      // for recipients; only their own override credential varies per user.
      const authOverrides: Record<string, unknown> = {
        ssh: baseSshOverrideState,
      };
      const overrideCredentialIds =
        await createCurrentSharedHostAuthOverrideRepository().listCredentialIds(
          host.id,
          requestingUserId,
        );
      // Whether a plugin protocol is on is its plugin's host setting; the
      // client only offers an override for one that is.
      for (const { id: protocol } of listHostProtocols()) {
        authOverrides[protocol] = {
          credentialId: overrideCredentialIds[protocol],
          required: false,
          ownerAuthShared: true,
        };
      }
      const recipientHost: Record<string, unknown> = {
        ...host,
        credentialId: null,
        password: null,
        key: null,
        keyPassword: null,
        keyType: null,
        authOverrides,
      };

      try {
        const resolution = await resolveRecipientSharedHostAuthentication(
          authHost,
          host.id,
          requestingUserId,
          "ssh",
        );

        if (resolution.source === "personal-override") {
          const credential = resolution.credential;
          return {
            ...recipientHost,
            authOverrides: {
              ...authOverrides,
              ssh: {
                credentialId: resolution.credentialId,
                required: false,
                ownerAuthShared: !!host.shareSshAuth,
              },
            },
            authType:
              credential.key || credential.privateKey
                ? "key"
                : credential.password
                  ? "password"
                  : "none",
            username: credential.username || recipientHost.username,
            password: credential.password,
            key: credential.privateKey || credential.key,
            keyPassword: credential.keyPassword,
            keyType: credential.keyType,
          };
        }

        if (resolution.source === "owner-shared") {
          if (resolution.authType === "agent") {
            return {
              ...recipientHost,
              authOverrides: {
                ...authOverrides,
                ssh: {
                  required: false,
                  ownerAuthShared: true,
                },
              },
              authType: "agent",
            };
          }

          const sharedAuth = resolution.secret;
          if (sharedAuth) {
            const resolvedUsername = pickResolvedUsername(
              recipientHost.username,
              sharedAuth.username,
              host.overrideCredentialUsername,
            );
            return {
              ...recipientHost,
              authOverrides: {
                ...authOverrides,
                ssh: {
                  required: false,
                  ownerAuthShared: true,
                },
              },
              authType: sharedAuth.key
                ? "key"
                : sharedAuth.password
                  ? "password"
                  : "none",
              username: resolvedUsername,
              password: sharedAuth.password,
              key: sharedAuth.key,
              keyPassword: sharedAuth.keyPassword,
              keyType: sharedAuth.keyType,
            };
          }
        }

        if (resolution.source === "secretless") {
          return {
            ...recipientHost,
            authOverrides: {
              ...authOverrides,
              ssh: {
                required: false,
                ownerAuthShared: !!host.shareSshAuth,
              },
            },
          };
        }
      } catch {
        // A missing/deleted override or snapshot behaves like unavailable auth.
      }

      return recipientHost;
    }

    if (host.credentialId && (host.userId || host.ownerId)) {
      const credentialId = host.credentialId as number;
      const credentialOwnerId = (host.ownerId || host.userId) as string;

      const credential =
        preloadedCredentials?.get(credentialId) ??
        (await findUsableCredential(credentialId, credentialOwnerId));

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
      `Failed to resolve credentials for host ${host.id}: ${getErrorMessage(error)}`,
    );
    return host;
  }
}

registerHostFolderRoutes(router, {
  authenticateJWT,
  requireViewPermission: permissionManager.requirePermission("hosts.view"),
  requireEditPermission: permissionManager.requirePermission("hosts.edit"),
  requireDeletePermission: permissionManager.requirePermission("hosts.delete"),
  requireCredentialEditPermission:
    permissionManager.requirePermission("credentials.edit"),
  requireDataAccess,
});

registerHostBulkRoutes(
  router,
  authenticateJWT,
  permissionManager.requirePermission("hosts.create"),
  permissionManager.requirePermission("hosts.edit"),
  requireDataAccess,
);

registerHostNetworkRoutes(router, {
  authenticateJWT,
  requireViewPermission: permissionManager.requirePermission("hosts.view"),
  requireDataAccess,
});

registerHostDefaultsRoutes(router, {
  authenticateJWT,
  requireEditPermission: permissionManager.requirePermission("hosts.edit"),
  requireDataAccess,
  requireAdminSettings: permissionManager.requirePermission(
    "admin.settings.manage",
  ),
});

export default router;

/** Seconds between status checks, or null to follow the global setting. */
function normalizeStatusInterval(value: unknown): number | null {
  const seconds = Number(value);
  if (value === null || value === undefined || value === "") return null;
  return Number.isInteger(seconds) && seconds >= 5 && seconds <= 86400
    ? seconds
    : null;
}
