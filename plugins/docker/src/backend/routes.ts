// Core imports below point at TypeScript source so tsc can type-check them.
// The plugin build rewrites the prefix to the compiled output path; see
// packages/plugin-sdk/cli/lib/legacy-core-imports.mjs.
import { getErrorMessage } from "../../../../src/backend/utils/error-message.js";
import express from "express";
import axios from "axios";
import { Client as SSHClient } from "ssh2";
import type { PluginSshHost } from "@termix/plugin-sdk/backend";
import { pluginSsh } from "./ssh.js";
import { logger } from "../../../../src/backend/utils/logger.js";
import {
  logAudit,
  getAuditUsername,
  getRequestMeta,
} from "../../../../src/backend/utils/audit-logger.js";
import { createCurrentHostRepository } from "../../../../src/backend/database/repositories/factory.js";
import { resolveHostById } from "../../../../src/backend/hosts/host-resolver.js";
import { createConnectionLog } from "../../../../src/backend/hosts/connection-log.js";
import { DataCrypto } from "../../../../src/backend/utils/data-crypto.js";
import { AuthManager } from "../../../../src/backend/utils/auth-manager.js";
import type {
  AuthenticatedRequest,
  SSHHost,
} from "../../../../src/types/index.js";
import type {
  LogEntry,
  ConnectionStage,
} from "../../../../src/types/connection-log.js";
import {
  containerCommand,
  getContainerRuntimeConfig,
  getRuntimeLabel,
} from "./container-runtime.js";
import {
  type SSHSession,
  sshSessions,
  pendingTOTPSessions,
  cleanupSession,
  scheduleSessionCleanup,
  executeDockerCommand,
} from "./session-manager.js";

const sshLogger = logger;
const authManager = AuthManager.getInstance();

const CONTAINER_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/;
export const DOCKER_TIMESTAMP_RE = /^[0-9T:.Z+-]+$/;

export function getRequestUserId(req: express.Request): string | undefined {
  return (req as AuthenticatedRequest).userId;
}

export function registerDockerSshRoutes(app: express.Express): void {
  app.param("containerId", (req, res, next, value) => {
    if (!CONTAINER_ID_RE.test(value)) {
      return res.status(400).json({ error: "Invalid container ID" });
    }
    next();
  });

  /**
   * @openapi
   * /docker/ssh/connect:
   *   post:
   *     summary: Establish SSH session for Docker
   *     description: Establishes an SSH session to a host for Docker operations.
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *     responses:
   *       200:
   *         description: SSH connection established.
   *       400:
   *         description: Missing sessionId or hostId.
   *       401:
   *         description: Authentication required.
   *       403:
   *         description: Docker is not enabled for this host.
   *       404:
   *         description: Host not found.
   *       500:
   *         description: SSH connection failed.
   */
  app.post("/docker/ssh/connect", async (req, res) => {
    const {
      sessionId,
      hostId,
      userProvidedPassword,
      userProvidedSshKey,
      userProvidedKeyPassword,
      useSocks5,
      socks5Host,
      socks5Port,
      socks5Username,
      socks5Password,
      socks5ProxyChain,
    } = req.body;
    const userId = getRequestUserId(req);

    const connectionLogs: Array<Omit<LogEntry, "id" | "timestamp">> = [];

    if (!userId) {
      sshLogger.error("Docker SSH connection rejected: no authenticated user", {
        operation: "docker_connect_auth",
        sessionId,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "docker_connecting",
          "Authentication required",
        ),
      );
      return res
        .status(401)
        .json({ error: "Authentication required", connectionLogs });
    }

    if (!DataCrypto.canUserAccessData(userId)) {
      connectionLogs.push(
        createConnectionLog("error", "docker_connecting", "Session expired"),
      );
      return res.status(401).json({
        error: "Session expired - please log in again",
        code: "SESSION_EXPIRED",
        connectionLogs,
      });
    }

    if (!sessionId || !hostId) {
      sshLogger.warn("Missing Docker SSH connection parameters", {
        operation: "docker_connect",
        sessionId,
        hasHostId: !!hostId,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "docker_connecting",
          "Missing connection parameters",
        ),
      );
      return res
        .status(400)
        .json({ error: "Missing sessionId or hostId", connectionLogs });
    }

    connectionLogs.push(
      createConnectionLog(
        "info",
        "docker_connecting",
        "Initiating Docker SSH connection",
      ),
    );

    try {
      const resolvedHost = await resolveHostById(hostId, userId);
      if (!resolvedHost) {
        connectionLogs.push(
          createConnectionLog("error", "docker_connecting", "Host not found"),
        );
        return res
          .status(404)
          .json({ error: "Host not found", connectionLogs });
      }

      const host = resolvedHost as SSHHost;
      if (typeof host.jumpHosts === "string" && host.jumpHosts) {
        try {
          host.jumpHosts = JSON.parse(host.jumpHosts);
        } catch (e) {
          sshLogger.error("Failed to parse jump hosts", e, {
            hostId: host.id,
          });
          host.jumpHosts = [];
        }
      }
      if (typeof host.terminalConfig === "string" && host.terminalConfig) {
        try {
          host.terminalConfig = JSON.parse(host.terminalConfig as string);
        } catch {
          host.terminalConfig = undefined;
        }
      }
      const { runtime: containerRuntime } = getContainerRuntimeConfig(
        host.dockerConfig,
      );

      if (!host.enableDocker) {
        sshLogger.warn("Docker not enabled for host", {
          operation: "docker_connect",
          hostId,
          userId,
        });
        connectionLogs.push(
          createConnectionLog(
            "error",
            "docker_connecting",
            "Docker is not enabled for this host",
          ),
        );
        return res.status(403).json({
          error:
            "Docker is not enabled for this host. Enable it in Host Settings.",
          code: "DOCKER_DISABLED",
          connectionLogs,
        });
      }

      connectionLogs.push(
        createConnectionLog(
          "info",
          "docker_auth",
          "Resolving authentication credentials",
        ),
      );

      if (sshSessions[sessionId]) {
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

      const connectTarget = {
        ...(host as unknown as PluginSshHost),
        id: hostId,
        port: host.port || 22,
        userId,
        // The Docker panel sends its own proxy settings with the request.
        useSocks5,
        socks5Host,
        socks5Port,
        socks5Username,
        socks5Password,
        socks5ProxyChain,
      } as PluginSshHost;
      if (userProvidedPassword) {
        connectTarget.password = userProvidedPassword;
        connectTarget.authType = "password";
      }
      if (userProvidedSshKey) {
        connectTarget.key = userProvidedSshKey;
        connectTarget.authType = "key";
      }
      if (userProvidedKeyPassword) {
        connectTarget.keyPassword = userProvidedKeyPassword;
      }
      const resolvedPassword = connectTarget.password as string | undefined;
      const authType = (connectTarget.authType as string) || "none";

      const client = new SSHClient();
      const ssh = pluginSsh();
      const prepared = await ssh.prepare(connectTarget, {
        purpose: "docker",
        client,
        log: (level, message) =>
          connectionLogs.push(
            createConnectionLog(level, "docker_auth", message),
          ),
      });
      const config = prepared.config;

      if (prepared.outcome.status !== "ready") {
        const outcome = prepared.outcome;
        connectionLogs.push(
          createConnectionLog("error", "docker_auth", outcome.message),
        );
        if (outcome.status === "interaction-required") {
          return res.status(401).json({
            error: outcome.message,
            requiresAuthInteraction: outcome.interaction,
            ...(outcome.flag ? { [outcome.flag]: true } : {}),
            connectionLogs,
          });
        }
        return res.status(400).json({ error: outcome.message, connectionLogs });
      }

      // Auth types with no stored secret answer a password prompt with
      // "auth_required" so the panel can ask for credentials.
      const credentialless = !ssh.requiresSecret(authType);

      let responseSent = false;
      connectionLogs.push(
        createConnectionLog("info", "dns", `Resolving DNS for ${host.ip}`),
      );
      connectionLogs.push(
        createConnectionLog(
          "info",
          "tcp",
          `Connecting to ${host.ip}:${host.port || 22}`,
        ),
      );
      connectionLogs.push(
        createConnectionLog("info", "handshake", "Initiating SSH handshake"),
      );

      client.on("ready", () => {
        if (responseSent) return;
        responseSent = true;

        connectionLogs.push(
          createConnectionLog(
            "success",
            "connected",
            "SSH connection established successfully",
          ),
        );

        const session: SSHSession = {
          client,
          isConnected: true,
          lastActive: Date.now(),
          activeOperations: 0,
          hostId,
          userId,
          containerRuntime,
        };

        sshSessions[sessionId] = session;
        scheduleSessionCleanup(sessionId);

        client.exec("ver", (err, stream) => {
          if (!err && stream) {
            let output = "";
            stream.on("data", (d: Buffer) => {
              output += d.toString();
            });
            stream.on("close", () => {
              if (output.toLowerCase().includes("windows")) {
                session.isWindows = true;
              }
            });
            stream.stderr.on("data", () => {});
          }
        });

        void (async () => {
          const { ipAddress, userAgent } = getRequestMeta(req);
          await logAudit({
            userId,
            username: await getAuditUsername(userId),
            action: "docker_connect",
            resourceType: "host",
            resourceId: hostId ? String(hostId) : undefined,
            ipAddress,
            userAgent,
            success: true,
          });
        })();

        res.json({
          success: true,
          message: "SSH connection established",
          connectionLogs,
        });
      });

      client.on("error", (err) => {
        if (responseSent) {
          sshLogger.error(
            "Docker SSH connection error after response sent",
            err,
            {
              operation: "docker_connect_after_response",
              sessionId,
              hostId,
              userId,
            },
          );

          if (pendingTOTPSessions[sessionId]) {
            delete pendingTOTPSessions[sessionId];
          }
          return;
        }
        responseSent = true;

        sshLogger.error("Docker SSH connection failed", err, {
          operation: "docker_connect",
          sessionId,
          hostId,
          userId,
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
              `SSH host key has changed. For security, please open a Terminal connection to this host first to verify and accept the new key fingerprint.`,
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
          credentialless &&
          (err.message.includes("authentication") ||
            err.message.includes(
              "All configured authentication methods failed",
            ))
        ) {
          res.json({
            status: "auth_required",
            reason: "no_keyboard",
            connectionLogs,
          });
        } else {
          res.status(500).json({
            success: false,
            message: err.message || "SSH connection failed",
            connectionLogs,
          });
        }
      });

      client.on("close", () => {
        if (sshSessions[sessionId]) {
          sshSessions[sessionId].isConnected = false;
          cleanupSession(sessionId);
        }

        if (pendingTOTPSessions[sessionId]) {
          delete pendingTOTPSessions[sessionId];
        }
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
          ip: host.ip,
          port: host.port || 22,
          username: host.username,
          userId,
          prompts,
          totpPromptIndex: promptIndex,
          resolvedPassword,
          totpAttempts: 0,
          containerRuntime,
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
            finish(ssh.autoResponses(prompts, resolvedPassword));

          if (decision.kind === "auto") {
            finish(decision.responses);
            return;
          }

          if (decision.kind === "warpgate") {
            if (responseSent) return;
            responseSent = true;
            parkForAnswer(finish, prompts, -1, true);
            connectionLogs.push(
              createConnectionLog(
                "info",
                "docker_auth",
                "Warpgate authentication required",
              ),
            );
            res.json({
              requires_warpgate: true,
              sessionId,
              url: decision.url,
              securityKey: decision.securityKey,
              connectionLogs,
            });
            return;
          }

          const promptText = prompts[decision.promptIndex].prompt;
          const isPasswordPrompt = /password/i.test(promptText);

          if (
            decision.kind === "input" &&
            !decision.isPush &&
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
          parkForAnswer(finish, prompts, decision.promptIndex);

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
              "docker_auth",
              "TOTP verification required",
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

      if (host.jumpHosts && host.jumpHosts.length > 0) {
        connectionLogs.push(
          createConnectionLog(
            "info",
            "jump",
            `Connecting via ${host.jumpHosts.length} jump host(s)`,
          ),
        );
      } else if (useSocks5) {
        connectionLogs.push(
          createConnectionLog("info", "proxy", "Connecting via proxy"),
        );
      }

      try {
        const transport = await ssh.openTransport(connectTarget, config);
        if (transport.jumpClient) {
          const jumpClient = transport.jumpClient as SSHClient;
          client.on("close", () => jumpClient.end());
        }
      } catch (transportError) {
        sshLogger.error("Docker SSH transport failed", transportError, {
          operation: "docker_transport",
          sessionId,
          hostId,
        });
        connectionLogs.push(
          createConnectionLog(
            "error",
            host.jumpHosts && host.jumpHosts.length > 0 ? "jump" : "proxy",
            getErrorMessage(transportError),
          ),
        );
        if (!responseSent) {
          responseSent = true;
          return res.status(500).json({
            error: getErrorMessage(transportError),
            connectionLogs,
          });
        }
        return;
      }

      client.connect(config);
    } catch (error) {
      sshLogger.error("Docker SSH connection error", error, {
        operation: "docker_connect",
        sessionId,
        hostId,
        userId,
      });
      connectionLogs.push(
        createConnectionLog(
          "error",
          "docker_connecting",
          `Connection error: ${getErrorMessage(error)}`,
        ),
      );
      res.status(500).json({
        success: false,
        message: getErrorMessage(error),
        connectionLogs,
      });
    }
  });

  /**
   * @openapi
   * /docker/ssh/disconnect:
   *   post:
   *     summary: Disconnect SSH session
   *     description: Closes an active SSH session for Docker operations.
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: SSH session disconnected.
   *       400:
   *         description: Session ID is required.
   */
  app.post("/docker/ssh/disconnect", async (req, res) => {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    cleanupSession(sessionId);

    res.json({ success: true, message: "SSH session disconnected" });
  });

  /**
   * @openapi
   * /docker/ssh/connect-totp:
   *   post:
   *     summary: Verify TOTP and complete connection
   *     description: Verifies the TOTP code and completes the SSH connection.
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *               totpCode:
   *                 type: string
   *     responses:
   *       200:
   *         description: TOTP verified, SSH connection established.
   *       400:
   *         description: Session ID and TOTP code required.
   *       401:
   *         description: Invalid TOTP code.
   *       404:
   *         description: TOTP session expired.
   */
  app.post("/docker/ssh/connect-totp", async (req, res) => {
    const { sessionId, totpCode } = req.body;
    const userId = getRequestUserId(req);

    if (!userId) {
      sshLogger.error("TOTP verification rejected: no authenticated user", {
        operation: "docker_totp_auth",
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
      sshLogger.warn("TOTP session not found or expired", {
        operation: "docker_totp_verify",
        sessionId,
        userId,
        availableSessions: Object.keys(pendingTOTPSessions),
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
      sshLogger.warn("TOTP session timeout before code submission", {
        operation: "docker_totp_verify",
        sessionId,
        userId,
        age: Date.now() - session.createdAt,
      });
      return res
        .status(408)
        .json({ error: "TOTP session timeout. Please reconnect." });
    }

    const responses = (session.prompts || []).map((p, index) => {
      if (index === session.totpPromptIndex) {
        return totpCode;
      }
      if (/password/i.test(p.prompt) && session.resolvedPassword) {
        return session.resolvedPassword;
      }
      return "";
    });

    let responseSent = false;

    const responseTimeout = setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        delete pendingTOTPSessions[sessionId];
        sshLogger.warn("TOTP verification timeout", {
          operation: "docker_totp_verify",
          sessionId,
          userId,
        });
        res.status(408).json({ error: "TOTP verification timeout" });
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
          hostId: session.hostId,
          userId,
          containerRuntime: session.containerRuntime,
        };
        scheduleSessionCleanup(sessionId);

        res.json({
          status: "success",
          message: "TOTP verified, SSH connection established",
        });

        if (session.hostId && session.userId) {
          (async () => {
            try {
              const hostRow =
                await createCurrentHostRepository().findByIdForUser(
                  session.userId!,
                  session.hostId!,
                );

              const hostName =
                hostRow?.name ||
                `${session.username}@${session.ip}:${session.port}`;

              await axios.post(
                "http://localhost:30006/activity/log",
                {
                  type: "docker",
                  hostId: session.hostId,
                  hostName,
                },
                {
                  headers: {
                    Authorization: `Bearer ${await authManager.generateJWTToken(session.userId!)}`,
                  },
                },
              );
            } catch (error) {
              sshLogger.warn("Failed to log Docker activity (TOTP)", {
                operation: "activity_log_error",
                userId: session.userId,
                hostId: session.hostId,
                error: getErrorMessage(error),
              });
            }
          })();
        }
      }, 200);
    });

    session.client.once("error", (err) => {
      if (responseSent) return;
      responseSent = true;
      clearTimeout(responseTimeout);

      delete pendingTOTPSessions[sessionId];

      sshLogger.error("TOTP verification failed", {
        operation: "docker_totp_verify",
        sessionId,
        userId,
        error: err.message,
      });

      res.status(401).json({ status: "error", message: "Invalid TOTP code" });
    });

    session.finish(responses);
  });

  /**
   * @openapi
   * /docker/ssh/connect-warpgate:
   *   post:
   *     summary: Complete Warpgate authentication
   *     description: Submits empty response to complete Warpgate authentication after user completes browser auth.
   *     tags:
   *       - Docker
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
   *                 description: Session ID from initial connection attempt
   *     responses:
   *       200:
   *         description: Warpgate authentication completed successfully.
   *       401:
   *         description: Authentication failed or unauthorized.
   *       404:
   *         description: Warpgate session expired.
   */
  app.post("/docker/ssh/connect-warpgate", async (req, res) => {
    const { sessionId } = req.body;
    const userId = getRequestUserId(req);

    if (!userId) {
      sshLogger.error("Warpgate verification rejected: no authenticated user", {
        operation: "docker_warpgate_auth",
        sessionId,
      });
      return res.status(401).json({ error: "Authentication required" });
    }

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID required" });
    }

    const session = pendingTOTPSessions[sessionId];

    if (!session) {
      sshLogger.warn("Warpgate session not found or expired", {
        operation: "docker_warpgate_verify",
        sessionId,
        userId,
        availableSessions: Object.keys(pendingTOTPSessions),
      });
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
      sshLogger.warn("Warpgate session timeout before completion", {
        operation: "docker_warpgate_verify",
        sessionId,
        userId,
        age: Date.now() - session.createdAt,
      });
      return res
        .status(408)
        .json({ error: "Warpgate session timeout. Please reconnect." });
    }

    let responseSent = false;

    const responseTimeout = setTimeout(() => {
      if (!responseSent) {
        responseSent = true;
        delete pendingTOTPSessions[sessionId];
        sshLogger.warn("Warpgate verification timeout", {
          operation: "docker_warpgate_verify",
          sessionId,
          userId,
        });
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
          hostId: session.hostId,
          userId,
          containerRuntime: session.containerRuntime,
        };
        scheduleSessionCleanup(sessionId);

        res.json({
          status: "success",
          message: "Warpgate verified, SSH connection established",
        });

        if (session.hostId && session.userId) {
          (async () => {
            try {
              const hostRow =
                await createCurrentHostRepository().findByIdForUser(
                  session.userId!,
                  session.hostId!,
                );

              const hostName =
                hostRow?.name ||
                `${session.username}@${session.ip}:${session.port}`;

              await axios.post(
                "http://localhost:30006/activity/log",
                {
                  type: "docker",
                  hostId: session.hostId,
                  hostName,
                },
                {
                  headers: {
                    Authorization: `Bearer ${await authManager.generateJWTToken(session.userId!)}`,
                  },
                },
              );
            } catch (error) {
              sshLogger.warn("Failed to log Docker activity (Warpgate)", {
                operation: "activity_log_error",
                userId: session.userId,
                hostId: session.hostId,
                error: getErrorMessage(error),
              });
            }
          })();
        }
      }, 200);
    });

    session.client.once("error", (err) => {
      if (responseSent) return;
      responseSent = true;
      clearTimeout(responseTimeout);

      delete pendingTOTPSessions[sessionId];

      sshLogger.error("Warpgate verification failed", {
        operation: "docker_warpgate_verify",
        sessionId,
        userId,
        error: err.message,
      });

      res
        .status(401)
        .json({ status: "error", message: "Warpgate authentication failed" });
    });

    session.finish([""]);
  });

  /**
   * @openapi
   * /docker/ssh/keepalive:
   *   post:
   *     summary: Keep SSH session alive
   *     description: Keeps an active SSH session alive.
   *     tags:
   *       - Docker
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             type: object
   *             properties:
   *               sessionId:
   *                 type: string
   *     responses:
   *       200:
   *         description: Session keepalive successful.
   *       400:
   *         description: Session ID is required or session not found.
   */
  app.post("/docker/ssh/keepalive", async (req, res) => {
    const { sessionId } = req.body;
    const userId = getRequestUserId(req);

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
        connected: false,
      });
    }

    if (session.userId && session.userId !== userId) {
      return res.status(403).json({ error: "Session access denied" });
    }

    session.lastActive = Date.now();
    scheduleSessionCleanup(sessionId);

    res.json({
      success: true,
      connected: true,
      message: "Session keepalive successful",
      lastActive: session.lastActive,
    });
  });

  /**
   * @openapi
   * /docker/ssh/status:
   *   get:
   *     summary: Check SSH session status
   *     description: Checks the status of an active SSH session.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: query
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Session status.
   *       400:
   *         description: Session ID is required.
   */
  app.get("/docker/ssh/status", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const userId = getRequestUserId(req);

    if (!sessionId) {
      return res.status(400).json({ error: "Session ID is required" });
    }

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const session = sshSessions[sessionId];
    const isConnected =
      session?.userId === userId && session.isConnected === true;

    res.json({ success: true, connected: isConnected });
  });

  /**
   * @openapi
   * /docker/validate/{sessionId}:
   *   get:
   *     summary: Validate Docker availability
   *     description: Validates if Docker is available on the host.
   *     tags:
   *       - Docker
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *     responses:
   *       200:
   *         description: Docker availability status.
   *       400:
   *         description: SSH session not found or not connected.
   *       500:
   *         description: Validation failed.
   */
  app.get("/docker/validate/:sessionId", async (req, res) => {
    const { sessionId } = req.params;
    const userId = getRequestUserId(req);

    if (!userId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    if (pendingTOTPSessions[sessionId]) {
      return res.status(400).json({
        error: "Connection pending authentication",
        code: "AUTH_PENDING",
      });
    }

    const session = sshSessions[sessionId];

    if (!session || !session.isConnected) {
      return res.status(400).json({
        error: "SSH session not found or not connected",
      });
    }

    if (session.userId !== userId) {
      return res.status(403).json({ error: "Session access denied" });
    }

    session.lastActive = Date.now();
    session.activeOperations++;

    try {
      try {
        const runtime = session.containerRuntime ?? "docker";
        const runtimeLabel = getRuntimeLabel(runtime);
        const versionOutput = await executeDockerCommand(
          session,
          containerCommand(runtime, "--version"),
          sessionId,
          userId,
          session.hostId,
        );
        const versionMatch = versionOutput.match(
          /(?:Docker|podman) version ([^\s,]+)/i,
        );
        const version = versionMatch ? versionMatch[1] : "unknown";

        try {
          await executeDockerCommand(
            session,
            containerCommand(runtime, "ps"),
            sessionId,
            userId,
            session.hostId,
          );

          session.activeOperations--;
          return res.json({
            available: true,
            version,
            runtime,
          });
        } catch (daemonError) {
          session.activeOperations--;
          const errorMsg = getErrorMessage(daemonError, "");

          if (errorMsg.includes("Cannot connect to the Docker daemon")) {
            return res.json({
              available: false,
              error: `${runtimeLabel} daemon is not running or accessible`,
              code: "DAEMON_NOT_RUNNING",
              runtime,
            });
          }

          if (errorMsg.includes("permission denied")) {
            return res.json({
              available: false,
              error: `Permission denied accessing ${runtimeLabel}`,
              code: "PERMISSION_DENIED",
              runtime,
            });
          }

          return res.json({
            available: false,
            error: errorMsg,
            code: "DOCKER_ERROR",
            runtime,
          });
        }
      } catch {
        session.activeOperations--;
        const runtime = session.containerRuntime ?? "docker";
        const runtimeLabel = getRuntimeLabel(runtime);
        return res.json({
          available: false,
          error: `${runtimeLabel} is not installed on this host.`,
          code: "NOT_INSTALLED",
          runtime,
        });
      }
    } catch (error) {
      session.activeOperations--;
      sshLogger.error("Docker validation error", error, {
        operation: "docker_validate",
        sessionId,
        userId,
      });

      res.status(500).json({
        available: false,
        error: getErrorMessage(error, "Validation failed"),
      });
    }
  });
}
