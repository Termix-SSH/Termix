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
} from "../db/schema.js";
import { eq, and, desc, isNotNull, or, isNull, gte, sql, inArray } from "drizzle-orm";
import type { Request, Response } from "express";
import multer from "multer";
import { sshLogger } from "../../utils/logger.js";
import { SimpleDBOps } from "../../utils/simple-db-ops.js";
import { AuthManager } from "../../utils/auth-manager.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { SystemCrypto } from "../../utils/system-crypto.js";
import { DatabaseSaveTrigger } from "../db/index.js";

const router = express.Router();

const upload = multer({ storage: multer.memoryStorage() });

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isValidPort(port: unknown): port is number {
  return typeof port === "number" && port > 0 && port <= 65535;
}

const authManager = AuthManager.getInstance();
const authenticateJWT = authManager.createAuthMiddleware();
const requireDataAccess = authManager.createDataAccessMiddleware();

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

// Route: Create SSH data (requires JWT)
// POST /ssh/host
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
      pin,
      enableTerminal,
      enableTunnel,
      enableFileManager,
      defaultPath,
      tunnelConnections,
      jumpHosts,
      quickActions,
      statsConfig,
      terminalConfig,
      forceKeyboardInteractive,
    } = hostData;
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
      defaultPath: defaultPath || null,
      statsConfig: statsConfig ? JSON.stringify(statsConfig) : null,
      terminalConfig: terminalConfig ? JSON.stringify(terminalConfig) : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
    };

    if (effectiveAuthType === "password") {
      sshDataObj.password = password || null;
      sshDataObj.key = null;
      sshDataObj.key_password = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "key") {
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
      const baseHost = {
        ...createdHost,
        tags:
          typeof createdHost.tags === "string"
            ? createdHost.tags
              ? createdHost.tags.split(",").filter(Boolean)
              : []
            : [],
        pin: !!createdHost.pin,
        enableTerminal: !!createdHost.enableTerminal,
        enableTunnel: !!createdHost.enableTunnel,
        tunnelConnections: createdHost.tunnelConnections
          ? JSON.parse(createdHost.tunnelConnections as string)
          : [],
        jumpHosts: createdHost.jumpHosts
          ? JSON.parse(createdHost.jumpHosts as string)
          : [],
        enableFileManager: !!createdHost.enableFileManager,
        statsConfig: createdHost.statsConfig
          ? JSON.parse(createdHost.statsConfig as string)
          : undefined,
      };

      const resolvedHost = (await resolveHostCredentials(baseHost)) || baseHost;

      sshLogger.success(
        `SSH host created: ${name} (${ip}:${port}) by user ${userId}`,
        {
          operation: "host_create_success",
          userId,
          hostId: createdHost.id as number,
          name,
          ip,
          port,
          authType: effectiveAuthType,
        },
      );

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

// Route: Update SSH data (requires JWT)
// PUT /ssh/host/:id
router.put(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  upload.single("key"),
  async (req: Request, res: Response) => {
    const hostId = req.params.id;
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
      pin,
      enableTerminal,
      enableTunnel,
      enableFileManager,
      defaultPath,
      tunnelConnections,
      jumpHosts,
      quickActions,
      statsConfig,
      terminalConfig,
      forceKeyboardInteractive,
    } = hostData;
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
      defaultPath: defaultPath || null,
      statsConfig: statsConfig ? JSON.stringify(statsConfig) : null,
      terminalConfig: terminalConfig ? JSON.stringify(terminalConfig) : null,
      forceKeyboardInteractive: forceKeyboardInteractive ? "true" : "false",
    };

    if (effectiveAuthType === "password") {
      if (password) {
        sshDataObj.password = password;
      }
      sshDataObj.key = null;
      sshDataObj.key_password = null;
      sshDataObj.keyType = null;
    } else if (effectiveAuthType === "key") {
      if (key) {
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
      await SimpleDBOps.update(
        sshData,
        "ssh_data",
        and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)),
        sshDataObj,
        userId,
      );

      const updatedHosts = await SimpleDBOps.select(
        db
          .select()
          .from(sshData)
          .where(
            and(eq(sshData.id, Number(hostId)), eq(sshData.userId, userId)),
          ),
        "ssh_data",
        userId,
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
      const baseHost = {
        ...updatedHost,
        tags:
          typeof updatedHost.tags === "string"
            ? updatedHost.tags
              ? updatedHost.tags.split(",").filter(Boolean)
              : []
            : [],
        pin: !!updatedHost.pin,
        enableTerminal: !!updatedHost.enableTerminal,
        enableTunnel: !!updatedHost.enableTunnel,
        tunnelConnections: updatedHost.tunnelConnections
          ? JSON.parse(updatedHost.tunnelConnections as string)
          : [],
        jumpHosts: updatedHost.jumpHosts
          ? JSON.parse(updatedHost.jumpHosts as string)
          : [],
        enableFileManager: !!updatedHost.enableFileManager,
        statsConfig: updatedHost.statsConfig
          ? JSON.parse(updatedHost.statsConfig as string)
          : undefined,
      };

      const resolvedHost = (await resolveHostCredentials(baseHost)) || baseHost;

      sshLogger.success(
        `SSH host updated: ${name} (${ip}:${port}) by user ${userId}`,
        {
          operation: "host_update_success",
          userId,
          hostId: parseInt(hostId),
          name,
          ip,
          port,
          authType: effectiveAuthType,
        },
      );

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

// Route: Get SSH data for the authenticated user (requires JWT)
// GET /ssh/host
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

      // Get user's role IDs
      const userRoleIds = await db
        .select({ roleId: userRoles.roleId })
        .from(userRoles)
        .where(eq(userRoles.userId, userId));
      const roleIds = userRoleIds.map((r) => r.roleId);

      // Query own hosts + shared hosts with access check
      const rawData = await db
        .select({
          // All ssh_data fields
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
          createdAt: sshData.createdAt,
          updatedAt: sshData.updatedAt,
          credentialId: sshData.credentialId,
          overrideCredentialUsername: sshData.overrideCredentialUsername,
          quickActions: sshData.quickActions,

          // Shared access info
          isShared: sql<boolean>`${hostAccess.id} IS NOT NULL`,
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
              roleIds.length > 0 ? inArray(hostAccess.roleId, roleIds) : sql`false`,
            ),
            or(
              isNull(hostAccess.expiresAt),
              gte(hostAccess.expiresAt, now),
            ),
          ),
        )
        .where(
          or(
            eq(sshData.userId, userId), // Own hosts
            and(
              // Shared to user directly (not expired)
              eq(hostAccess.userId, userId),
              or(
                isNull(hostAccess.expiresAt),
                gte(hostAccess.expiresAt, now),
              ),
            ),
            roleIds.length > 0
              ? and(
                  // Shared to user's role (not expired)
                  inArray(hostAccess.roleId, roleIds),
                  or(
                    isNull(hostAccess.expiresAt),
                    gte(hostAccess.expiresAt, now),
                  ),
                )
              : sql`false`,
          ),
        );

      // Decrypt and format the data
      const data = await SimpleDBOps.select(
        Promise.resolve(rawData),
        "ssh_data",
        userId,
      );

      const result = await Promise.all(
        data.map(async (row: Record<string, unknown>) => {
          const baseHost = {
            ...row,
            tags:
              typeof row.tags === "string"
                ? row.tags
                  ? row.tags.split(",").filter(Boolean)
                  : []
                : [],
            pin: !!row.pin,
            enableTerminal: !!row.enableTerminal,
            enableTunnel: !!row.enableTunnel,
            tunnelConnections: row.tunnelConnections
              ? JSON.parse(row.tunnelConnections as string)
              : [],
            jumpHosts: row.jumpHosts ? JSON.parse(row.jumpHosts as string) : [],
            quickActions: row.quickActions
              ? JSON.parse(row.quickActions as string)
              : [],
            enableFileManager: !!row.enableFileManager,
            statsConfig: row.statsConfig
              ? JSON.parse(row.statsConfig as string)
              : undefined,
            terminalConfig: row.terminalConfig
              ? JSON.parse(row.terminalConfig as string)
              : undefined,
            forceKeyboardInteractive: row.forceKeyboardInteractive === "true",

            // Add shared access metadata
            isShared: !!row.isShared,
            permissionLevel: row.permissionLevel || undefined,
            sharedExpiresAt: row.expiresAt || undefined,
          };

          return (await resolveHostCredentials(baseHost)) || baseHost;
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

// Route: Get SSH host by ID (requires JWT)
// GET /ssh/host/:id
router.get(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = req.params.id;
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
      const result = {
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
        tunnelConnections: host.tunnelConnections
          ? JSON.parse(host.tunnelConnections)
          : [],
        jumpHosts: host.jumpHosts ? JSON.parse(host.jumpHosts) : [],
        quickActions: host.quickActions ? JSON.parse(host.quickActions) : [],
        enableFileManager: !!host.enableFileManager,
        statsConfig: host.statsConfig
          ? JSON.parse(host.statsConfig)
          : undefined,
        terminalConfig: host.terminalConfig
          ? JSON.parse(host.terminalConfig)
          : undefined,
        forceKeyboardInteractive: host.forceKeyboardInteractive === "true",
      };

      res.json((await resolveHostCredentials(result)) || result);
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

// Route: Export SSH host with decrypted credentials (requires data access)
// GET /ssh/db/host/:id/export
router.get(
  "/db/host/:id/export",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const hostId = req.params.id;
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

      const resolvedHost = (await resolveHostCredentials(host)) || host;

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

// Route: Delete SSH host by id (requires JWT)
// DELETE /ssh/host/:id
router.delete(
  "/db/host/:id",
  authenticateJWT,
  requireDataAccess,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = req.params.id;

    if (!isNonEmptyString(userId) || !hostId) {
      sshLogger.warn("Invalid userId or hostId for SSH host delete", {
        operation: "host_delete",
        hostId: parseInt(hostId),
        userId,
      });
      return res.status(400).json({ error: "Invalid userId or id" });
    }
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
        .where(
          and(
            eq(fileManagerRecent.hostId, numericHostId),
            eq(fileManagerRecent.userId, userId),
          ),
        );

      await db
        .delete(fileManagerPinned)
        .where(
          and(
            eq(fileManagerPinned.hostId, numericHostId),
            eq(fileManagerPinned.userId, userId),
          ),
        );

      await db
        .delete(fileManagerShortcuts)
        .where(
          and(
            eq(fileManagerShortcuts.hostId, numericHostId),
            eq(fileManagerShortcuts.userId, userId),
          ),
        );

      await db
        .delete(commandHistory)
        .where(
          and(
            eq(commandHistory.hostId, numericHostId),
            eq(commandHistory.userId, userId),
          ),
        );

      await db
        .delete(sshCredentialUsage)
        .where(
          and(
            eq(sshCredentialUsage.hostId, numericHostId),
            eq(sshCredentialUsage.userId, userId),
          ),
        );

      await db
        .delete(recentActivity)
        .where(
          and(
            eq(recentActivity.hostId, numericHostId),
            eq(recentActivity.userId, userId),
          ),
        );

      await db
        .delete(sshData)
        .where(and(eq(sshData.id, numericHostId), eq(sshData.userId, userId)));

      const host = hostToDelete[0];
      sshLogger.success(
        `SSH host deleted: ${host.name} (${host.ip}:${host.port}) by user ${userId}`,
        {
          operation: "host_delete_success",
          userId,
          hostId: parseInt(hostId),
          name: host.name,
          ip: host.ip,
          port: host.port,
        },
      );

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

// Route: Get recent files (requires JWT)
// GET /ssh/file_manager/recent
router.get(
  "/file_manager/recent",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = req.query.hostId
      ? parseInt(req.query.hostId as string)
      : null;

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

// Route: Add recent file (requires JWT)
// POST /ssh/file_manager/recent
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

// Route: Remove recent file (requires JWT)
// DELETE /ssh/file_manager/recent
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

// Route: Get pinned files (requires JWT)
// GET /ssh/file_manager/pinned
router.get(
  "/file_manager/pinned",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = req.query.hostId
      ? parseInt(req.query.hostId as string)
      : null;

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

// Route: Add pinned file (requires JWT)
// POST /ssh/file_manager/pinned
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

// Route: Remove pinned file (requires JWT)
// DELETE /ssh/file_manager/pinned
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

// Route: Get shortcuts (requires JWT)
// GET /ssh/file_manager/shortcuts
router.get(
  "/file_manager/shortcuts",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = req.query.hostId
      ? parseInt(req.query.hostId as string)
      : null;

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

// Route: Add shortcut (requires JWT)
// POST /ssh/file_manager/shortcuts
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

// Route: Remove shortcut (requires JWT)
// DELETE /ssh/file_manager/shortcuts
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

// Route: Get command history for a host
// GET /ssh/command-history/:hostId
router.get(
  "/command-history/:hostId",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const hostId = parseInt(req.params.hostId, 10);

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

// Route: Delete command from history
// DELETE /ssh/command-history
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
): Promise<Record<string, unknown>> {
  try {
    // Skip credential resolution for shared hosts
    // Shared users cannot access the owner's encrypted credentials
    if (host.isShared && host.credentialId) {
      sshLogger.info(
        `Skipping credential resolution for shared host ${host.id} with credentialId ${host.credentialId}`,
        {
          operation: "resolve_host_credentials_shared",
          hostId: host.id as number,
          isShared: host.isShared,
        },
      );
      // Return host without resolving credentials
      // The frontend should handle credential auth for shared hosts differently
      const result = { ...host };
      if (host.key_password !== undefined) {
        if (result.keyPassword === undefined) {
          result.keyPassword = host.key_password;
        }
        delete result.key_password;
      }
      return result;
    }

    if (host.credentialId && host.userId) {
      const credentialId = host.credentialId as number;
      const userId = host.userId as string;

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

      if (credentials.length > 0) {
        const credential = credentials[0];
        return {
          ...host,
          username: credential.username,
          authType: credential.auth_type || credential.authType,
          password: credential.password,
          key: credential.key,
          keyPassword: credential.key_password || credential.keyPassword,
          keyType: credential.key_type || credential.keyType,
        };
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

// Route: Rename folder (requires JWT)
// PUT /ssh/db/folders/rename
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

// Route: Get all folders with metadata (requires JWT)
// GET /ssh/db/folders
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

// Route: Update folder metadata (requires JWT)
// PUT /ssh/db/folders/metadata
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
        await db
          .update(sshFolders)
          .set({
            color,
            icon,
            updatedAt: new Date().toISOString(),
          })
          .where(and(eq(sshFolders.userId, userId), eq(sshFolders.name, name)));
      } else {
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

// Route: Delete all hosts in folder (requires JWT)
// DELETE /ssh/db/folders/:name/hosts
router.delete(
  "/folders/:name/hosts",
  authenticateJWT,
  async (req: Request, res: Response) => {
    const userId = (req as AuthenticatedRequest).userId;
    const folderName = req.params.name;

    if (!isNonEmptyString(userId) || !folderName) {
      return res.status(400).json({ error: "Invalid folder name" });
    }

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

// Route: Bulk import SSH hosts (requires JWT)
// POST /ssh/bulk-import
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

        if (!["password", "key", "credential"].includes(hostData.authType)) {
          results.failed++;
          results.errors.push(
            `Host ${i + 1}: Invalid authType. Must be 'password', 'key', or 'credential'`,
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
          defaultPath: hostData.defaultPath || "/",
          tunnelConnections: hostData.tunnelConnections
            ? JSON.stringify(hostData.tunnelConnections)
            : "[]",
          statsConfig: hostData.statsConfig
            ? JSON.stringify(hostData.statsConfig)
            : null,
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

// Route: Enable autostart for SSH configuration (requires JWT)
// POST /ssh/autostart/enable
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

// Route: Disable autostart for SSH configuration (requires JWT)
// DELETE /ssh/autostart/disable
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

// Route: Get autostart status for user's SSH configurations (requires JWT)
// GET /ssh/autostart/status
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

export default router;
