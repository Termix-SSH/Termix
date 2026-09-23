// Core imports below point at TypeScript source so tsc can type-check them.
// The plugin build rewrites the prefix to the compiled output path; see
// packages/plugin-sdk/cli/lib/legacy-core-imports.mjs.
import express, { type Router } from "express";
import cookieParser from "cookie-parser";
import axios from "axios";
import { Client as SSHClient } from "ssh2";
import type { PluginContext, PluginSshHost } from "@termix/plugin-sdk/backend";
import { getErrorMessage } from "./error-message.js";
import { setPluginSsh, pluginSsh } from "./ssh.js";
import { setPluginCtx } from "./plugin-ctx.js";
import { AuthManager } from "../../../../src/backend/utils/auth-manager.js";
import { logger } from "../../../../src/backend/utils/logger.js";
import {
  logAudit,
  getAuditUsername,
  getRequestMeta,
} from "../../../../src/backend/utils/audit-logger.js";
import { createCurrentHostResolutionRepository } from "../../../../src/backend/database/repositories/factory.js";
import {
  resolveHostById,
  resolveHostBySyncId,
} from "../../../../src/backend/hosts/host-resolver.js";
import { createConnectionLog } from "../../../../src/backend/hosts/connection-log.js";
import { JumpHostChainError } from "../../../../src/backend/hosts/jump-host-chain.js";
import {
  hostAddressMismatch,
  HostAddressMismatchError,
  HostNotOnThisServerError,
  resolveServerHostId,
} from "../../../../src/backend/hosts/host-identity.js";
import type {
  LogEntry,
  ConnectionStage,
} from "../../../../src/types/connection-log.js";
import {
  ChannelOpenSerializer,
  execChannel,
  getSessionSftp,
  type PendingTOTPSession,
  type SSHSession,
} from "./session.js";
import { registerFileListingRoutes } from "./list-routes.js";
import { registerFileContentRoutes } from "./content-routes.js";
import { registerFileOperationRoutes } from "./operation-routes.js";
import { registerFileDownloadRoutes } from "./download-routes.js";
import { registerFileActionRoutes } from "./action-routes.js";
import { registerBookmarkRoutes } from "./bookmark-routes.js";
import {
  startHostTransfer,
  getTransferStatus,
  listActiveTransfers,
  probeHungStreamTransfers,
  requestTransferCancel,
  cleanupCancelledTransfer,
  retryHostTransfer,
  previewArchiveTransferMethod,
  type HostTransferDeps,
} from "./transfer-engine.js";
import { createFilesService } from "./service.js";
import { tables } from "./tables.js";

const fileLogger = logger;

/** Cosmetic only: whether the proxy step is worth a connection-log line. */
function hasSocks5Config(host: PluginSshHost): boolean {
  const chain = Array.isArray(host.socks5ProxyChain)
    ? host.socks5ProxyChain
    : [];
  return !!host.useSocks5 && (!!host.socks5Host || chain.length > 0);
}

/**
 * The host id came from whichever database the client is displaying. If this
 * server has a different machine under that id, refuse rather than browse,
 * edit or delete files on the wrong host.
 */
function assertResolvedHost(
  clientIp: unknown,
  hostSyncId: string | null | undefined,
  resolvedHost: { ip?: string } | null | undefined,
  hostId: number,
  userId: string,
): void {
  if (hostSyncId) {
    if (resolvedHost) return;
    fileLogger.error(
      "Refusing SFTP connection: host is not known to this server",
      undefined,
      { operation: "file_manager_host_sync_id_unknown", hostId, userId },
    );
    throw new HostNotOnThisServerError();
  }

  if (!hostAddressMismatch(clientIp, resolvedHost?.ip)) return;

  fileLogger.error(
    "Refusing SFTP connection: host id resolves to a different address here",
    undefined,
    {
      operation: "file_manager_host_id_mismatch",
      hostId,
      userId,
      clientIp,
      resolvedIp: resolvedHost?.ip,
    },
  );
  throw new HostAddressMismatchError();
}

export async function activate(ctx: PluginContext) {
  setPluginSsh(ctx.ssh);
  setPluginCtx(ctx);
  ctx.disposables.add(() => setPluginSsh(null));
  ctx.disposables.add(() => setPluginCtx(null));

  /* eslint-disable @typescript-eslint/no-explicit-any */
  // ctx.db.define hands back an untyped table object; typed at this module's
  // edge, the same way plugins/workspaces/src/backend/repository.ts does.
  const table: any = await ctx.db.define(tables[0]);
  const pinnedTable: any = await ctx.db.define(tables[1]);
  const shortcutsTable: any = await ctx.db.define(tables[2]);
  const transferRecentTable: any = await ctx.db.define(tables[3]);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // The user row survives a password-reset data wipe (the DEK could not be
  // recovered, not that the account is gone), so a refUser() cascade never
  // fires for it. Core asks every plugin holding user data to drop its own
  // rows on this topic instead.
  ctx.events.on("user.data_wiped", (payload) => {
    const userId = (payload as { userId?: string } | undefined)?.userId;
    if (!userId) return;
    void (async () => {
      try {
        /* eslint-disable @typescript-eslint/no-explicit-any */
        const drizzle = await ctx.db.client<any>();
        /* eslint-enable @typescript-eslint/no-explicit-any */
        const { eq } = await import("drizzle-orm");
        await drizzle.delete(table).where(eq(table.userId, userId));
        await drizzle.delete(pinnedTable).where(eq(pinnedTable.userId, userId));
        await drizzle
          .delete(shortcutsTable)
          .where(eq(shortcutsTable.userId, userId));
        await drizzle
          .delete(transferRecentTable)
          .where(eq(transferRecentTable.userId, userId));
        await ctx.db.persist();
      } catch (error) {
        ctx.log.error(
          "Failed to wipe file manager data for user",
          error as Error,
        );
      }
    })();
  });

  const sshSessions: Record<string, SSHSession> = {};
  const pendingTOTPSessions: Record<string, PendingTOTPSession> = {};
  const activeListRequests: Record<string, boolean> = {};

  function cleanupSession(sessionId: string) {
    const session = sshSessions[sessionId];
    if (!session) return;
    if (session.activeOperations > 0) {
      fileLogger.warn(
        `Deferring session cleanup for ${sessionId} - ${session.activeOperations} active operations`,
        {
          operation: "cleanup_deferred",
          sessionId,
          activeOperations: session.activeOperations,
        },
      );
      scheduleSessionCleanup(sessionId);
      return;
    }
    try {
      if (session.sftp) {
        session.sftp.end();
        session.sftp = undefined;
      }
    } catch {
      // expected
    }
    try {
      session.client.end();
    } catch {
      // expected
    }
    clearTimeout(session.timeout);
    delete sshSessions[sessionId];
  }

  function scheduleSessionCleanup(sessionId: string) {
    const session = sshSessions[sessionId];
    if (!session) return;
    if (session.timeout) clearTimeout(session.timeout);
    session.timeout = setTimeout(
      () => cleanupSession(sessionId),
      30 * 60 * 1000,
    );
  }

  // Pending TOTP/Warpgate parking sessions expire on their own; sweep stale
  // ones so a session left mid-handshake doesn't leak an open ssh2 Client.
  const pendingSweep = setInterval(() => {
    const now = Date.now();
    for (const sessionId of Object.keys(pendingTOTPSessions)) {
      const session = pendingTOTPSessions[sessionId];
      if (now - session.createdAt > 300000) {
        try {
          session.client.end();
        } catch {
          // expected
        }
        delete pendingTOTPSessions[sessionId];
      }
    }
  }, 60000);
  ctx.disposables.add(() => clearInterval(pendingSweep));
  ctx.disposables.add(() => {
    for (const sessionId of Object.keys(sshSessions)) cleanupSession(sessionId);
  });

  function verifySessionOwnership(
    session: SSHSession,
    userId: string,
  ): boolean {
    return !session.userId || session.userId === userId;
  }

  function resolveBrowseHostId(
    browseSessionId: string,
    browseSession: SSHSession,
  ): number | undefined {
    if (browseSession.hostId) return browseSession.hostId;
    const parsed = Number.parseInt(browseSessionId, 10);
    return Number.isFinite(parsed) ? parsed : undefined;
  }

  async function openDedicatedTransferSession(
    browseSessionId: string,
    dedicatedSessionId: string,
    userId: string,
    transferId: string,
    options?: { allowBrowseDisconnected?: boolean },
  ): Promise<SSHSession> {
    const browseSession = sshSessions[browseSessionId];
    if (!options?.allowBrowseDisconnected && !browseSession?.isConnected) {
      throw new Error("Browse SSH session not connected");
    }
    if (browseSession && !verifySessionOwnership(browseSession, userId)) {
      throw new Error("Session access denied");
    }

    const hostId = browseSession
      ? resolveBrowseHostId(browseSessionId, browseSession)
      : (() => {
          const parsed = Number.parseInt(browseSessionId, 10);
          return Number.isFinite(parsed) ? parsed : undefined;
        })();
    if (!hostId) {
      throw new Error("Cannot open transfer connection: unknown host");
    }

    const host = await resolveHostById(hostId, userId);
    if (!host) {
      throw new Error("Host not found for transfer connection");
    }

    const existingSession = sshSessions[dedicatedSessionId];
    if (
      existingSession?.isConnected &&
      verifySessionOwnership(existingSession, userId)
    ) {
      return existingSession;
    }

    fileLogger.info("Opening dedicated transfer SSH session", {
      operation: "transfer_ssh_connect",
      transferId,
      browseSessionId,
      dedicatedSessionId,
      hostId,
      ip: host.ip,
      port: host.port,
      username: host.username,
    });

    const connection = await ctx.ssh.connect<SSHClient>(
      host as unknown as PluginSshHost,
      {
        purpose: "file-transfer",
        timeoutMs: 60000,
        overrides: { tcpKeepAliveInitialDelay: 5000 },
      },
    );
    const client = connection.client;

    const session: SSHSession = {
      client,
      isConnected: true,
      lastActive: Date.now(),
      activeOperations: 0,
      channelOpener: new ChannelOpenSerializer(),
      userId,
      ip: host.ip,
      port: host.port,
      hostId: host.id,
      username: host.username,
      transferDedicated: true,
      transferId,
      browseSessionId,
    };

    client.on("close", () => {
      fileLogger.info("Dedicated transfer SSH connection closed", {
        operation: "transfer_ssh_disconnected",
        transferId,
        dedicatedSessionId,
        browseSessionId,
        hostId,
      });
      const existing = sshSessions[dedicatedSessionId];
      if (existing) {
        existing.isConnected = false;
        closeDedicatedTransferSession(dedicatedSessionId);
      }
    });

    sshSessions[dedicatedSessionId] = session;
    return session;
  }

  function closeDedicatedTransferSession(sessionId: string): void {
    const session = sshSessions[sessionId];
    if (!session?.transferDedicated) return;

    fileLogger.info("Closing dedicated transfer SSH session", {
      operation: "transfer_ssh_close",
      sessionId,
      transferId: session.transferId,
      browseSessionId: session.browseSessionId,
    });

    try {
      if (session.sftp) {
        session.sftp.end();
        session.sftp = undefined;
      }
    } catch {
      // expected
    }
    session.sftpPending = undefined;

    try {
      session.client.end();
    } catch {
      // expected
    }

    clearTimeout(session.timeout);
    delete sshSessions[sessionId];
  }

  const app = express();
  app.use(ctx.rbac.require("use") as never);
  app.use(cookieParser());
  // uploadFileChunk streams its octet-stream body straight into SFTP; letting
  // the JSON/urlencoded parsers run is harmless (they ignore a body they do
  // not claim), but the raw parser only applies to that one route so a chunk
  // isn't buffered whole in memory first.
  const rawBodyParser = express.raw({
    limit: "5gb",
    type: "application/octet-stream",
  });
  app.use((req, res, next) => {
    if (req.path === "/uploadFileChunk") return rawBodyParser(req, res, next);
    next();
  });
  app.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  app.use((req, res, next) => {
    if (
      req.path === "/connect" ||
      req.path === "/connect-totp" ||
      req.path === "/connect-warpgate"
    ) {
      return next();
    }
    const sessionId = (req.query.sessionId as string) || req.body?.sessionId;
    if (!sessionId) return next();
    const session = sshSessions[sessionId];
    if (!session) return next();
    const userId = ctx.currentActor();
    if (!userId || !verifySessionOwnership(session, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }
    next();
  });

  /**
   * @openapi
   * /plugin-api/file-manager/connect:
   *   post:
   *     summary: Connect to SSH for file management
   *     description: Establishes an SSH/SFTP connection for file manager operations. Supports password, key-based, and keyboard-interactive authentication, as well as jump hosts and SOCKS5 proxies.
   *     tags:
   *       - File Manager
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - sessionId
   *               - ip
   *               - port
   *               - username
   *             properties:
   *               sessionId:
   *                 type: string
   *               hostId:
   *                 type: number
   *               ip:
   *                 type: string
   *               port:
   *                 type: number
   *               username:
   *                 type: string
   *               password:
   *                 type: string
   *               sshKey:
   *                 type: string
   *               keyPassword:
   *                 type: string
   *               authType:
   *                 type: string
   *                 enum: [password, key, none]
   *               credentialId:
   *                 type: number
   *               jumpHosts:
   *                 type: array
   *                 items:
   *                   type: object
   *                   properties:
   *                     hostId:
   *                       type: number
   *               useSocks5:
   *                 type: boolean
   *               socks5Host:
   *                 type: string
   *               socks5Port:
   *                 type: number
   *               socks5Username:
   *                 type: string
   *               socks5Password:
   *                 type: string
   *               socks5ProxyChain:
   *                 type: array
   *     responses:
   *       200:
   *         description: SSH connection established, or requires TOTP/Warpgate authentication.
   *       400:
   *         description: Missing required parameters or invalid SSH key format.
   *       401:
   *         description: Authentication required.
   *       500:
   *         description: SSH connection failed.
   */
  app.post("/connect", async (req, res) => {
    const {
      sessionId,
      hostId,
      syncId: hostSyncId,
      ip,
      port,
      username,
      password,
      sshKey,
      keyPassword,
      authType,
      credentialId,
      jumpHosts,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
    } = req.body;

    const userId = ctx.currentActor();
    const connectionLogs: Array<Omit<LogEntry, "id" | "timestamp">> = [];

    connectionLogs.push(
      createConnectionLog(
        "info",
        "sftp_connecting",
        `Initiating SFTP connection to ${username}@${ip}:${port}`,
      ),
    );

    if (!userId) {
      fileLogger.error("SSH connection rejected: no authenticated user", {
        operation: "file_connect_auth",
        sessionId,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "sftp_auth",
          "Authentication required - no user session",
        ),
      );
      return res
        .status(401)
        .json({ error: "Authentication required", connectionLogs });
    }

    if (!sessionId || !ip || !username || !port) {
      fileLogger.warn("Missing SSH connection parameters for file manager", {
        operation: "file_connect",
        sessionId,
        hasIp: !!ip,
        hasUsername: !!username,
        hasPort: !!port,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "sftp_connecting",
          "Missing required connection parameters",
        ),
      );
      return res
        .status(400)
        .json({ error: "Missing SSH connection parameters", connectionLogs });
    }

    if (sshSessions[sessionId]?.isConnected) {
      cleanupSession(sessionId);
    }

    if (pendingTOTPSessions[sessionId]) {
      try {
        pendingTOTPSessions[sessionId].client.end();
      } catch {
        // expected
      }
      delete pendingTOTPSessions[sessionId];
    }

    const client = new SSHClient();

    connectionLogs.push(
      createConnectionLog(
        "info",
        "sftp_auth",
        "Resolving authentication credentials",
      ),
    );

    let resolvedCredentials = {
      password,
      sshKey,
      keyPassword,
      authType,
      sudoPassword: undefined as string | undefined,
      certPublicKey: undefined as string | undefined,
    };
    let resolvedIp = ip;
    let resolvedPort = port;
    let resolvedUsername = username;
    let resolvedTerminalConfig: Record<string, unknown> | undefined;
    let resolvedJumpHosts = jumpHosts;
    let resolvedScpLegacy = false;
    let resolvedUseSocks5 = useSocks5;
    let resolvedSocks5Host = socks5Host;
    let resolvedSocks5Port = socks5Port;
    let resolvedSocks5Username = socks5Username;
    let resolvedSocks5Password = socks5Password;
    let resolvedSocks5ProxyChain = socks5ProxyChain;
    let resolvedVaultProfileId: number | null = null;

    const resolveFrom = async () => {
      const resolvedHost = hostSyncId
        ? await resolveHostBySyncId(hostSyncId, userId)
        : await resolveHostById(hostId, userId);
      assertResolvedHost(ip, hostSyncId, resolvedHost, hostId, userId);
      if (!resolvedHost) return;
      resolvedIp = resolvedHost.ip;
      resolvedPort = resolvedHost.port;
      resolvedUsername = resolvedHost.username;
      resolvedCredentials = {
        password: resolvedHost.password,
        sshKey: resolvedHost.key,
        keyPassword: keyPassword || resolvedHost.keyPassword,
        authType: resolvedHost.authType,
        sudoPassword: resolvedHost.sudoPassword as string | undefined,
        certPublicKey: (resolvedHost as { certPublicKey?: string })
          .certPublicKey,
      };
      resolvedTerminalConfig = resolvedHost.terminalConfig as unknown as
        Record<string, unknown> | undefined;
      resolvedScpLegacy = resolvedHost.scpLegacy ?? false;
      resolvedVaultProfileId =
        (resolvedHost.vaultProfile as { id?: number } | undefined)?.id ?? null;
      if (resolvedHost.useSocks5) {
        resolvedUseSocks5 = resolvedHost.useSocks5;
        resolvedSocks5Host = resolvedHost.socks5Host;
        resolvedSocks5Port = resolvedHost.socks5Port;
        resolvedSocks5Username = resolvedHost.socks5Username;
        resolvedSocks5Password = resolvedHost.socks5Password;
        resolvedSocks5ProxyChain = resolvedHost.socks5ProxyChain;
      }
      if (
        (!resolvedJumpHosts || resolvedJumpHosts.length === 0) &&
        resolvedHost.jumpHosts &&
        resolvedHost.jumpHosts.length > 0
      ) {
        resolvedJumpHosts = resolvedHost.jumpHosts;
        connectionLogs.push(
          createConnectionLog(
            "info",
            "jump",
            `Loaded ${resolvedHost.jumpHosts.length} jump host(s) from server-side host data`,
          ),
        );
      }
      connectionLogs.push(
        createConnectionLog(
          "info",
          "sftp_auth",
          "Credentials resolved from server-side host data",
        ),
      );
    };

    if (hostId && userId && !password && !sshKey) {
      try {
        await resolveFrom();
      } catch (error) {
        if (
          error instanceof HostAddressMismatchError ||
          error instanceof HostNotOnThisServerError
        )
          throw error;
        fileLogger.warn(`Failed to resolve host credentials for ${hostId}`, {
          operation: "ssh_credentials",
          hostId,
          error: getErrorMessage(error),
        });
      }
    } else if (credentialId && hostId && userId) {
      try {
        await resolveFrom();
      } catch (error) {
        if (
          error instanceof HostAddressMismatchError ||
          error instanceof HostNotOnThisServerError
        )
          throw error;
        fileLogger.warn(`Failed to resolve credentials for host ${hostId}`, {
          operation: "ssh_credentials",
          hostId,
          credentialId,
          error: getErrorMessage(error),
        });
      }
    }

    let serverHostId = hostId;
    if (hostSyncId && userId) {
      const resolvedHost = await resolveHostBySyncId(hostSyncId, userId);
      assertResolvedHost(ip, hostSyncId, resolvedHost, hostId, userId);
      serverHostId = resolveServerHostId(hostId, resolvedHost) ?? hostId;
    }

    const effectiveAuthType =
      resolvedCredentials.authType ||
      (resolvedCredentials.sshKey
        ? "key"
        : resolvedCredentials.password
          ? "password"
          : undefined);
    if (!effectiveAuthType) {
      fileLogger.warn(
        "No valid authentication method provided for file manager",
        { operation: "file_connect", sessionId, hostId },
      );
      connectionLogs.push(
        createConnectionLog(
          "error",
          "sftp_auth",
          "No valid authentication method provided",
        ),
      );
      return res.status(400).json({
        error: "Either password or SSH key must be provided",
        connectionLogs,
      });
    }

    const connectTarget = {
      id: serverHostId,
      ip: resolvedIp,
      port: resolvedPort,
      username: resolvedUsername,
      userId,
      authType: effectiveAuthType,
      password: resolvedCredentials.password,
      key: resolvedCredentials.sshKey,
      keyPassword: resolvedCredentials.keyPassword,
      certPublicKey: resolvedCredentials.certPublicKey,
      terminalConfig: resolvedTerminalConfig ?? null,
      vaultProfile: resolvedVaultProfileId
        ? { id: resolvedVaultProfileId }
        : null,
      jumpHosts: resolvedJumpHosts,
      useSocks5: resolvedUseSocks5,
      socks5Host: resolvedSocks5Host,
      socks5Port: resolvedSocks5Port,
      socks5Username: resolvedSocks5Username,
      socks5Password: resolvedSocks5Password,
      socks5ProxyChain: resolvedSocks5ProxyChain,
    } as PluginSshHost;

    const ssh = pluginSsh();
    const prepared = await ssh.prepare(connectTarget, {
      purpose: "file-manager",
      client,
      serverHostId,
      log: (level, message) =>
        connectionLogs.push(createConnectionLog(level, "sftp_auth", message)),
    });
    const config = prepared.config as Record<string, unknown>;

    if (prepared.outcome.status !== "ready") {
      const outcome = prepared.outcome;
      if (
        outcome.status === "error" &&
        outcome.code === "passphrase-required"
      ) {
        return res.json({ status: "passphrase_required", connectionLogs });
      }
      fileLogger.warn("File manager SSH auth could not be prepared", {
        operation: "file_connect",
        sessionId,
        hostId,
        authType: effectiveAuthType,
        error: outcome.message,
      });
      connectionLogs.push(
        createConnectionLog("error", "sftp_auth", outcome.message),
      );
      if (outcome.status === "interaction-required") {
        return res.status(401).json({
          error: outcome.message,
          requiresAuthInteraction: outcome.interaction,
          ...(outcome.flag ? { [outcome.flag]: true } : {}),
          connectionLogs,
        });
      }
      return res.status(400).json({
        error:
          outcome.status === "error" && outcome.code === "invalid-key"
            ? "Invalid SSH key format"
            : outcome.message,
        connectionLogs,
      });
    }

    const credentialless = !ssh.requiresSecret(effectiveAuthType);

    let responseSent = false;

    connectionLogs.push(
      createConnectionLog("info", "dns", `Resolving DNS for ${ip}`),
    );
    connectionLogs.push(
      createConnectionLog("info", "tcp", `Connecting to ${ip}:${port}`),
    );
    connectionLogs.push(
      createConnectionLog("info", "handshake", "Initiating SSH handshake"),
    );
    connectionLogs.push(
      createConnectionLog(
        "info",
        "sftp_connecting",
        "Establishing SSH connection...",
      ),
    );

    client.on("ready", () => {
      if (responseSent) return;
      responseSent = true;
      fileLogger.info("File manager SSH connection established", {
        operation: "file_ssh_connected",
        sessionId,
        userId,
        hostId: serverHostId,
        ip,
        port,
        username,
      });
      connectionLogs.push(
        createConnectionLog(
          "success",
          "connected",
          "SSH connection established successfully",
        ),
      );
      connectionLogs.push(
        createConnectionLog(
          "success",
          "sftp_connected",
          "SFTP session established successfully",
        ),
      );
      sshSessions[sessionId] = {
        client,
        isConnected: true,
        lastActive: Date.now(),
        activeOperations: 0,
        channelOpener: new ChannelOpenSerializer(),
        userId,
        ip,
        port,
        hostId: serverHostId,
        username,
        sudoPassword: resolvedCredentials.sudoPassword,
        scpLegacy: resolvedScpLegacy,
      };
      scheduleSessionCleanup(sessionId);

      if (userId) {
        const { ipAddress, userAgent } = getRequestMeta(req);
        void (async () => {
          await logAudit({
            userId,
            username: await getAuditUsername(userId),
            action: "file_manager_connect",
            resourceType: "host",
            resourceId: serverHostId ? String(serverHostId) : undefined,
            resourceName: `${username}@${ip}:${port}`,
            ipAddress,
            userAgent,
            success: true,
          });
        })();
      }

      res.json({
        status: "success",
        message: "SSH connection established",
        connectionLogs,
      });

      if (hostId && userId) {
        void logFileManagerActivity(hostId, userId, username, ip, port);
      }
    });

    client.on("error", (err) => {
      if (responseSent) return;
      responseSent = true;
      fileLogger.error("SSH connection failed for file manager", {
        operation: "file_connect",
        sessionId,
        hostId,
        ip,
        port,
        username,
        error: err.message,
      });

      let errorStage: ConnectionStage;
      if (
        err.message.includes("ENOTFOUND") ||
        err.message.includes("getaddrinfo")
      ) {
        errorStage = "dns";
        connectionLogs.push(
          createConnectionLog(
            "error",
            errorStage,
            `DNS resolution failed: ${err.message}`,
          ),
        );
      } else if (
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ETIMEDOUT")
      ) {
        errorStage = "tcp";
        connectionLogs.push(
          createConnectionLog(
            "error",
            errorStage,
            `TCP connection failed: ${err.message}`,
          ),
        );
      } else if (
        err.message.includes("handshake") ||
        err.message.includes("key exchange")
      ) {
        errorStage = "handshake";
        connectionLogs.push(
          createConnectionLog(
            "error",
            errorStage,
            `SSH handshake failed: ${err.message}`,
          ),
        );
      } else if (
        err.message.includes("authentication") ||
        err.message.includes("Authentication")
      ) {
        errorStage = "auth";
        connectionLogs.push(
          createConnectionLog(
            "error",
            errorStage,
            `Authentication failed: ${err.message}`,
          ),
        );
      } else if (err.message.includes("verification failed")) {
        errorStage = "handshake";
        connectionLogs.push(
          createConnectionLog(
            "error",
            errorStage,
            "SSH host key has changed. For security, please open a Terminal connection to this host first to verify and accept the new key fingerprint.",
          ),
        );
      } else {
        connectionLogs.push(
          createConnectionLog(
            "error",
            "error",
            `SSH connection failed: ${err.message}`,
          ),
        );
      }

      if (
        err.message.includes("Cannot parse privateKey") &&
        err.message.includes("no passphrase")
      ) {
        res.json({ status: "passphrase_required", connectionLogs });
      } else if (
        credentialless &&
        (err.message.includes("authentication") ||
          err.message.includes("All configured authentication methods failed"))
      ) {
        res.json({
          status: "auth_required",
          reason: "no_keyboard",
          connectionLogs,
        });
      } else {
        res
          .status(500)
          .json({ status: "error", message: err.message, connectionLogs });
      }
    });

    client.on("close", () => {
      fileLogger.info("File manager SSH connection closed", {
        operation: "file_ssh_disconnected",
        sessionId,
        userId,
        hostId,
      });
      if (sshSessions[sessionId]) sshSessions[sessionId].isConnected = false;
      cleanupSession(sessionId);
    });

    const parkForAnswer = (
      finish: (responses: string[]) => void,
      prompts: Array<{ prompt: string; echo: boolean }>,
      promptIndex: number,
      isWarpgate = false,
    ) => {
      pendingTOTPSessions[sessionId] = {
        client,
        finish,
        config,
        createdAt: Date.now(),
        sessionId,
        hostId,
        ip,
        port,
        username,
        userId,
        prompts,
        totpPromptIndex: promptIndex,
        resolvedPassword: resolvedCredentials.password,
        totpAttempts: 0,
        ...(isWarpgate ? { isWarpgate: true } : {}),
      };
    };

    client.on(
      "keyboard-interactive",
      (
        name: string,
        instructions: string,
        _instructionsLang: string,
        prompts: Array<{ prompt: string; echo: boolean }>,
        finish: (responses: string[]) => void,
      ) => {
        const decision = ssh.classifyKeyboardInteractive(
          { name, instructions, prompts },
          connectTarget,
        );
        const autoFinish = () =>
          finish(ssh.autoResponses(prompts, resolvedCredentials.password));

        if (decision.kind === "auto") {
          finish(decision.responses);
          return;
        }

        if (decision.kind === "warpgate") {
          if (responseSent) return;
          responseSent = true;
          connectionLogs.push(
            createConnectionLog(
              "info",
              "sftp_auth",
              "Warpgate authentication required",
              { url: decision.url },
            ),
          );
          parkForAnswer(finish, prompts, -1, true);
          res.json({
            requires_warpgate: true,
            sessionId,
            url: decision.url,
            securityKey: decision.securityKey,
            connectionLogs,
          });
          return;
        }

        const promptIndex = decision.promptIndex;
        const promptText = prompts[promptIndex].prompt;
        const isPasswordPrompt = /password/i.test(promptText);

        if (
          decision.kind === "input" &&
          !(decision as { isPush?: boolean }).isPush &&
          !isPasswordPrompt
        ) {
          autoFinish();
          return;
        }

        if (decision.kind === "input" && isPasswordPrompt && credentialless) {
          if (responseSent) return;
          responseSent = true;
          client.end();
          res.json({ status: "auth_required", reason: "no_keyboard" });
          return;
        }

        if (responseSent || pendingTOTPSessions[sessionId]) {
          autoFinish();
          return;
        }
        responseSent = true;
        parkForAnswer(finish, prompts, promptIndex);

        if (decision.kind === "input" && isPasswordPrompt) {
          res.json({
            requires_totp: true,
            sessionId,
            prompt: promptText,
            isPassword: true,
          });
          return;
        }

        connectionLogs.push(
          createConnectionLog(
            "info",
            "sftp_auth",
            "TOTP verification required",
            {
              prompt: promptText,
            },
          ),
        );
        res.json({
          requires_totp: true,
          sessionId,
          prompt: promptText,
          connectionLogs,
        });
      },
    );

    const jumpHostCount: number = Array.isArray(resolvedJumpHosts)
      ? resolvedJumpHosts.length
      : 0;

    if (jumpHostCount > 0) {
      if (hasSocks5Config(connectTarget)) {
        connectionLogs.push(
          createConnectionLog(
            "info",
            "proxy",
            "Connecting via proxy + jump hosts",
          ),
        );
      }
      connectionLogs.push(
        createConnectionLog(
          "info",
          "jump",
          `Connecting via ${jumpHostCount} jump host(s)`,
        ),
      );
    } else if (hasSocks5Config(connectTarget)) {
      connectionLogs.push(
        createConnectionLog("info", "proxy", "Connecting via proxy", {
          proxyHost: resolvedSocks5Host,
          proxyPort: resolvedSocks5Port || 1080,
        }),
      );
    }

    try {
      const transport = await ssh.openTransport(connectTarget, config);
      if (transport.via === "proxy") {
        connectionLogs.push(
          createConnectionLog(
            "success",
            "proxy",
            "Proxy connected successfully",
          ),
        );
      }
      if (transport.jumpClient) {
        const jumpClient = transport.jumpClient as SSHClient;
        client.on("close", () => jumpClient.end());
      }
    } catch (error) {
      fileLogger.error("File manager transport failed", error, {
        operation: "file_transport",
        sessionId,
        hostId,
      });
      const stage =
        error instanceof JumpHostChainError || jumpHostCount > 0
          ? "jump"
          : "proxy";
      connectionLogs.push(
        createConnectionLog("error", stage, getErrorMessage(error)),
      );
      return res.status(500).json({
        error:
          error instanceof JumpHostChainError
            ? `Failed to connect through jump hosts: ${error.message}`
            : getErrorMessage(error),
        connectionLogs,
      });
    }

    client.connect(config);
  });

  async function logFileManagerActivity(
    hostId: number,
    userId: string,
    username: string,
    ip: string,
    port: number,
  ): Promise<void> {
    try {
      const host = await createCurrentHostResolutionRepository().findHostById(
        hostId,
        userId,
      );
      const hostName =
        host?.userId === userId && host.name
          ? host.name
          : `${username}@${ip}:${port}`;

      const authManager = AuthManager.getInstance();
      await axios.post(
        "http://localhost:30006/activity/log",
        { type: "file_manager", hostId, hostName },
        {
          headers: {
            Authorization: `Bearer ${await authManager.generateJWTToken(userId)}`,
          },
        },
      );
    } catch (error) {
      fileLogger.warn("Failed to log file manager activity", {
        operation: "activity_log_error",
        userId,
        hostId,
        error: getErrorMessage(error),
      });
    }
  }

  /**
   * @openapi
   * /plugin-api/file-manager/connect-totp:
   *   post:
   *     summary: Verify TOTP and complete connection
   *     description: Verifies the TOTP code and completes the SSH connection for file manager.
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: TOTP verified, SSH connection established.
   *       400:
   *         description: Session ID and TOTP code required.
   *       401:
   *         description: Invalid TOTP code or authentication required.
   *       404:
   *         description: TOTP session expired.
   *       408:
   *         description: TOTP session timeout.
   */
  app.post("/connect-totp", async (req, res) => {
    const { sessionId, totpCode } = req.body;
    const userId = ctx.currentActor();

    if (!userId) {
      fileLogger.error("TOTP verification rejected: no authenticated user", {
        operation: "file_totp_auth",
        sessionId,
      });
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!sessionId || !totpCode) {
      return res
        .status(400)
        .json({ error: "Session ID and TOTP code required" });
    }

    const session = pendingTOTPSessions[sessionId];
    if (!session) {
      fileLogger.warn("TOTP session not found or expired", {
        operation: "file_totp_verify",
        sessionId,
        userId,
      });
      return res
        .status(404)
        .json({ error: "TOTP session expired. Please reconnect." });
    }

    if (Date.now() - session.createdAt > 180000) {
      delete pendingTOTPSessions[sessionId];
      try {
        session.client.end();
      } catch {
        // expected
      }
      return res
        .status(408)
        .json({ error: "TOTP session timeout. Please reconnect." });
    }

    const responses = (session.prompts || []).map((p, index) => {
      if (index === session.totpPromptIndex) return totpCode;
      if (/password/i.test(p.prompt) && session.resolvedPassword) {
        return session.resolvedPassword;
      }
      return "";
    });

    let responseSent = false;

    session.client.once("ready", () => {
      if (responseSent) return;
      responseSent = true;
      clearTimeout(responseTimeout);
      delete pendingTOTPSessions[sessionId];

      setTimeout(() => {
        sshSessions[sessionId] = {
          client: session.client,
          isConnected: true,
          lastActive: Date.now(),
          activeOperations: 0,
          channelOpener: new ChannelOpenSerializer(),
          userId,
          ip: session.ip,
          port: session.port,
          hostId: session.hostId,
          username: session.username,
        };
        scheduleSessionCleanup(sessionId);

        res.json({
          status: "success",
          message: "TOTP verified, SSH connection established",
        });

        if (session.hostId && session.userId) {
          void logFileManagerActivity(
            session.hostId,
            session.userId,
            session.username ?? "",
            session.ip ?? "",
            session.port ?? 22,
          );
        }
      }, 200);
    });

    session.client.once("error", (err) => {
      if (responseSent) return;
      responseSent = true;
      clearTimeout(responseTimeout);
      delete pendingTOTPSessions[sessionId];
      fileLogger.error("TOTP verification failed", {
        operation: "file_totp_verify",
        sessionId,
        userId,
        error: err.message,
      });
      res.status(401).json({ status: "error", message: "Invalid TOTP code" });
    });

    const responseTimeout = setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        delete pendingTOTPSessions[sessionId];
        res.status(408).json({ error: "TOTP verification timeout" });
      }
    }, 60000);

    session.finish(responses);
  });

  /**
   * @openapi
   * /plugin-api/file-manager/connect-warpgate:
   *   post:
   *     summary: Complete Warpgate authentication
   *     description: Submits empty response to complete Warpgate authentication after user completes browser auth.
   *     tags:
   *       - File Manager
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             required:
   *               - sessionId
   *             properties:
   *               sessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Warpgate authentication completed successfully.
   *       401:
   *         description: Authentication failed or unauthorized.
   *       404:
   *         description: Warpgate session expired.
   *       408:
   *         description: Warpgate session timeout.
   */
  app.post("/connect-warpgate", async (req, res) => {
    const { sessionId } = req.body;
    const userId = ctx.currentActor();

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "Session ID required" });
    }

    const session = pendingTOTPSessions[sessionId];
    if (!session) {
      return res
        .status(404)
        .json({ error: "Warpgate session expired. Please reconnect." });
    }
    if (!session.isWarpgate) {
      return res
        .status(400)
        .json({ error: "Session is not a Warpgate session" });
    }
    if (Date.now() - session.createdAt > 300000) {
      delete pendingTOTPSessions[sessionId];
      try {
        session.client.end();
      } catch {
        // expected
      }
      return res
        .status(408)
        .json({ error: "Warpgate session timeout. Please reconnect." });
    }

    let responseSent = false;
    const responseTimeout = setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        delete pendingTOTPSessions[sessionId];
        res.status(408).json({ error: "Warpgate verification timeout" });
      }
    }, 60000);

    session.client.once("ready", () => {
      if (responseSent) return;
      responseSent = true;
      clearTimeout(responseTimeout);
      delete pendingTOTPSessions[sessionId];

      setTimeout(() => {
        sshSessions[sessionId] = {
          client: session.client,
          isConnected: true,
          lastActive: Date.now(),
          activeOperations: 0,
          channelOpener: new ChannelOpenSerializer(),
          userId,
          ip: session.ip,
          port: session.port,
          hostId: session.hostId,
          username: session.username,
        };
        scheduleSessionCleanup(sessionId);

        res.json({
          status: "success",
          message: "Warpgate verified, SSH connection established",
        });

        if (session.hostId && session.userId) {
          void logFileManagerActivity(
            session.hostId,
            session.userId,
            session.username ?? "",
            session.ip ?? "",
            session.port ?? 22,
          );
        }
      }, 200);
    });

    session.client.once("error", () => {
      if (responseSent) return;
      responseSent = true;
      clearTimeout(responseTimeout);
      delete pendingTOTPSessions[sessionId];
      res
        .status(401)
        .json({ status: "error", message: "Warpgate authentication failed" });
    });

    session.finish([""]);
  });

  /**
   * @openapi
   * /plugin-api/file-manager/disconnect:
   *   post:
   *     summary: Disconnect from SSH
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: SSH connection disconnected.
   */
  app.post("/disconnect", (req, res) => {
    const { sessionId } = req.body;
    const userId = ctx.currentActor();
    const session = sshSessions[sessionId];
    if (session && (!userId || !verifySessionOwnership(session, userId))) {
      return res.status(403).json({ error: "Session access denied" });
    }
    cleanupSession(sessionId);
    res.json({ status: "success", message: "SSH connection disconnected" });
  });

  /**
   * @openapi
   * /plugin-api/file-manager/sudo-password:
   *   post:
   *     summary: Set sudo password for session
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Sudo password set successfully.
   *       400:
   *         description: Invalid session.
   */
  app.post("/sudo-password", (req, res) => {
    const { sessionId, password } = req.body;
    const userId = ctx.currentActor();
    const session = sshSessions[sessionId];
    if (!session || !session.isConnected) {
      return res.status(400).json({ error: "Invalid or disconnected session" });
    }
    if (!userId || !verifySessionOwnership(session, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }
    session.sudoPassword = password;
    session.lastActive = Date.now();
    res.json({ status: "success", message: "Sudo password set" });
  });

  /**
   * @openapi
   * /plugin-api/file-manager/status:
   *   get:
   *     summary: Get SSH connection status
   *     tags:
   *       - File Manager
   *     parameters:
   *       - in: query
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: SSH connection status.
   */
  app.get("/status", (req, res) => {
    const sessionId = req.query.sessionId as string;
    const userId = ctx.currentActor();
    const session = sshSessions[sessionId];
    if (session && (!userId || !verifySessionOwnership(session, userId))) {
      return res.status(403).json({ error: "Session access denied" });
    }
    res.json({ status: "success", connected: !!session?.isConnected });
  });

  /**
   * @openapi
   * /plugin-api/file-manager/keepalive:
   *   post:
   *     summary: Keep SSH session alive
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Session keepalive successful.
   *       400:
   *         description: Session ID is required or session not found.
   */
  app.post("/keepalive", async (req, res) => {
    const { sessionId } = req.body;
    const userId = ctx.currentActor();

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }
    const session = sshSessions[sessionId];
    if (!session || !session.isConnected) {
      return res
        .status(400)
        .json({
          error: "SSH session not found or not connected",
          connected: false,
        });
    }
    if (!userId || !verifySessionOwnership(session, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    session.lastActive = Date.now();
    scheduleSessionCleanup(sessionId);

    if (session.sftp && !session.sftpPending) {
      try {
        await new Promise<void>((resolve, reject) => {
          session.sftp!.stat("/", (err) => (err ? reject(err) : resolve()));
        });
      } catch {
        session.sftp = undefined;
      }
    }

    res.json({
      status: "success",
      connected: true,
      message: "Session keepalive successful",
      lastActive: session.lastActive,
    });
  });

  registerFileListingRoutes(app, {
    ctx,
    sshSessions,
    activeListRequests,
    verifySessionOwnership,
  });
  registerFileContentRoutes(app, { ctx, sshSessions, verifySessionOwnership });
  registerFileOperationRoutes(app, {
    ctx,
    sshSessions,
    verifySessionOwnership,
  });
  registerFileDownloadRoutes(app, {
    ctx,
    sshSessions,
    scheduleSessionCleanup,
    verifySessionOwnership,
  });
  registerFileActionRoutes(app, {
    ctx,
    sshSessions,
    scheduleSessionCleanup,
    verifySessionOwnership,
  });
  registerBookmarkRoutes(app, ctx, {
    table,
    pinnedTable,
    shortcutsTable,
    transferRecentTable,
  });

  /**
   * @openapi
   * /plugin-api/file-manager/extractArchive:
   *   post:
   *     summary: Extract archive file
   *     description: Extracts an archive file (.tar, .tar.gz, .tgz, .zip, .tar.bz2, .tbz2, .tar.xz, .txz) to a specified or default location on the remote host.
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Archive extracted successfully.
   *       400:
   *         description: Missing required parameters, SSH connection not established, or unsupported archive format.
   *       500:
   *         description: Failed to extract archive.
   */
  app.post("/extractArchive", async (req, res) => {
    const { sessionId, archivePath, extractPath } = req.body;
    const userId = ctx.currentActor();

    if (!sessionId || !archivePath) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    const session = sshSessions[sessionId];
    if (!session || !session.isConnected) {
      return res.status(400).json({ error: "SSH session not connected" });
    }
    if (!userId || !verifySessionOwnership(session, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    session.lastActive = Date.now();
    scheduleSessionCleanup(sessionId);

    const fileName = archivePath.split("/").pop() || "";
    const fileExt = fileName.toLowerCase();

    let extractCommand: string;
    const targetPath =
      extractPath || archivePath.substring(0, archivePath.lastIndexOf("/"));

    const escapedArchive = archivePath.replace(/'/g, "'\"'\"'");
    const escapedTarget = targetPath.replace(/'/g, "'\"'\"'");
    const escapedDecompressed = archivePath
      .replace(/\.gz$/, "")
      .replace(/'/g, "'\"'\"'");

    if (fileExt.endsWith(".tar.gz") || fileExt.endsWith(".tgz")) {
      extractCommand = `tar -xzf '${escapedArchive}' -C '${escapedTarget}'`;
    } else if (fileExt.endsWith(".tar.bz2") || fileExt.endsWith(".tbz2")) {
      extractCommand = `tar -xjf '${escapedArchive}' -C '${escapedTarget}'`;
    } else if (fileExt.endsWith(".tar.xz")) {
      extractCommand = `tar -xJf '${escapedArchive}' -C '${escapedTarget}'`;
    } else if (fileExt.endsWith(".tar")) {
      extractCommand = `tar -xf '${escapedArchive}' -C '${escapedTarget}'`;
    } else if (fileExt.endsWith(".zip")) {
      extractCommand = `unzip -o '${escapedArchive}' -d '${escapedTarget}'`;
    } else if (fileExt.endsWith(".gz") && !fileExt.endsWith(".tar.gz")) {
      extractCommand = `gunzip -c '${escapedArchive}' > '${escapedDecompressed}'`;
    } else if (fileExt.endsWith(".bz2") && !fileExt.endsWith(".tar.bz2")) {
      extractCommand = `bunzip2 -k '${escapedArchive}'`;
    } else if (fileExt.endsWith(".xz") && !fileExt.endsWith(".tar.xz")) {
      extractCommand = `unxz -k '${escapedArchive}'`;
    } else if (fileExt.endsWith(".7z")) {
      extractCommand = `7z x '${escapedArchive}' -o'${escapedTarget}'`;
    } else if (fileExt.endsWith(".rar")) {
      extractCommand = `unrar x '${escapedArchive}' '${escapedTarget}/'`;
    } else {
      return res.status(400).json({ error: "Unsupported archive format" });
    }

    fileLogger.info("Extracting archive", {
      operation: "extract_archive",
      sessionId,
      archivePath,
      extractPath: targetPath,
      command: extractCommand,
    });

    execChannel(session, extractCommand, (err, stream) => {
      if (err) {
        fileLogger.error("SSH exec error during extract:", err, {
          operation: "extract_archive",
          sessionId,
          archivePath,
        });
        return res
          .status(500)
          .json({ error: "Failed to execute extract command" });
      }

      let errorOutput = "";
      stream.on("data", () => {});
      stream.stderr.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });
      stream.on("close", (code: number) => {
        if (code !== 0) {
          fileLogger.error("Extract command failed", {
            operation: "extract_archive",
            sessionId,
            archivePath,
            exitCode: code,
            error: errorOutput,
          });

          let friendlyError = errorOutput || "Failed to extract archive";
          if (
            errorOutput.includes("command not found") ||
            errorOutput.includes("not found")
          ) {
            let missingCmd = "";
            let installHint = "";
            if (fileExt.endsWith(".zip")) {
              missingCmd = "unzip";
              installHint =
                "apt install unzip / yum install unzip / brew install unzip";
            } else if (
              fileExt.endsWith(".tar.gz") ||
              fileExt.endsWith(".tgz") ||
              fileExt.endsWith(".tar.bz2") ||
              fileExt.endsWith(".tbz2") ||
              fileExt.endsWith(".tar.xz") ||
              fileExt.endsWith(".tar")
            ) {
              missingCmd = "tar";
              installHint = "Usually pre-installed on Linux/Unix systems";
            } else if (fileExt.endsWith(".gz")) {
              missingCmd = "gunzip";
              installHint =
                "apt install gzip / yum install gzip / Usually pre-installed";
            } else if (fileExt.endsWith(".bz2")) {
              missingCmd = "bunzip2";
              installHint =
                "apt install bzip2 / yum install bzip2 / brew install bzip2";
            } else if (fileExt.endsWith(".xz")) {
              missingCmd = "unxz";
              installHint =
                "apt install xz-utils / yum install xz / brew install xz";
            } else if (fileExt.endsWith(".7z")) {
              missingCmd = "7z";
              installHint =
                "apt install p7zip-full / yum install p7zip / brew install p7zip";
            } else if (fileExt.endsWith(".rar")) {
              missingCmd = "unrar";
              installHint =
                "apt install unrar / yum install unrar / brew install unrar";
            }
            if (missingCmd) {
              friendlyError = `Command '${missingCmd}' not found on remote server. Please install it first: ${installHint}`;
            }
          }
          return res.status(500).json({ error: friendlyError });
        }

        fileLogger.success("Archive extracted successfully", {
          operation: "extract_archive",
          sessionId,
          archivePath,
          extractPath: targetPath,
        });
        res.json({
          success: true,
          message: "Archive extracted successfully",
          extractPath: targetPath,
        });
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH extractArchive stream error:", streamErr, {
          operation: "extract_archive",
          sessionId,
          archivePath,
        });
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: "Stream error while extracting archive" });
        }
      });
    });
  });

  /**
   * @openapi
   * /plugin-api/file-manager/compressFiles:
   *   post:
   *     summary: Compress files
   *     description: Compresses files and/or directories on the remote host.
   *     tags:
   *       - File Manager
   *     responses:
   *       200:
   *         description: Files compressed successfully.
   *       400:
   *         description: Missing required parameters or unsupported compression format.
   *       500:
   *         description: Failed to compress files.
   */
  app.post("/compressFiles", async (req, res) => {
    const { sessionId, paths, archiveName, format } = req.body;
    const userId = ctx.currentActor();

    if (
      !sessionId ||
      !paths ||
      !Array.isArray(paths) ||
      paths.length === 0 ||
      !archiveName
    ) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    const session = sshSessions[sessionId];
    if (!session || !session.isConnected) {
      return res.status(400).json({ error: "SSH session not connected" });
    }
    if (!userId || !verifySessionOwnership(session, userId)) {
      return res.status(403).json({ error: "Session access denied" });
    }

    session.lastActive = Date.now();
    scheduleSessionCleanup(sessionId);

    const compressionFormat = format || "zip";
    let compressCommand: string;

    const firstPath = paths[0];
    const workingDir =
      firstPath.substring(0, firstPath.lastIndexOf("/")) || "/";
    const escapeShell = (s: string) => s.replace(/'/g, "'\"'\"'");
    const fileNames = paths
      .map((p) => {
        const name = p.split("/").pop();
        return `'./${escapeShell(name || "")}'`;
      })
      .join(" ");

    let archivePath = "";
    if (archiveName.includes("/")) {
      archivePath = archiveName;
    } else {
      archivePath = workingDir.endsWith("/")
        ? `${workingDir}${archiveName}`
        : `${workingDir}/${archiveName}`;
    }

    const escapedDir = escapeShell(workingDir);
    const escapedArchive = escapeShell(archivePath);

    if (compressionFormat === "zip") {
      compressCommand = `cd '${escapedDir}' && zip -r '${escapedArchive}' -- ${fileNames}`;
    } else if (compressionFormat === "tar.gz" || compressionFormat === "tgz") {
      compressCommand = `cd '${escapedDir}' && tar -czf '${escapedArchive}' -- ${fileNames}`;
    } else if (
      compressionFormat === "tar.bz2" ||
      compressionFormat === "tbz2"
    ) {
      compressCommand = `cd '${escapedDir}' && tar -cjf '${escapedArchive}' -- ${fileNames}`;
    } else if (compressionFormat === "tar.xz") {
      compressCommand = `cd '${escapedDir}' && tar -cJf '${escapedArchive}' -- ${fileNames}`;
    } else if (compressionFormat === "tar") {
      compressCommand = `cd '${escapedDir}' && tar -cf '${escapedArchive}' -- ${fileNames}`;
    } else if (compressionFormat === "7z") {
      compressCommand = `cd '${escapedDir}' && 7z a '${escapedArchive}' -- ${fileNames}`;
    } else {
      return res.status(400).json({ error: "Unsupported compression format" });
    }

    fileLogger.info("Compressing files", {
      operation: "compress_files",
      sessionId,
      paths,
      archivePath,
      format: compressionFormat,
      command: compressCommand,
    });

    execChannel(session, compressCommand, (err, stream) => {
      if (err) {
        fileLogger.error("SSH exec error during compress:", err, {
          operation: "compress_files",
          sessionId,
          paths,
        });
        return res
          .status(500)
          .json({ error: "Failed to execute compress command" });
      }

      let errorOutput = "";
      stream.on("data", () => {});
      stream.stderr.on("data", (data: Buffer) => {
        errorOutput += data.toString();
      });
      stream.on("close", (code: number) => {
        if (code !== 0) {
          fileLogger.error("Compress command failed", {
            operation: "compress_files",
            sessionId,
            paths,
            archivePath,
            exitCode: code,
            error: errorOutput,
          });

          let friendlyError = errorOutput || "Failed to compress files";
          if (
            errorOutput.includes("command not found") ||
            errorOutput.includes("not found")
          ) {
            const commandMap: Record<string, { cmd: string; install: string }> =
              {
                zip: {
                  cmd: "zip",
                  install:
                    "apt install zip / yum install zip / brew install zip",
                },
                "tar.gz": {
                  cmd: "tar",
                  install: "Usually pre-installed on Linux/Unix systems",
                },
                "tar.bz2": {
                  cmd: "tar",
                  install: "Usually pre-installed on Linux/Unix systems",
                },
                "tar.xz": {
                  cmd: "tar",
                  install: "Usually pre-installed on Linux/Unix systems",
                },
                tar: {
                  cmd: "tar",
                  install: "Usually pre-installed on Linux/Unix systems",
                },
                "7z": {
                  cmd: "7z",
                  install:
                    "apt install p7zip-full / yum install p7zip / brew install p7zip",
                },
              };
            const info = commandMap[compressionFormat];
            if (info) {
              friendlyError = `Command '${info.cmd}' not found on remote server. Please install it first: ${info.install}`;
            }
          }
          return res.status(500).json({ error: friendlyError });
        }

        fileLogger.success("Files compressed successfully", {
          operation: "compress_files",
          sessionId,
          paths,
          archivePath,
          format: compressionFormat,
        });
        res.json({
          success: true,
          message: "Files compressed successfully",
          archivePath,
        });
      });

      stream.on("error", (streamErr) => {
        fileLogger.error("SSH compressFiles stream error:", streamErr, {
          operation: "compress_files",
          sessionId,
          paths,
        });
        if (!res.headersSent) {
          res
            .status(500)
            .json({ error: "Stream error while compressing files" });
        }
      });
    });
  });

  const hostTransferDeps: HostTransferDeps = {
    sshSessions,
    getSessionSftp,
    execChannel,
    verifySessionOwnership,
    openDedicatedTransferSession,
    closeDedicatedTransferSession,
  };

  app.post("/transferMethodPreview", async (req, res) => {
    const {
      sourceSessionId,
      destSessionId,
      sourcePaths,
      destPath,
      methodPreference,
    } = req.body;
    if (
      !sourceSessionId ||
      !destSessionId ||
      !destPath ||
      !sourcePaths ||
      !Array.isArray(sourcePaths) ||
      sourcePaths.length === 0
    ) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    try {
      const userId = ctx.currentActor();
      const preview = await previewArchiveTransferMethod(hostTransferDeps, {
        sourceSessionId,
        destSessionId,
        sourcePaths,
        destPath,
        methodPreference:
          methodPreference === "tar" || methodPreference === "item_sftp"
            ? methodPreference
            : "auto",
        userId: userId ?? "",
      });
      res.json(preview);
    } catch (err) {
      fileLogger.error("Failed to preview transfer method", err, {
        operation: "host_transfer",
        sourceSessionId,
        destSessionId,
        sourcePaths,
      });
      res
        .status(500)
        .json({ error: getErrorMessage(err, "Failed to preview method") });
    }
  });

  app.post("/transferToHost", async (req, res) => {
    const {
      sourceSessionId,
      sourcePaths,
      destSessionId,
      destPath,
      move,
      methodPreference,
      parallelSegmentCount: parallelSegmentCountRaw,
    } = req.body;
    const userId = ctx.currentActor();

    if (
      !sourceSessionId ||
      !destSessionId ||
      !destPath ||
      !sourcePaths ||
      !Array.isArray(sourcePaths) ||
      sourcePaths.length === 0
    ) {
      return res.status(400).json({ error: "Missing required parameters" });
    }

    const sourceSession = sshSessions[sourceSessionId];
    const destSession = sshSessions[destSessionId];
    if (!sourceSession?.isConnected || !destSession?.isConnected) {
      return res.status(400).json({ error: "SSH session not connected" });
    }
    if (
      !userId ||
      !verifySessionOwnership(sourceSession, userId) ||
      !verifySessionOwnership(destSession, userId)
    ) {
      return res.status(403).json({ error: "Session access denied" });
    }

    sourceSession.lastActive = Date.now();
    destSession.lastActive = Date.now();
    scheduleSessionCleanup(sourceSessionId);
    scheduleSessionCleanup(destSessionId);

    try {
      const rawParallel = Number(parallelSegmentCountRaw);
      const parallelSegmentCount = Number.isFinite(rawParallel)
        ? Math.max(1, Math.min(8, Math.floor(rawParallel)))
        : undefined;

      const { transferId } = startHostTransfer(hostTransferDeps, {
        sourceSessionId,
        sourcePaths,
        destSessionId,
        destPath,
        move: !!move,
        userId,
        methodPreference:
          methodPreference === "tar" || methodPreference === "item_sftp"
            ? methodPreference
            : "auto",
        parallelSegmentCount,
      });

      res.json({ transferId });
    } catch (err) {
      fileLogger.error("Failed to start host transfer", err, {
        operation: "host_transfer",
        sourceSessionId,
        destSessionId,
        sourcePaths,
      });
      res.status(500).json({ error: "Failed to start transfer" });
    }
  });

  app.get("/activeTransfers", async (req, res) => {
    const userId = ctx.currentActor();
    if (!userId)
      return res.status(401).json({ error: "Authentication required" });
    await probeHungStreamTransfers(hostTransferDeps);
    res.json({ transfers: listActiveTransfers(userId) });
  });

  app.get("/transferStatus/:transferId", async (req, res) => {
    const userId = ctx.currentActor();
    const transferId = req.params.transferId;
    if (!userId)
      return res.status(401).json({ error: "Authentication required" });
    await probeHungStreamTransfers(hostTransferDeps);
    const status = getTransferStatus(transferId, userId);
    if (!status) return res.status(404).json({ error: "Transfer not found" });
    res.json(status);
  });

  app.post("/transferCancel/:transferId", (req, res) => {
    const userId = ctx.currentActor();
    const transferId = req.params.transferId;
    const cancelled = userId
      ? requestTransferCancel(transferId, userId)
      : false;
    if (!cancelled)
      return res
        .status(404)
        .json({ error: "Transfer not found or not running" });
    res.json({ ok: true });
  });

  app.post("/transferCleanup/:transferId", async (req, res) => {
    const userId = ctx.currentActor();
    const transferId = req.params.transferId;
    if (!userId)
      return res.status(401).json({ error: "Authentication required" });
    try {
      const result = await cleanupCancelledTransfer(
        hostTransferDeps,
        transferId,
        userId,
      );
      res.json(result);
    } catch (err) {
      const message = getErrorMessage(err, "Failed to clean up transfer");
      const status = message === "Transfer not found" ? 404 : 400;
      res.status(status).json({ error: message });
    }
  });

  app.post("/transferRetry/:transferId", (req, res) => {
    const userId = ctx.currentActor();
    const transferId = req.params.transferId;
    if (!userId)
      return res.status(401).json({ error: "Authentication required" });
    const retried = retryHostTransfer(hostTransferDeps, transferId, userId);
    if (!retried)
      return res
        .status(404)
        .json({ error: "Transfer not found or not retryable" });
    res.json({ ok: true, transferId });
  });

  ctx.http.router<Router>({ bodyLimit: "1gb" }).use(app);

  const service = createFilesService(ctx, {
    sshSessions,
    verifySessionOwnership,
  });
  ctx.services.provide("files.sftp", service);

  ctx.log.info("File manager mounted at /plugin-api/file-manager");
}

export async function deactivate() {
  // Sessions are closed by the disposable registered in activate; the http
  // router, db tables and service are all disposed by core.
}
