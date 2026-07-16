import express from "express";
import axios from "axios";
import { Client as SSHClient } from "ssh2";
import { logger } from "../../utils/logger.js";
import {
  createCurrentCredentialRepository,
  createCurrentHostRepository,
  createCurrentHostResolutionRepository,
} from "../../database/repositories/factory.js";
import { createJumpHostChain } from "../jump-host-chain.js";
import { createConnectionLog } from "../connection-log.js";
import { DataCrypto } from "../../utils/data-crypto.js";
import { AuthManager } from "../../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../../types/index.js";
import {
  createSocks5Connection,
  type SOCKS5Config,
} from "../../utils/socks5-helper.js";
import type { SSHHost, ProxyNode } from "../../../types/index.js";
import type {
  LogEntry,
  ConnectionStage,
} from "../../../types/connection-log.js";
import { SSHHostKeyVerifier } from "../host-key-verifier.js";
import { preparePrivateKeyForSSH2 } from "../../utils/ssh-key-utils.js";
import { applyAgentAuth } from "../terminal-auth-helpers.js";
import {
  containerCommand,
  getContainerRuntimeConfig,
  getRuntimeLabel,
} from "../container-runtime.js";
import { resolveSshConnectConfigHost } from "../ssh-dns.js";
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
      const hostRecord =
        await createCurrentHostResolutionRepository().findHostById(
          hostId,
          userId,
        );

      if (!hostRecord) {
        connectionLogs.push(
          createConnectionLog("error", "docker_connecting", "Host not found"),
        );
        return res
          .status(404)
          .json({ error: "Host not found", connectionLogs });
      }

      const host = hostRecord as unknown as SSHHost;

      if (host.userId !== userId) {
        const { PermissionManager } =
          await import("../../utils/permission-manager.js");
        const permissionManager = PermissionManager.getInstance();
        const accessInfo = await permissionManager.canAccessHost(
          userId,
          hostId,
          "execute",
        );

        if (!accessInfo.hasAccess) {
          sshLogger.warn("User does not have access to host", {
            operation: "docker_connect",
            hostId,
            userId,
          });
          connectionLogs.push(
            createConnectionLog(
              "error",
              "docker_connecting",
              "Access denied to host",
            ),
          );
          return res
            .status(403)
            .json({ error: "Access denied", connectionLogs });
        }
      }
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

      let resolvedCredentials: {
        password?: string;
        sshKey?: string;
        keyPassword?: string;
        authType?: string;
      } = {
        password: host.password,
        sshKey: host.key,
        keyPassword: host.keyPassword,
        authType: host.authType,
      };

      if (userProvidedPassword) {
        resolvedCredentials.password = userProvidedPassword;
      }
      if (userProvidedSshKey) {
        resolvedCredentials.sshKey = userProvidedSshKey;
        resolvedCredentials.authType = "key";
      }
      if (userProvidedKeyPassword) {
        resolvedCredentials.keyPassword = userProvidedKeyPassword;
      }

      if (host.credentialId) {
        const ownerId = host.userId;

        if (userId !== ownerId) {
          try {
            const { SharedCredentialManager } =
              await import("../../utils/shared-credential-manager.js");
            const sharedCredManager = SharedCredentialManager.getInstance();
            const sharedCred =
              await sharedCredManager.getSharedCredentialForUser(
                host.id,
                userId,
              );

            if (sharedCred) {
              resolvedCredentials = {
                password: sharedCred.password,
                sshKey: sharedCred.key,
                keyPassword: sharedCred.keyPassword,
                authType: sharedCred.authType,
              };
            }
          } catch (error) {
            sshLogger.error("Failed to resolve shared credential", error, {
              operation: "docker_connect",
              hostId,
              userId,
            });
          }
        } else {
          const credential =
            await createCurrentCredentialRepository().findDecryptedByIdForUser(
              userId,
              host.credentialId as number,
            );

          if (credential) {
            resolvedCredentials = {
              password: credential.password as string | undefined,
              sshKey: (credential.key || credential.privateKey) as
                | string
                | undefined,
              keyPassword: credential.keyPassword as string | undefined,
              authType: credential.authType as string | undefined,
            };
          }
        }
      }

      const client = new SSHClient();

      const config: Record<string, unknown> = {
        host: host.ip?.replace(/^\[|\]$/g, "") || host.ip,
        port: host.port || 22,
        username: host.username,
        tryKeyboard: true,
        keepaliveInterval:
          typeof host.terminalConfig?.keepaliveInterval === "number"
            ? host.terminalConfig.keepaliveInterval * 1000
            : 60000,
        keepaliveCountMax:
          typeof host.terminalConfig?.keepaliveCountMax === "number"
            ? host.terminalConfig.keepaliveCountMax
            : 5,
        readyTimeout: 60000,
        tcpKeepAlive: true,
        tcpKeepAliveInitialDelay: 30000,
        hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
          hostId,
          host.ip,
          host.port || 22,
          null,
          userId,
          false,
        ),
      };

      if (
        resolvedCredentials.authType === "none" ||
        resolvedCredentials.authType === "tailscale" ||
        resolvedCredentials.authType === "warpgate"
      ) {
        // Tailscale SSH, "none", and Warpgate auth: no static credentials
      } else if (resolvedCredentials.authType === "password") {
        if (resolvedCredentials.password) {
          config.password = resolvedCredentials.password;
        }
      } else if (resolvedCredentials.authType === "opkssh") {
        try {
          const { getOPKSSHToken } = await import("../opkssh-auth.js");
          const token = await getOPKSSHToken(userId, hostId);

          if (!token) {
            connectionLogs.push(
              createConnectionLog(
                "error",
                "docker_auth",
                "OPKSSH authentication required. Please open a Terminal connection to this host first to complete browser-based authentication. Your session will be cached for 24 hours.",
              ),
            );
            return res.status(401).json({
              error:
                "OPKSSH authentication required. Please open a Terminal connection to this host first to complete browser-based authentication. Your session will be cached for 24 hours.",
              requiresOPKSSHAuth: true,
              connectionLogs,
            });
          }

          const { setupOPKSSHCertAuth } =
            await import("../opkssh-cert-auth.js");
          await setupOPKSSHCertAuth(
            config as import("ssh2").ConnectConfig,
            client,
            token,
            host.username,
          );
          connectionLogs.push(
            createConnectionLog(
              "info",
              "docker_auth",
              "Using OPKSSH certificate authentication",
            ),
          );
        } catch (opksshError) {
          sshLogger.error("OPKSSH authentication error for Docker", {
            operation: "docker_connect",
            sessionId,
            hostId,
            error:
              opksshError instanceof Error
                ? opksshError.message
                : "Unknown error",
          });
          connectionLogs.push(
            createConnectionLog(
              "error",
              "docker_auth",
              `OPKSSH authentication failed: ${opksshError instanceof Error ? opksshError.message : "Unknown error"}`,
            ),
          );
          return res.status(500).json({
            error: "OPKSSH authentication failed",
            connectionLogs,
          });
        }
      } else if (
        resolvedCredentials.authType === "key" &&
        resolvedCredentials.sshKey
      ) {
        try {
          config.privateKey = preparePrivateKeyForSSH2(
            resolvedCredentials.sshKey,
            resolvedCredentials.keyPassword,
          );
          if (resolvedCredentials.keyPassword) {
            config.passphrase = resolvedCredentials.keyPassword;
          }
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : "Invalid private key format";
          sshLogger.error("SSH key processing error", error, {
            operation: "docker_connect",
            sessionId,
            hostId,
          });
          connectionLogs.push(
            createConnectionLog(
              "error",
              "docker_auth",
              `SSH key processing error: ${message}`,
            ),
          );
          return res.status(400).json({
            error: `SSH key format error: ${message}`,
            connectionLogs,
          });
        }
      } else if (resolvedCredentials.authType === "key") {
        sshLogger.error(
          "SSH key authentication requested but no key provided",
          {
            operation: "docker_connect",
            sessionId,
            hostId,
          },
        );
        connectionLogs.push(
          createConnectionLog(
            "error",
            "docker_auth",
            "SSH key authentication requested but no key provided",
          ),
        );
        return res.status(400).json({
          error: "SSH key authentication requested but no key provided",
          connectionLogs,
        });
      } else if (resolvedCredentials.authType === "agent") {
        const result = await applyAgentAuth(
          config,
          host.terminalConfig as unknown as Record<string, unknown> | undefined,
        );
        if ("error" in result) {
          connectionLogs.push(
            createConnectionLog("error", "docker_auth", result.error),
          );
          return res.status(400).json({ error: result.error, connectionLogs });
        }
        connectionLogs.push(
          createConnectionLog(
            "info",
            "docker_auth",
            "Using SSH agent authentication",
          ),
        );
      }

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

      if (resolvedCredentials.authType === "password") {
        connectionLogs.push(
          createConnectionLog("info", "auth", "Authenticating with password"),
        );
      } else if (resolvedCredentials.authType === "key") {
        connectionLogs.push(
          createConnectionLog("info", "auth", "Authenticating with SSH key"),
        );
      } else if (resolvedCredentials.authType === "agent") {
        connectionLogs.push(
          createConnectionLog("info", "auth", "Authenticating with SSH agent"),
        );
      } else if (
        resolvedCredentials.authType === "none" ||
        resolvedCredentials.authType === "tailscale"
      ) {
        connectionLogs.push(
          createConnectionLog(
            "info",
            "auth",
            "Attempting keyboard-interactive authentication",
          ),
        );
      }

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
          (resolvedCredentials.authType === "none" ||
            resolvedCredentials.authType === "tailscale") &&
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

      client.on(
        "keyboard-interactive",
        (
          name: string,
          instructions: string,
          instructionsLang: string,
          prompts: Array<{ prompt: string; echo: boolean }>,
          finish: (responses: string[]) => void,
        ) => {
          const promptTexts = prompts.map((p) => p.prompt);

          const warpgatePattern = /warpgate\s+authentication/i;
          const isWarpgate =
            warpgatePattern.test(name) ||
            warpgatePattern.test(instructions) ||
            promptTexts.some((p) => warpgatePattern.test(p));

          if (isWarpgate) {
            const fullText = `${name}\n${instructions}\n${promptTexts.join("\n")}`;
            const urlMatch = fullText.match(/https?:\/\/[^\s\n]+/i);
            const keyMatch = fullText.match(
              /security key[:\s]+([a-z0-9](?:\s+[a-z0-9]){3}|[a-z0-9]{4})/i,
            );

            if (urlMatch) {
              if (responseSent) return;
              responseSent = true;

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
                totpPromptIndex: -1,
                resolvedPassword: resolvedCredentials.password,
                totpAttempts: 0,
                isWarpgate: true,
                containerRuntime,
              };

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
                url: urlMatch[0],
                securityKey: keyMatch ? keyMatch[1] : "N/A",
                connectionLogs,
              });
              return;
            }
          }

          const totpPromptIndex = prompts.findIndex((p) =>
            /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i.test(
              p.prompt,
            ),
          );

          if (totpPromptIndex !== -1) {
            if (responseSent) {
              const responses = prompts.map((p) => {
                if (
                  /password/i.test(p.prompt) &&
                  resolvedCredentials.password
                ) {
                  return resolvedCredentials.password;
                }
                return "";
              });
              finish(responses);
              return;
            }
            responseSent = true;

            if (pendingTOTPSessions[sessionId]) {
              const responses = prompts.map((p) => {
                if (
                  /password/i.test(p.prompt) &&
                  resolvedCredentials.password
                ) {
                  return resolvedCredentials.password;
                }
                return "";
              });
              finish(responses);
              return;
            }

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
              totpPromptIndex,
              resolvedPassword: resolvedCredentials.password,
              totpAttempts: 0,
              containerRuntime,
            };

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
              prompt: prompts[totpPromptIndex].prompt,
              connectionLogs,
            });
          } else {
            const passwordPromptIndex = prompts.findIndex((p) =>
              /password/i.test(p.prompt),
            );

            if (resolvedCredentials.authType === "warpgate") {
              finish(prompts.map(() => ""));
              return;
            }

            if (
              (resolvedCredentials.authType === "none" ||
                resolvedCredentials.authType === "tailscale") &&
              passwordPromptIndex !== -1
            ) {
              if (responseSent) return;
              responseSent = true;
              client.end();
              res.json({
                status: "auth_required",
                reason: "no_keyboard",
              });
              return;
            }

            const hasStoredPassword =
              resolvedCredentials.password &&
              resolvedCredentials.authType !== "none";

            if (!hasStoredPassword && passwordPromptIndex !== -1) {
              if (responseSent) {
                const responses = prompts.map((p) => {
                  if (
                    /password/i.test(p.prompt) &&
                    resolvedCredentials.password
                  ) {
                    return resolvedCredentials.password;
                  }
                  return "";
                });
                finish(responses);
                return;
              }
              responseSent = true;

              if (pendingTOTPSessions[sessionId]) {
                const responses = prompts.map((p) => {
                  if (
                    /password/i.test(p.prompt) &&
                    resolvedCredentials.password
                  ) {
                    return resolvedCredentials.password;
                  }
                  return "";
                });
                finish(responses);
                return;
              }

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
                totpPromptIndex: passwordPromptIndex,
                resolvedPassword: resolvedCredentials.password,
                totpAttempts: 0,
                containerRuntime,
              };

              res.json({
                requires_totp: true,
                sessionId,
                prompt: prompts[passwordPromptIndex].prompt,
                isPassword: true,
              });
              return;
            }

            const responses = prompts.map((p) => {
              if (/password/i.test(p.prompt) && resolvedCredentials.password) {
                return resolvedCredentials.password;
              }
              return "";
            });
            finish(responses);
          }
        },
      );

      const proxyConfig: SOCKS5Config | null =
        useSocks5 &&
        (socks5Host ||
          (socks5ProxyChain && (socks5ProxyChain as ProxyNode[]).length > 0))
          ? {
              useSocks5,
              socks5Host,
              socks5Port,
              socks5Username,
              socks5Password,
              socks5ProxyChain: socks5ProxyChain as ProxyNode[],
            }
          : null;

      const hasJumpHosts = host.jumpHosts && host.jumpHosts.length > 0;

      if (hasJumpHosts) {
        try {
          if (proxyConfig) {
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
              `Connecting via ${host.jumpHosts!.length} jump host(s)`,
            ),
          );
          const jumpClient = await createJumpHostChain(
            host.jumpHosts as Array<{ hostId: number }>,
            userId,
            proxyConfig,
          );

          if (!jumpClient) {
            connectionLogs.push(
              createConnectionLog(
                "error",
                "jump",
                "Failed to establish jump host chain",
              ),
            );
            return res.status(500).json({
              error: "Failed to establish jump host chain",
              connectionLogs,
            });
          }

          jumpClient.forwardOut(
            "127.0.0.1",
            0,
            host.ip,
            host.port || 22,
            (err, stream) => {
              if (err) {
                sshLogger.error("Failed to forward through jump host", err, {
                  operation: "docker_jump_forward",
                  sessionId,
                  hostId,
                });
                connectionLogs.push(
                  createConnectionLog(
                    "error",
                    "jump",
                    `Failed to forward through jump host: ${err.message}`,
                  ),
                );
                jumpClient.end();
                if (!responseSent) {
                  responseSent = true;
                  return res.status(500).json({
                    error:
                      "Failed to forward through jump host: " + err.message,
                    connectionLogs,
                  });
                }
                return;
              }

              config.sock = stream;
              client.connect(config);
            },
          );
        } catch (jumpError) {
          sshLogger.error("Jump host connection failed", jumpError, {
            operation: "docker_jump_connect",
            sessionId,
            hostId,
          });
          connectionLogs.push(
            createConnectionLog(
              "error",
              "jump",
              `Jump host connection failed: ${jumpError instanceof Error ? jumpError.message : "Unknown error"}`,
            ),
          );
          if (!responseSent) {
            responseSent = true;
            return res.status(500).json({
              error:
                "Jump host connection failed: " +
                (jumpError instanceof Error
                  ? jumpError.message
                  : "Unknown error"),
              connectionLogs,
            });
          }
          return;
        }
      } else if (proxyConfig) {
        connectionLogs.push(
          createConnectionLog("info", "proxy", "Connecting via proxy"),
        );
        try {
          const proxySocket = await createSocks5Connection(
            host.ip,
            host.port || 22,
            proxyConfig,
          );
          if (proxySocket) {
            config.sock = proxySocket;
          }
          client.connect(config);
        } catch (proxyError) {
          sshLogger.error("Proxy connection failed", proxyError, {
            operation: "docker_proxy_connect",
            sessionId,
            hostId,
          });
          connectionLogs.push(
            createConnectionLog(
              "error",
              "proxy",
              `Proxy connection failed: ${proxyError instanceof Error ? proxyError.message : "Unknown error"}`,
            ),
          );
          if (!responseSent) {
            responseSent = true;
            return res.status(500).json({
              error:
                "Proxy connection failed: " +
                (proxyError instanceof Error
                  ? proxyError.message
                  : "Unknown error"),
              connectionLogs,
            });
          }
          return;
        }
      } else {
        await resolveSshConnectConfigHost(config);
        client.connect(config);
      }
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
          `Connection error: ${error instanceof Error ? error.message : "Unknown error"}`,
        ),
      );
      res.status(500).json({
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
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
                error: error instanceof Error ? error.message : "Unknown error",
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
                error: error instanceof Error ? error.message : "Unknown error",
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
          const errorMsg =
            daemonError instanceof Error ? daemonError.message : "";

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
        error: error instanceof Error ? error.message : "Validation failed",
      });
    }
  });
}
