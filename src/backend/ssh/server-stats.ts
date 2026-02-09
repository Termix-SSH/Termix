import express from "express";
import net from "net";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Client, type ConnectConfig } from "ssh2";
import { getDb } from "../database/db/index.js";
import { sshData, sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { statsLogger, sshLogger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { AuthManager } from "../utils/auth-manager.js";
import { PermissionManager } from "../utils/permission-manager.js";
import type { AuthenticatedRequest, ProxyNode } from "../../types/index.js";
import type { LogEntry, ConnectionStage } from "../../types/connection-log.js";
import { collectCpuMetrics } from "./widgets/cpu-collector.js";
import { collectMemoryMetrics } from "./widgets/memory-collector.js";
import { collectDiskMetrics } from "./widgets/disk-collector.js";
import { collectNetworkMetrics } from "./widgets/network-collector.js";
import { collectUptimeMetrics } from "./widgets/uptime-collector.js";
import { collectProcessesMetrics } from "./widgets/processes-collector.js";
import { collectSystemMetrics } from "./widgets/system-collector.js";
import { collectLoginStats } from "./widgets/login-stats-collector.js";
import { collectPortsMetrics } from "./widgets/ports-collector.js";
import { collectFirewallMetrics } from "./widgets/firewall-collector.js";
import { createSocks5Connection } from "../utils/socks5-helper.js";
import { SSHHostKeyVerifier } from "./host-key-verifier.js";

function createConnectionLog(
  type: "info" | "success" | "warning" | "error",
  stage: ConnectionStage,
  message: string,
  details?: Record<string, any>,
): Omit<LogEntry, "id" | "timestamp"> {
  return {
    type,
    stage,
    message,
    details,
  };
}

async function resolveJumpHost(
  hostId: number,
  userId: string,
): Promise<any | null> {
  try {
    const hosts = await SimpleDBOps.select(
      getDb()
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, hostId), eq(sshData.userId, userId))),
      "ssh_data",
      userId,
    );

    if (hosts.length === 0) {
      return null;
    }

    const host = hosts[0];

    if (host.credentialId) {
      const credentials = await SimpleDBOps.select(
        getDb()
          .select()
          .from(sshCredentials)
          .where(
            and(
              eq(sshCredentials.id, host.credentialId as number),
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
          password: credential.password,
          key:
            credential.private_key || credential.privateKey || credential.key,
          keyPassword: credential.key_password || credential.keyPassword,
          keyType: credential.key_type || credential.keyType,
          authType: credential.auth_type || credential.authType,
        };
      }
    }

    return host;
  } catch (error) {
    statsLogger.error("Failed to resolve jump host", error, {
      operation: "resolve_jump_host",
      hostId,
      userId,
    });
    return null;
  }
}

async function createJumpHostChain(
  jumpHosts: Array<{ hostId: number }>,
  userId: string,
): Promise<Client | null> {
  if (!jumpHosts || jumpHosts.length === 0) {
    return null;
  }

  let currentClient: Client | null = null;
  const clients: Client[] = [];

  try {
    for (let i = 0; i < jumpHosts.length; i++) {
      const jumpHostConfig = await resolveJumpHost(jumpHosts[i].hostId, userId);

      if (!jumpHostConfig) {
        statsLogger.error(`Jump host ${i + 1} not found`, undefined, {
          operation: "jump_host_chain",
          hostId: jumpHosts[i].hostId,
        });
        clients.forEach((c) => c.end());
        return null;
      }

      const jumpClient = new Client();
      clients.push(jumpClient);

      const jumpHostVerifier = await SSHHostKeyVerifier.createHostVerifier(
        jumpHostConfig.id,
        jumpHostConfig.ip,
        jumpHostConfig.port || 22,
        null,
        userId,
        true,
      );

      const connected = await new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          resolve(false);
        }, 30000);

        jumpClient.on("ready", () => {
          clearTimeout(timeout);
          resolve(true);
        });

        jumpClient.on("error", (err) => {
          clearTimeout(timeout);
          statsLogger.error(`Jump host ${i + 1} connection failed`, err, {
            operation: "jump_host_connect",
            hostId: jumpHostConfig.id,
            ip: jumpHostConfig.ip,
          });
          resolve(false);
        });

        const connectConfig: any = {
          host: jumpHostConfig.ip,
          port: jumpHostConfig.port || 22,
          username: jumpHostConfig.username,
          tryKeyboard: true,
          readyTimeout: 30000,
          hostVerifier: jumpHostVerifier,
        };

        if (jumpHostConfig.authType === "password" && jumpHostConfig.password) {
          connectConfig.password = jumpHostConfig.password;
        } else if (jumpHostConfig.authType === "key" && jumpHostConfig.key) {
          const cleanKey = jumpHostConfig.key
            .trim()
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");
          connectConfig.privateKey = Buffer.from(cleanKey, "utf8");
          if (jumpHostConfig.keyPassword) {
            connectConfig.passphrase = jumpHostConfig.keyPassword;
          }
        }

        if (currentClient) {
          currentClient.forwardOut(
            "127.0.0.1",
            0,
            jumpHostConfig.ip,
            jumpHostConfig.port || 22,
            (err, stream) => {
              if (err) {
                clearTimeout(timeout);
                resolve(false);
                return;
              }
              connectConfig.sock = stream;
              jumpClient.connect(connectConfig);
            },
          );
        } else {
          jumpClient.connect(connectConfig);
        }
      });

      if (!connected) {
        clients.forEach((c) => c.end());
        return null;
      }

      currentClient = jumpClient;
    }

    return currentClient;
  } catch (error) {
    statsLogger.error("Failed to create jump host chain", error, {
      operation: "jump_host_chain",
    });
    clients.forEach((c) => c.end());
    return null;
  }
}

interface PooledConnection {
  client: Client;
  lastUsed: number;
  inUse: boolean;
  hostKey: string;
}

interface MetricsSession {
  client: Client;
  isConnected: boolean;
  lastActive: number;
  timeout?: NodeJS.Timeout;
  activeOperations: number;
  hostId: number;
  userId: string;
}

interface PendingTOTPSession {
  client: Client;
  finish: (responses: string[]) => void;
  config: ConnectConfig;
  createdAt: number;
  sessionId: string;
  hostId: number;
  userId: string;
  prompts?: Array<{ prompt: string; echo: boolean }>;
  totpPromptIndex?: number;
  resolvedPassword?: string;
  totpAttempts: number;
}

interface MetricsViewer {
  sessionId: string;
  userId: string;
  hostId: number;
  lastHeartbeat: number;
}

const metricsSessions: Record<string, MetricsSession> = {};
const pendingTOTPSessions: Record<string, PendingTOTPSession> = {};

function cleanupMetricsSession(sessionId: string) {
  const session = metricsSessions[sessionId];
  if (session) {
    if (session.activeOperations > 0) {
      statsLogger.warn(
        `Deferring metrics session cleanup - ${session.activeOperations} active operations`,
        {
          operation: "cleanup_deferred",
          sessionId,
          activeOperations: session.activeOperations,
        },
      );
      scheduleMetricsSessionCleanup(sessionId);
      return;
    }

    try {
      session.client.end();
    } catch (error) {}
    clearTimeout(session.timeout);
    delete metricsSessions[sessionId];
  }
}

function scheduleMetricsSessionCleanup(sessionId: string) {
  const session = metricsSessions[sessionId];
  if (session) {
    if (session.timeout) clearTimeout(session.timeout);

    session.timeout = setTimeout(
      () => {
        cleanupMetricsSession(sessionId);
      },
      30 * 60 * 1000,
    );
  }
}

function getSessionKey(hostId: number, userId: string): string {
  return `${userId}:${hostId}`;
}

class SSHConnectionPool {
  private connections = new Map<string, PooledConnection[]>();
  private maxConnectionsPerHost = 3;
  private connectionTimeout = 30000;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      2 * 60 * 1000,
    );
  }

  private getHostKey(host: SSHHostWithCredentials): string {
    const socks5Key = host.useSocks5
      ? `:socks5:${host.socks5Host}:${host.socks5Port}:${JSON.stringify(host.socks5ProxyChain || [])}`
      : "";
    return `${host.ip}:${host.port}:${host.username}${socks5Key}`;
  }

  private isConnectionHealthy(client: Client): boolean {
    try {
      const sock = (client as any)._sock;
      if (sock && (sock.destroyed || !sock.writable)) {
        return false;
      }
      return true;
    } catch (error) {
      return false;
    }
  }

  async getConnection(host: SSHHostWithCredentials): Promise<Client> {
    const hostKey = this.getHostKey(host);
    let connections = this.connections.get(hostKey) || [];

    const available = connections.find((conn) => !conn.inUse);
    if (available) {
      if (!this.isConnectionHealthy(available.client)) {
        statsLogger.warn("Removing unhealthy connection from pool", {
          operation: "remove_dead_connection",
          hostKey,
        });
        try {
          available.client.end();
        } catch (error) {
          // Ignore cleanup errors
        }
        connections = connections.filter((c) => c !== available);
        this.connections.set(hostKey, connections);
      } else {
        available.inUse = true;
        available.lastUsed = Date.now();
        return available.client;
      }
    }

    if (connections.length < this.maxConnectionsPerHost) {
      const client = await this.createConnection(host);
      const pooled: PooledConnection = {
        client,
        lastUsed: Date.now(),
        inUse: true,
        hostKey,
      };
      connections.push(pooled);
      this.connections.set(hostKey, connections);
      return client;
    }

    return new Promise((resolve) => {
      const checkAvailable = () => {
        const available = connections.find((conn) => !conn.inUse);
        if (available) {
          available.inUse = true;
          available.lastUsed = Date.now();
          resolve(available.client);
        } else {
          setTimeout(checkAvailable, 100);
        }
      };
      checkAvailable();
    });
  }

  private async createConnection(
    host: SSHHostWithCredentials,
  ): Promise<Client> {
    return new Promise(async (resolve, reject) => {
      const config = await buildSshConfig(host);
      const client = new Client();
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error("SSH connection timeout"));
      }, this.connectionTimeout);

      client.on("ready", () => {
        clearTimeout(timeout);
        resolve(client);
      });

      client.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
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
          const totpPromptIndex = prompts.findIndex((p) =>
            /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i.test(
              p.prompt,
            ),
          );

          if (totpPromptIndex !== -1) {
            const sessionId = `totp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            pendingTOTPSessions[sessionId] = {
              client,
              finish,
              config,
              createdAt: Date.now(),
              sessionId,
              hostId: host.id,
              userId: host.userId!,
              prompts: prompts.map((p) => ({
                prompt: p.prompt,
                echo: p.echo ?? false,
              })),
              totpPromptIndex,
              resolvedPassword: host.password,
              totpAttempts: 0,
            };

            return;
          } else if (host.password) {
            const responses = prompts.map((p) => {
              if (/password/i.test(p.prompt)) {
                return host.password || "";
              }
              return "";
            });
            finish(responses);
          } else {
            finish(prompts.map(() => ""));
          }
        },
      );

      try {
        if (
          host.useSocks5 &&
          (host.socks5Host ||
            (host.socks5ProxyChain && host.socks5ProxyChain.length > 0))
        ) {
          try {
            const socks5Socket = await createSocks5Connection(
              host.ip,
              host.port,
              {
                useSocks5: host.useSocks5,
                socks5Host: host.socks5Host,
                socks5Port: host.socks5Port,
                socks5Username: host.socks5Username,
                socks5Password: host.socks5Password,
                socks5ProxyChain: host.socks5ProxyChain,
              },
            );

            if (socks5Socket) {
              config.sock = socks5Socket;
              client.connect(config);
              return;
            } else {
              statsLogger.error("SOCKS5 socket is null", undefined, {
                operation: "socks5_socket_null",
                hostIp: host.ip,
              });
            }
          } catch (socks5Error) {
            clearTimeout(timeout);
            statsLogger.error("SOCKS5 connection error", socks5Error, {
              operation: "socks5_connection_error",
              hostIp: host.ip,
              errorMessage:
                socks5Error instanceof Error ? socks5Error.message : "Unknown",
            });
            reject(
              new Error(
                "SOCKS5 proxy connection failed: " +
                  (socks5Error instanceof Error
                    ? socks5Error.message
                    : "Unknown error"),
              ),
            );
            return;
          }
        }

        if (host.jumpHosts && host.jumpHosts.length > 0 && host.userId) {
          const jumpClient = await createJumpHostChain(
            host.jumpHosts,
            host.userId,
          );

          if (!jumpClient) {
            clearTimeout(timeout);
            reject(new Error("Failed to establish jump host chain"));
            return;
          }

          jumpClient.forwardOut(
            "127.0.0.1",
            0,
            host.ip,
            host.port,
            (err, stream) => {
              if (err) {
                clearTimeout(timeout);
                jumpClient.end();
                reject(
                  new Error(
                    "Failed to forward through jump host: " + err.message,
                  ),
                );
                return;
              }

              config.sock = stream;
              client.connect(config);
            },
          );
        } else {
          client.connect(config);
        }
      } catch (err) {
        clearTimeout(timeout);
        reject(err);
      }
    });
  }

  releaseConnection(host: SSHHostWithCredentials, client: Client): void {
    const hostKey = this.getHostKey(host);
    const connections = this.connections.get(hostKey) || [];
    const pooled = connections.find((conn) => conn.client === client);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
    }
  }

  clearHostConnections(host: SSHHostWithCredentials): void {
    const hostKey = this.getHostKey(host);
    const connections = this.connections.get(hostKey) || [];

    for (const conn of connections) {
      try {
        conn.client.end();
      } catch (error) {
        statsLogger.error("Error closing connection during cleanup", error, {
          operation: "clear_connection_error",
        });
      }
    }

    this.connections.delete(hostKey);
  }

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;
    let totalCleaned = 0;
    let totalUnhealthy = 0;

    for (const [hostKey, connections] of this.connections.entries()) {
      const activeConnections = connections.filter((conn) => {
        if (!conn.inUse && now - conn.lastUsed > maxAge) {
          try {
            conn.client.end();
          } catch (error) {}
          totalCleaned++;
          return false;
        }
        if (!this.isConnectionHealthy(conn.client)) {
          statsLogger.warn("Removing unhealthy connection during cleanup", {
            operation: "cleanup_unhealthy",
            hostKey,
            inUse: conn.inUse,
          });
          try {
            conn.client.end();
          } catch (error) {}
          totalUnhealthy++;
          return false;
        }
        return true;
      });

      if (activeConnections.length === 0) {
        this.connections.delete(hostKey);
      } else {
        this.connections.set(hostKey, activeConnections);
      }
    }
  }

  clearAllConnections(): void {
    for (const [hostKey, connections] of this.connections.entries()) {
      for (const conn of connections) {
        try {
          conn.client.end();
        } catch (error) {
          statsLogger.error(
            "Error closing connection during full cleanup",
            error,
            {
              operation: "clear_all_error",
              hostKey,
            },
          );
        }
      }
    }
    this.connections.clear();
  }

  destroy(): void {
    clearInterval(this.cleanupInterval);
    for (const connections of this.connections.values()) {
      for (const conn of connections) {
        try {
          conn.client.end();
        } catch (error) {}
      }
    }
    this.connections.clear();
  }
}

class RequestQueue {
  private queues = new Map<number, Array<() => Promise<unknown>>>();
  private processing = new Set<number>();
  private requestTimeout = 60000;

  async queueRequest<T>(hostId: number, request: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const wrappedRequest = async () => {
        try {
          const result = await Promise.race<T>([
            request(),
            new Promise<never>((_, rej) =>
              setTimeout(
                () =>
                  rej(
                    new Error(
                      `Request timeout after ${this.requestTimeout}ms for host ${hostId}`,
                    ),
                  ),
                this.requestTimeout,
              ),
            ),
          ]);
          resolve(result);
        } catch (error) {
          reject(error);
        }
      };

      const queue = this.queues.get(hostId) || [];
      queue.push(wrappedRequest);
      this.queues.set(hostId, queue);
      this.processQueue(hostId);
    });
  }

  private async processQueue(hostId: number): Promise<void> {
    if (this.processing.has(hostId)) return;

    this.processing.add(hostId);
    const queue = this.queues.get(hostId) || [];

    while (queue.length > 0) {
      const request = queue.shift();
      if (request) {
        try {
          await request();
        } catch (error) {}
      }
    }

    this.processing.delete(hostId);
    const currentQueue = this.queues.get(hostId);
    if (currentQueue && currentQueue.length > 0) {
      this.processQueue(hostId);
    }
  }
}

interface CachedMetrics {
  data: unknown;
  timestamp: number;
  hostId: number;
}

class MetricsCache {
  private cache = new Map<number, CachedMetrics>();
  private ttl = 30000;

  get(hostId: number): unknown | null {
    const cached = this.cache.get(hostId);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }
    return null;
  }

  set(hostId: number, data: unknown): void {
    this.cache.set(hostId, {
      data,
      timestamp: Date.now(),
      hostId,
    });
  }

  clear(hostId?: number): void {
    if (hostId) {
      this.cache.delete(hostId);
    } else {
      this.cache.clear();
    }
  }
}

interface AuthFailureRecord {
  count: number;
  lastFailure: number;
  reason: "TOTP" | "AUTH" | "TIMEOUT";
  permanent: boolean;
}

class AuthFailureTracker {
  private failures = new Map<number, AuthFailureRecord>();
  private maxRetries = 3;
  private backoffBase = 5000;

  recordFailure(
    hostId: number,
    reason: "TOTP" | "AUTH" | "TIMEOUT",
    permanent = false,
  ): void {
    const existing = this.failures.get(hostId);
    if (existing) {
      existing.count++;
      existing.lastFailure = Date.now();
      existing.reason = reason;
      if (permanent) existing.permanent = true;
    } else {
      this.failures.set(hostId, {
        count: 1,
        lastFailure: Date.now(),
        reason,
        permanent,
      });
    }
  }

  shouldSkip(hostId: number): boolean {
    const record = this.failures.get(hostId);
    if (!record) return false;

    if (record.reason === "TOTP" || record.permanent) {
      return true;
    }

    if (record.count >= this.maxRetries) {
      return true;
    }

    const backoffTime = this.backoffBase * Math.pow(2, record.count - 1);
    const timeSinceFailure = Date.now() - record.lastFailure;

    return timeSinceFailure < backoffTime;
  }

  getSkipReason(hostId: number): string | null {
    const record = this.failures.get(hostId);
    if (!record) return null;

    if (record.reason === "TOTP") {
      return "TOTP authentication required (metrics unavailable)";
    }

    if (record.permanent) {
      return "Authentication permanently failed";
    }

    if (record.count >= this.maxRetries) {
      return `Too many authentication failures (${record.count} attempts)`;
    }

    const backoffTime = this.backoffBase * Math.pow(2, record.count - 1);
    const timeSinceFailure = Date.now() - record.lastFailure;
    const remainingTime = Math.ceil((backoffTime - timeSinceFailure) / 1000);

    if (timeSinceFailure < backoffTime) {
      return `Retry in ${remainingTime}s (attempt ${record.count}/${this.maxRetries})`;
    }

    return null;
  }

  reset(hostId: number): void {
    this.failures.delete(hostId);
  }

  cleanup(): void {
    const maxAge = 60 * 60 * 1000;
    const now = Date.now();

    for (const [hostId, record] of this.failures.entries()) {
      if (!record.permanent && now - record.lastFailure > maxAge) {
        this.failures.delete(hostId);
      }
    }
  }
}

class PollingBackoff {
  private failures = new Map<number, { count: number; nextRetry: number }>();
  private baseDelay = 30000;
  private maxDelay = 600000;
  private maxRetries = 5;

  recordFailure(hostId: number): void {
    const existing = this.failures.get(hostId) || { count: 0, nextRetry: 0 };
    const delay = Math.min(
      this.baseDelay * Math.pow(2, existing.count),
      this.maxDelay,
    );
    this.failures.set(hostId, {
      count: existing.count + 1,
      nextRetry: Date.now() + delay,
    });
  }

  shouldSkip(hostId: number): boolean {
    const backoff = this.failures.get(hostId);
    if (!backoff) return false;

    if (backoff.count >= this.maxRetries) {
      return true;
    }

    return Date.now() < backoff.nextRetry;
  }

  getBackoffInfo(hostId: number): string | null {
    const backoff = this.failures.get(hostId);
    if (!backoff) return null;

    if (backoff.count >= this.maxRetries) {
      return `Max retries exceeded (${backoff.count} failures) - polling suspended`;
    }

    const remainingMs = backoff.nextRetry - Date.now();
    if (remainingMs > 0) {
      const remainingSec = Math.ceil(remainingMs / 1000);
      return `Retry in ${remainingSec}s (attempt ${backoff.count}/${this.maxRetries})`;
    }

    return null;
  }

  reset(hostId: number): void {
    this.failures.delete(hostId);
  }

  cleanup(): void {
    const maxAge = 60 * 60 * 1000;
    const now = Date.now();

    for (const [hostId, backoff] of this.failures.entries()) {
      if (backoff.count < this.maxRetries && now - backoff.nextRetry > maxAge) {
        this.failures.delete(hostId);
      }
    }
  }
}

const connectionPool = new SSHConnectionPool();
const requestQueue = new RequestQueue();
const metricsCache = new MetricsCache();
const authFailureTracker = new AuthFailureTracker();
const pollingBackoff = new PollingBackoff();
const authManager = AuthManager.getInstance();
const permissionManager = PermissionManager.getInstance();

type HostStatus = "online" | "offline";

interface SSHHostWithCredentials {
  id: number;
  name: string;
  ip: string;
  port: number;
  username: string;
  folder: string;
  tags: string[];
  pin: boolean;
  authType: string;
  password?: string;
  key?: string;
  keyPassword?: string;
  keyType?: string;
  credentialId?: number;
  enableTerminal: boolean;
  enableTunnel: boolean;
  enableFileManager: boolean;
  defaultPath: string;
  tunnelConnections: unknown[];
  jumpHosts?: Array<{ hostId: number }>;
  statsConfig?: string | StatsConfig;
  createdAt: string;
  updatedAt: string;
  userId: string;

  useSocks5?: boolean;
  socks5Host?: string;
  socks5Port?: number;
  socks5Username?: string;
  socks5Password?: string;
  socks5ProxyChain?: ProxyNode[];
}

type StatusEntry = {
  status: HostStatus;
  lastChecked: string;
};

interface StatsConfig {
  enabledWidgets: string[];
  statusCheckEnabled: boolean;
  statusCheckInterval: number;
  metricsEnabled: boolean;
  metricsInterval: number;
}

const DEFAULT_STATS_CONFIG: StatsConfig = {
  enabledWidgets: ["cpu", "memory", "disk", "network", "uptime", "system"],
  statusCheckEnabled: true,
  statusCheckInterval: 30,
  metricsEnabled: true,
  metricsInterval: 30,
};

interface HostPollingConfig {
  host: SSHHostWithCredentials;
  statsConfig: StatsConfig;
  statusTimer?: NodeJS.Timeout;
  metricsTimer?: NodeJS.Timeout;
  viewerUserId?: string;
}

class PollingManager {
  private pollingConfigs = new Map<number, HostPollingConfig>();
  private statusStore = new Map<number, StatusEntry>();
  private metricsStore = new Map<
    number,
    {
      data: Awaited<ReturnType<typeof collectMetrics>>;
      timestamp: number;
    }
  >();
  private activeViewers = new Map<number, Set<string>>();
  private viewerDetails = new Map<string, MetricsViewer>();
  private viewerCleanupInterval: NodeJS.Timeout;

  constructor() {
    this.viewerCleanupInterval = setInterval(() => {
      this.cleanupInactiveViewers();
    }, 60000);
  }

  parseStatsConfig(statsConfigStr?: string | StatsConfig): StatsConfig {
    if (!statsConfigStr) {
      return DEFAULT_STATS_CONFIG;
    }

    let parsed: StatsConfig;

    if (typeof statsConfigStr === "object") {
      parsed = statsConfigStr;
    } else {
      try {
        let temp: any = JSON.parse(statsConfigStr);

        if (typeof temp === "string") {
          temp = JSON.parse(temp);
        }

        parsed = temp;
      } catch (error) {
        statsLogger.warn(
          `Failed to parse statsConfig: ${error instanceof Error ? error.message : "Unknown error"}`,
          {
            operation: "parse_stats_config_error",
            statsConfigStr,
          },
        );
        return DEFAULT_STATS_CONFIG;
      }
    }

    const result = { ...DEFAULT_STATS_CONFIG, ...parsed };

    return result;
  }

  async startPollingForHost(
    host: SSHHostWithCredentials,
    options?: { statusOnly?: boolean; viewerUserId?: string },
  ): Promise<void> {
    const statsConfig = this.parseStatsConfig(host.statsConfig);
    const statusOnly = options?.statusOnly ?? false;
    const viewerUserId = options?.viewerUserId;

    const enabledCollectors: string[] = [];
    if (statsConfig.statusCheckEnabled) enabledCollectors.push("status");
    if (!statusOnly && statsConfig.metricsEnabled) {
      enabledCollectors.push(
        "cpu",
        "memory",
        "disk",
        "network",
        "uptime",
        "processes",
        "system",
      );
    }

    const existingConfig = this.pollingConfigs.get(host.id);

    if (existingConfig) {
      if (existingConfig.statusTimer) {
        clearInterval(existingConfig.statusTimer);
        existingConfig.statusTimer = undefined;
      }
      if (existingConfig.metricsTimer) {
        clearInterval(existingConfig.metricsTimer);
        existingConfig.metricsTimer = undefined;
      }
    }

    if (!statsConfig.statusCheckEnabled && !statsConfig.metricsEnabled) {
      this.pollingConfigs.delete(host.id);
      this.statusStore.delete(host.id);
      this.metricsStore.delete(host.id);
      return;
    }

    const config: HostPollingConfig = {
      host,
      statsConfig,
      viewerUserId,
    };

    if (statsConfig.statusCheckEnabled) {
      const intervalMs = statsConfig.statusCheckInterval * 1000;

      this.pollHostStatus(host, viewerUserId);

      config.statusTimer = setInterval(() => {
        const latestConfig = this.pollingConfigs.get(host.id);
        if (latestConfig && latestConfig.statsConfig.statusCheckEnabled) {
          this.pollHostStatus(latestConfig.host, latestConfig.viewerUserId);
        }
      }, intervalMs);
    } else {
      this.statusStore.delete(host.id);
    }

    if (!statusOnly && statsConfig.metricsEnabled) {
      const intervalMs = statsConfig.metricsInterval * 1000;

      await this.pollHostMetrics(host, viewerUserId);

      config.metricsTimer = setInterval(() => {
        const latestConfig = this.pollingConfigs.get(host.id);
        if (latestConfig && latestConfig.statsConfig.metricsEnabled) {
          this.pollHostMetrics(latestConfig.host, latestConfig.viewerUserId);
        }
      }, intervalMs);
    } else {
      this.metricsStore.delete(host.id);
    }

    this.pollingConfigs.set(host.id, config);
  }

  private async pollHostStatus(
    host: SSHHostWithCredentials,
    viewerUserId?: string,
  ): Promise<void> {
    const userId = viewerUserId || host.userId;
    const refreshedHost = await fetchHostById(host.id, userId);
    if (!refreshedHost) {
      return;
    }

    try {
      const isOnline = await tcpPing(
        refreshedHost.ip,
        refreshedHost.port,
        5000,
      );
      const statusEntry: StatusEntry = {
        status: isOnline ? "online" : "offline",
        lastChecked: new Date().toISOString(),
      };
      this.statusStore.set(refreshedHost.id, statusEntry);
    } catch (error) {
      const statusEntry: StatusEntry = {
        status: "offline",
        lastChecked: new Date().toISOString(),
      };
      this.statusStore.set(refreshedHost.id, statusEntry);
    }
  }

  private async pollHostMetrics(
    host: SSHHostWithCredentials,
    viewerUserId?: string,
  ): Promise<void> {
    const userId = viewerUserId || host.userId;
    const refreshedHost = await fetchHostById(host.id, userId);
    if (!refreshedHost) {
      return;
    }

    const config = this.pollingConfigs.get(refreshedHost.id);
    if (!config || !config.statsConfig.metricsEnabled) {
      return;
    }

    const hasExistingMetrics = this.metricsStore.has(refreshedHost.id);

    if (hasExistingMetrics && pollingBackoff.shouldSkip(host.id)) {
      const backoffInfo = pollingBackoff.getBackoffInfo(host.id);
      return;
    }

    try {
      const metrics = await collectMetrics(refreshedHost);
      this.metricsStore.set(refreshedHost.id, {
        data: metrics,
        timestamp: Date.now(),
      });
      pollingBackoff.reset(refreshedHost.id);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      pollingBackoff.recordFailure(refreshedHost.id);

      const latestConfig = this.pollingConfigs.get(refreshedHost.id);
      if (latestConfig && latestConfig.statsConfig.metricsEnabled) {
        const backoffInfo = pollingBackoff.getBackoffInfo(refreshedHost.id);
        statsLogger.error("Stats collector connection failed", error, {
          operation: "stats_connect_failed",
          hostId: refreshedHost.id,
          retryInfo: backoffInfo,
        });
      }
    }
  }

  stopPollingForHost(hostId: number, clearData = true): void {
    const config = this.pollingConfigs.get(hostId);
    if (config) {
      if (config.statusTimer) {
        clearInterval(config.statusTimer);
        config.statusTimer = undefined;
      }
      if (config.metricsTimer) {
        clearInterval(config.metricsTimer);
        config.metricsTimer = undefined;
      }

      this.pollingConfigs.delete(hostId);
      if (clearData) {
        this.statusStore.delete(hostId);
        this.metricsStore.delete(hostId);
      }
    }
  }

  stopMetricsOnly(hostId: number): void {
    const config = this.pollingConfigs.get(hostId);
    if (config?.metricsTimer) {
      clearInterval(config.metricsTimer);
      config.metricsTimer = undefined;
    }
  }

  getStatus(hostId: number): StatusEntry | undefined {
    return this.statusStore.get(hostId);
  }

  getAllStatuses(): Map<number, StatusEntry> {
    return this.statusStore;
  }

  getMetrics(
    hostId: number,
  ):
    | { data: Awaited<ReturnType<typeof collectMetrics>>; timestamp: number }
    | undefined {
    return this.metricsStore.get(hostId);
  }

  async initializePolling(userId: string): Promise<void> {
    const hosts = await fetchAllHosts(userId);

    for (const host of hosts) {
      await this.startPollingForHost(host, { statusOnly: true });
    }
  }

  async refreshHostPolling(userId: string): Promise<void> {
    const hosts = await fetchAllHosts(userId);
    const currentHostIds = new Set(hosts.map((h) => h.id));

    for (const hostId of this.pollingConfigs.keys()) {
      this.stopPollingForHost(hostId, false);
    }

    for (const hostId of this.statusStore.keys()) {
      if (!currentHostIds.has(hostId)) {
        this.statusStore.delete(hostId);
        this.metricsStore.delete(hostId);
      }
    }

    for (const host of hosts) {
      await this.startPollingForHost(host, { statusOnly: true });
    }
  }

  registerViewer(hostId: number, sessionId: string, userId: string): void {
    if (!this.activeViewers.has(hostId)) {
      this.activeViewers.set(hostId, new Set());
    }
    this.activeViewers.get(hostId)!.add(sessionId);

    this.viewerDetails.set(sessionId, {
      sessionId,
      userId,
      hostId,
      lastHeartbeat: Date.now(),
    });

    if (this.activeViewers.get(hostId)!.size === 1) {
      this.startMetricsForHost(hostId, userId);
    }
  }

  updateHeartbeat(sessionId: string): boolean {
    const viewer = this.viewerDetails.get(sessionId);
    if (viewer) {
      viewer.lastHeartbeat = Date.now();
      return true;
    }
    return false;
  }

  unregisterViewer(hostId: number, sessionId: string): void {
    const viewers = this.activeViewers.get(hostId);
    if (viewers) {
      viewers.delete(sessionId);

      if (viewers.size === 0) {
        this.activeViewers.delete(hostId);
        this.stopMetricsForHost(hostId);
      }
    }
    this.viewerDetails.delete(sessionId);
  }

  private async startMetricsForHost(
    hostId: number,
    userId: string,
  ): Promise<void> {
    try {
      const host = await fetchHostById(hostId, userId);
      if (host) {
        await this.startPollingForHost(host, { viewerUserId: userId });
      }
    } catch (error) {
      statsLogger.error("Failed to start metrics polling", {
        operation: "start_metrics_error",
        hostId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private stopMetricsForHost(hostId: number): void {
    this.stopMetricsOnly(hostId);
  }

  private cleanupInactiveViewers(): void {
    const now = Date.now();
    const maxInactivity = 120000;

    for (const [sessionId, viewer] of this.viewerDetails.entries()) {
      if (now - viewer.lastHeartbeat > maxInactivity) {
        this.unregisterViewer(viewer.hostId, sessionId);
      }
    }
  }

  destroy(): void {
    clearInterval(this.viewerCleanupInterval);
    for (const hostId of this.pollingConfigs.keys()) {
      this.stopPollingForHost(hostId);
    }
  }
}

const pollingManager = new PollingManager();

function validateHostId(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
) {
  const id = Number(req.params.id);
  if (!id || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Invalid host ID" });
  }
  next();
}

const app = express();
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);

      const allowedOrigins = ["http://localhost:5173", "http://127.0.0.1:5173"];

      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      if (origin.startsWith("https://")) {
        return callback(null, true);
      }

      if (origin.startsWith("http://")) {
        return callback(null, true);
      }

      callback(new Error("Not allowed by CORS"));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "User-Agent",
      "X-Electron-App",
    ],
  }),
);
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.use(authManager.createAuthMiddleware());

async function fetchAllHosts(
  userId: string,
): Promise<SSHHostWithCredentials[]> {
  try {
    const hosts = await SimpleDBOps.select(
      getDb().select().from(sshData).where(eq(sshData.userId, userId)),
      "ssh_data",
      userId,
    );

    const hostsWithCredentials: SSHHostWithCredentials[] = [];
    for (const host of hosts) {
      try {
        const hostWithCreds = await resolveHostCredentials(host, userId);
        if (hostWithCreds) {
          hostsWithCredentials.push(hostWithCreds);
        }
      } catch (err) {
        statsLogger.warn(
          `Failed to resolve credentials for host ${host.id}: ${err instanceof Error ? err.message : "Unknown error"}`,
        );
      }
    }

    return hostsWithCredentials.filter((h) => !!h.id && !!h.ip && !!h.port);
  } catch (err) {
    statsLogger.error("Failed to fetch hosts from database", err);
    return [];
  }
}

async function fetchHostById(
  id: number,
  userId: string,
): Promise<SSHHostWithCredentials | undefined> {
  try {
    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      return undefined;
    }

    const accessInfo = await permissionManager.canAccessHost(
      userId,
      id,
      "read",
    );

    if (!accessInfo.hasAccess) {
      statsLogger.warn(`User ${userId} cannot access host ${id}`, {
        operation: "fetch_host_access_denied",
        userId,
        hostId: id,
      });
      return undefined;
    }

    const hosts = await SimpleDBOps.select(
      getDb().select().from(sshData).where(eq(sshData.id, id)),
      "ssh_data",
      userId,
    );

    if (hosts.length === 0) {
      return undefined;
    }

    const host = hosts[0];
    return await resolveHostCredentials(host, userId);
  } catch (err) {
    statsLogger.error(`Failed to fetch host ${id}`, err);
    return undefined;
  }
}

async function resolveHostCredentials(
  host: Record<string, unknown>,
  userId: string,
): Promise<SSHHostWithCredentials | undefined> {
  try {
    const baseHost: Record<string, unknown> = {
      id: host.id,
      name: host.name,
      ip: host.ip,
      port: host.port,
      username: host.username,
      folder: host.folder || "",
      tags:
        typeof host.tags === "string"
          ? host.tags
            ? host.tags.split(",").filter(Boolean)
            : []
          : [],
      pin: !!host.pin,
      authType: host.authType,
      enableTerminal: !!host.enableTerminal,
      enableTunnel: !!host.enableTunnel,
      enableFileManager: !!host.enableFileManager,
      defaultPath: host.defaultPath || "/",
      tunnelConnections: host.tunnelConnections
        ? JSON.parse(host.tunnelConnections as string)
        : [],
      jumpHosts: host.jumpHosts ? JSON.parse(host.jumpHosts as string) : [],
      statsConfig: host.statsConfig || undefined,
      createdAt: host.createdAt,
      updatedAt: host.updatedAt,
      userId: host.userId,
      useSocks5: !!host.useSocks5,
      socks5Host: host.socks5Host || undefined,
      socks5Port: host.socks5Port || undefined,
      socks5Username: host.socks5Username || undefined,
      socks5Password: host.socks5Password || undefined,
      socks5ProxyChain: host.socks5ProxyChain
        ? JSON.parse(host.socks5ProxyChain as string)
        : undefined,
    };

    if (host.credentialId) {
      try {
        const ownerId = host.userId;
        const isSharedHost = userId !== ownerId;

        if (isSharedHost) {
          const { SharedCredentialManager } =
            await import("../utils/shared-credential-manager.js");
          const sharedCredManager = SharedCredentialManager.getInstance();
          const sharedCred = await sharedCredManager.getSharedCredentialForUser(
            host.id as number,
            userId,
          );

          baseHost.credentialId = host.credentialId;
          baseHost.authType = sharedCred.authType;

          if (!host.overrideCredentialUsername) {
            baseHost.username = sharedCred.username;
          }

          if (sharedCred.password) {
            baseHost.password = sharedCred.password;
          }
          if (sharedCred.key) {
            baseHost.key = sharedCred.key;
          }
          if (sharedCred.keyPassword) {
            baseHost.keyPassword = sharedCred.keyPassword;
          }
          if (sharedCred.keyType) {
            baseHost.keyType = sharedCred.keyType;
          }
        } else {
          const credentials = await SimpleDBOps.select(
            getDb()
              .select()
              .from(sshCredentials)
              .where(eq(sshCredentials.id, host.credentialId as number)),
            "ssh_credentials",
            userId,
          );

          if (credentials.length > 0) {
            const credential = credentials[0];
            baseHost.credentialId = credential.id;
            baseHost.authType = credential.auth_type || credential.authType;

            if (!host.overrideCredentialUsername) {
              baseHost.username = credential.username;
            }

            if (credential.password) {
              baseHost.password = credential.password;
            }
            if (credential.key) {
              baseHost.key = credential.key;
            }
            if (credential.key_password || credential.keyPassword) {
              baseHost.keyPassword =
                credential.key_password || credential.keyPassword;
            }
            if (credential.key_type || credential.keyType) {
              baseHost.keyType = credential.key_type || credential.keyType;
            }
          } else {
            addLegacyCredentials(baseHost, host);
          }
        }
      } catch (error) {
        statsLogger.warn(
          `Failed to resolve credential ${host.credentialId} for host ${host.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        addLegacyCredentials(baseHost, host);
      }
    } else {
      addLegacyCredentials(baseHost, host);
    }

    return baseHost as unknown as SSHHostWithCredentials;
  } catch (error) {
    statsLogger.error(
      `Failed to resolve host credentials for host ${host.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return undefined;
  }
}

function addLegacyCredentials(
  baseHost: Record<string, unknown>,
  host: Record<string, unknown>,
): void {
  baseHost.password = host.password || null;
  baseHost.key = host.key || null;
  baseHost.keyPassword = host.key_password || host.keyPassword || null;
  baseHost.keyType = host.keyType;
}

async function buildSshConfig(
  host: SSHHostWithCredentials,
): Promise<ConnectConfig> {
  const base: ConnectConfig = {
    host: host.ip,
    port: host.port,
    username: host.username,
    tryKeyboard: true,
    keepaliveInterval: 30000,
    keepaliveCountMax: 3,
    readyTimeout: 60000,
    tcpKeepAlive: true,
    tcpKeepAliveInitialDelay: 30000,
    hostVerifier: await SSHHostKeyVerifier.createHostVerifier(
      host.id,
      host.ip,
      host.port,
      null,
      host.userId || "",
      false,
    ),
    env: {
      TERM: "xterm-256color",
      LANG: "en_US.UTF-8",
      LC_ALL: "en_US.UTF-8",
      LC_CTYPE: "en_US.UTF-8",
      LC_MESSAGES: "en_US.UTF-8",
      LC_MONETARY: "en_US.UTF-8",
      LC_NUMERIC: "en_US.UTF-8",
      LC_TIME: "en_US.UTF-8",
      LC_COLLATE: "en_US.UTF-8",
      COLORTERM: "truecolor",
    },
    algorithms: {
      kex: [
        "curve25519-sha256",
        "curve25519-sha256@libssh.org",
        "ecdh-sha2-nistp521",
        "ecdh-sha2-nistp384",
        "ecdh-sha2-nistp256",
        "diffie-hellman-group-exchange-sha256",
        "diffie-hellman-group14-sha256",
        "diffie-hellman-group14-sha1",
        "diffie-hellman-group-exchange-sha1",
        "diffie-hellman-group1-sha1",
      ],
      serverHostKey: [
        "ssh-ed25519",
        "ecdsa-sha2-nistp521",
        "ecdsa-sha2-nistp384",
        "ecdsa-sha2-nistp256",
        "rsa-sha2-512",
        "rsa-sha2-256",
        "ssh-rsa",
        "ssh-dss",
      ],
      cipher: [
        "chacha20-poly1305@openssh.com",
        "aes256-gcm@openssh.com",
        "aes128-gcm@openssh.com",
        "aes256-ctr",
        "aes192-ctr",
        "aes128-ctr",
        "aes256-cbc",
        "aes192-cbc",
        "aes128-cbc",
        "3des-cbc",
      ],
      hmac: [
        "hmac-sha2-512-etm@openssh.com",
        "hmac-sha2-256-etm@openssh.com",
        "hmac-sha2-512",
        "hmac-sha2-256",
        "hmac-sha1",
        "hmac-md5",
      ],
      compress: ["none", "zlib@openssh.com", "zlib"],
    },
  } as ConnectConfig;

  if (host.authType === "password") {
    if (!host.password) {
      throw new Error(`No password available for host ${host.ip}`);
    }
    base.password = host.password;
  } else if (host.authType === "key") {
    if (!host.key) {
      throw new Error(`No SSH key available for host ${host.ip}`);
    }

    try {
      if (!host.key.includes("-----BEGIN") || !host.key.includes("-----END")) {
        throw new Error("Invalid private key format");
      }

      const cleanKey = host.key
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

      (base as Record<string, unknown>).privateKey = Buffer.from(
        cleanKey,
        "utf8",
      );

      if (host.keyPassword) {
        (base as Record<string, unknown>).passphrase = host.keyPassword;
      }
    } catch (keyError) {
      statsLogger.error(
        `SSH key format error for host ${host.ip}: ${keyError instanceof Error ? keyError.message : "Unknown error"}`,
      );
      throw new Error(`Invalid SSH key format for host ${host.ip}`);
    }
  } else if (host.authType === "none") {
  } else if (host.authType === "opkssh") {
  } else {
    throw new Error(
      `Unsupported authentication type '${host.authType}' for host ${host.ip}`,
    );
  }

  return base;
}

async function withSshConnection<T>(
  host: SSHHostWithCredentials,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connectionPool.getConnection(host);

  try {
    const result = await fn(client);
    return result;
  } finally {
    connectionPool.releaseConnection(host, client);
  }
}

async function collectMetrics(host: SSHHostWithCredentials): Promise<{
  cpu: {
    percent: number | null;
    cores: number | null;
    load: [number, number, number] | null;
  };
  memory: {
    percent: number | null;
    usedGiB: number | null;
    totalGiB: number | null;
  };
  disk: {
    percent: number | null;
    usedHuman: string | null;
    totalHuman: string | null;
    availableHuman: string | null;
  };
  network: {
    interfaces: Array<{
      name: string;
      ip: string;
      state: string;
      rxBytes: string | null;
      txBytes: string | null;
    }>;
  };
  uptime: {
    seconds: number | null;
    formatted: string | null;
  };
  processes: {
    total: number | null;
    running: number | null;
    top: Array<{
      pid: string;
      user: string;
      cpu: string;
      mem: string;
      command: string;
    }>;
  };
  system: {
    hostname: string | null;
    kernel: string | null;
    os: string | null;
  };
}> {
  if (authFailureTracker.shouldSkip(host.id)) {
    const reason = authFailureTracker.getSkipReason(host.id);
    throw new Error(reason || "Authentication failed");
  }

  const cached = metricsCache.get(host.id);
  if (cached) {
    return cached as ReturnType<typeof collectMetrics> extends Promise<infer T>
      ? T
      : never;
  }

  return requestQueue.queueRequest(host.id, async () => {
    const sessionKey = getSessionKey(host.id, host.userId!);
    const existingSession = metricsSessions[sessionKey];

    try {
      const collectFn = async (client: Client) => {
        const cpu = await collectCpuMetrics(client);
        const memory = await collectMemoryMetrics(client);
        const disk = await collectDiskMetrics(client);
        const network = await collectNetworkMetrics(client);
        const uptime = await collectUptimeMetrics(client);
        const processes = await collectProcessesMetrics(client);
        const system = await collectSystemMetrics(client);

        let login_stats = {
          recentLogins: [],
          failedLogins: [],
          totalLogins: 0,
          uniqueIPs: 0,
        };
        try {
          login_stats = await collectLoginStats(client);
        } catch (e) {}

        let ports: {
          source: "ss" | "netstat" | "none";
          ports: Array<{
            protocol: "tcp" | "udp";
            localAddress: string;
            localPort: number;
            state?: string;
            pid?: number;
            process?: string;
          }>;
        } = {
          source: "none",
          ports: [],
        };
        try {
          ports = await collectPortsMetrics(client);
        } catch (e) {}

        let firewall: {
          type: "iptables" | "nftables" | "none";
          status: "active" | "inactive" | "unknown";
          chains: Array<{
            name: string;
            policy: string;
            rules: Array<{
              chain: string;
              target: string;
              protocol: string;
              source: string;
              destination: string;
              dport?: string;
              sport?: string;
              state?: string;
              interface?: string;
              extra?: string;
            }>;
          }>;
        } = {
          type: "none",
          status: "unknown",
          chains: [],
        };
        try {
          firewall = await collectFirewallMetrics(client);
        } catch (e) {}

        const result = {
          cpu,
          memory,
          disk,
          network,
          uptime,
          processes,
          system,
          login_stats,
          ports,
          firewall,
        };

        metricsCache.set(host.id, result);
        return result;
      };

      if (existingSession && existingSession.isConnected) {
        existingSession.activeOperations++;
        try {
          const result = await collectFn(existingSession.client);
          existingSession.lastActive = Date.now();
          return result;
        } finally {
          existingSession.activeOperations--;
        }
      } else {
        return await withSshConnection(host, collectFn);
      }
    } catch (error) {
      if (error instanceof Error) {
        if (error.message.includes("TOTP authentication required")) {
          throw error;
        } else if (
          error.message.includes("No password available") ||
          error.message.includes("Unsupported authentication type") ||
          error.message.includes("No SSH key available")
        ) {
          authFailureTracker.recordFailure(host.id, "AUTH", true);
        } else if (
          error.message.includes("authentication") ||
          error.message.includes("Permission denied") ||
          error.message.includes("All configured authentication methods failed")
        ) {
          authFailureTracker.recordFailure(host.id, "AUTH");
        } else if (
          error.message.includes("timeout") ||
          error.message.includes("ETIMEDOUT")
        ) {
          authFailureTracker.recordFailure(host.id, "TIMEOUT");
        }
      }
      throw error;
    }
  });
}

function tcpPing(
  host: string,
  port: number,
  timeoutMs = 5000,
): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const onDone = (result: boolean) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch (error) {}
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => onDone(true));
    socket.once("timeout", () => onDone(false));
    socket.once("error", () => onDone(false));
    socket.connect(port, host);
  });
}

/**
 * @openapi
 * /status:
 *   get:
 *     summary: Get all host statuses
 *     description: Retrieves the status of all hosts for the authenticated user.
 *     tags:
 *       - Server Stats
 *     responses:
 *       200:
 *         description: A map of host IDs to their status entries.
 *       401:
 *         description: Session expired - please log in again.
 */
app.get("/status", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  const statuses = pollingManager.getAllStatuses();
  if (statuses.size === 0) {
    await pollingManager.initializePolling(userId);
  }

  const result: Record<number, StatusEntry> = {};
  for (const [id, entry] of pollingManager.getAllStatuses().entries()) {
    result[id] = entry;
  }
  res.json(result);
});

/**
 * @openapi
 * /status/{id}:
 *   get:
 *     summary: Get host status by ID
 *     description: Retrieves the status of a specific host by its ID.
 *     tags:
 *       - Server Stats
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Host status entry.
 *       401:
 *         description: Session expired - please log in again.
 *       404:
 *         description: Status not available.
 */
app.get("/status/:id", validateHostId, async (req, res) => {
  const id = Number(req.params.id);
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  const statuses = pollingManager.getAllStatuses();
  if (statuses.size === 0) {
    await pollingManager.initializePolling(userId);
  }

  const statusEntry = pollingManager.getStatus(id);
  if (!statusEntry) {
    return res.status(404).json({ error: "Status not available" });
  }

  res.json(statusEntry);
});

/**
 * @openapi
 * /clear-connections:
 *   post:
 *     summary: Clear all SSH connections
 *     description: Clears all SSH connections from the connection pool.
 *     tags:
 *       - Server Stats
 *     responses:
 *       200:
 *         description: All SSH connections cleared.
 *       401:
 *         description: Session expired - please log in again.
 */
app.post("/clear-connections", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  connectionPool.clearAllConnections();
  res.json({ message: "All SSH connections cleared" });
});

/**
 * @openapi
 * /refresh:
 *   post:
 *     summary: Refresh polling
 *     description: Clears all SSH connections and refreshes host polling.
 *     tags:
 *       - Server Stats
 *     responses:
 *       200:
 *         description: Polling refreshed.
 *       401:
 *         description: Session expired - please log in again.
 */
app.post("/refresh", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  connectionPool.clearAllConnections();

  await pollingManager.refreshHostPolling(userId);
  res.json({ message: "Polling refreshed" });
});

/**
 * @openapi
 * /host-updated:
 *   post:
 *     summary: Start polling for updated host
 *     description: Starts polling for a specific host after it has been updated.
 *     tags:
 *       - Server Stats
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Host polling started.
 *       400:
 *         description: Invalid hostId.
 *       401:
 *         description: Session expired - please log in again.
 *       404:
 *         description: Host not found.
 *       500:
 *         description: Failed to start polling.
 */
app.post("/host-updated", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { hostId } = req.body;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  if (!hostId || typeof hostId !== "number") {
    return res.status(400).json({ error: "Invalid hostId" });
  }

  try {
    const host = await fetchHostById(hostId, userId);
    if (host) {
      connectionPool.clearHostConnections(host);

      await pollingManager.startPollingForHost(host);
      res.json({ message: "Host polling started" });
    } else {
      res.status(404).json({ error: "Host not found" });
    }
  } catch (error) {
    statsLogger.error("Failed to start polling for host", error, {
      operation: "host_updated",
      hostId,
      userId,
    });
    res.status(500).json({ error: "Failed to start polling" });
  }
});

/**
 * @openapi
 * /host-deleted:
 *   post:
 *     summary: Stop polling for deleted host
 *     description: Stops polling for a specific host after it has been deleted.
 *     tags:
 *       - Server Stats
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Host polling stopped.
 *       400:
 *         description: Invalid hostId.
 *       401:
 *         description: Session expired - please log in again.
 *       500:
 *         description: Failed to stop polling.
 */
app.post("/host-deleted", async (req, res) => {
  const userId = (req as AuthenticatedRequest).userId;
  const { hostId } = req.body;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  if (!hostId || typeof hostId !== "number") {
    return res.status(400).json({ error: "Invalid hostId" });
  }

  try {
    pollingManager.stopPollingForHost(hostId, true);
    res.json({ message: "Host polling stopped" });
  } catch (error) {
    statsLogger.error("Failed to stop polling for host", error, {
      operation: "host_deleted",
      hostId,
      userId,
    });
    res.status(500).json({ error: "Failed to stop polling" });
  }
});

/**
 * @openapi
 * /metrics/{id}:
 *   get:
 *     summary: Get host metrics
 *     description: Retrieves current metrics for a specific host including CPU, memory, disk, network, processes, and system information.
 *     tags:
 *       - Server Stats
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Host metrics data.
 *       401:
 *         description: Session expired - please log in again.
 *       404:
 *         description: Metrics not available.
 */
app.get("/metrics/:id", validateHostId, async (req, res) => {
  const id = Number(req.params.id);
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  const metricsData = pollingManager.getMetrics(id);
  if (!metricsData) {
    return res.status(404).json({
      error: "Metrics not available",
      cpu: { percent: null, cores: null, load: null },
      memory: { percent: null, usedGiB: null, totalGiB: null },
      disk: {
        percent: null,
        usedHuman: null,
        totalHuman: null,
        availableHuman: null,
      },
      network: { interfaces: [] },
      uptime: { seconds: null, formatted: null },
      processes: { total: null, running: null, top: [] },
      system: { hostname: null, kernel: null, os: null },
      lastChecked: new Date().toISOString(),
    });
  }

  res.json({
    ...metricsData.data,
    lastChecked: new Date(metricsData.timestamp).toISOString(),
  });
});

/**
 * @openapi
 * /metrics/start/{id}:
 *   post:
 *     summary: Start metrics collection
 *     description: Establishes an SSH connection and starts collecting metrics for a specific host.
 *     tags:
 *       - Server Stats
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Metrics collection started successfully, or TOTP required.
 *       401:
 *         description: Session expired - please log in again.
 *       404:
 *         description: Host not found.
 *       500:
 *         description: Failed to start metrics collection.
 */
app.post("/metrics/start/:id", validateHostId, async (req, res) => {
  const id = Number(req.params.id);
  const userId = (req as AuthenticatedRequest).userId;

  const connectionLogs: Array<Omit<LogEntry, "id" | "timestamp">> = [];

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    connectionLogs.push(
      createConnectionLog("error", "stats_connecting", "Session expired"),
    );
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
      connectionLogs,
    });
  }

  try {
    const host = await fetchHostById(id, userId);
    if (!host) {
      connectionLogs.push(
        createConnectionLog("error", "stats_connecting", "Host not found"),
      );
      return res.status(404).json({ error: "Host not found", connectionLogs });
    }

    connectionLogs.push(
      createConnectionLog(
        "info",
        "stats_connecting",
        "Starting metrics collection",
      ),
    );

    connectionLogs.push(
      createConnectionLog("info", "dns", `Resolving DNS for ${host.ip}`),
    );

    connectionLogs.push(
      createConnectionLog(
        "info",
        "tcp",
        `Connecting to ${host.ip}:${host.port}`,
      ),
    );

    connectionLogs.push(
      createConnectionLog("info", "handshake", "Initiating SSH handshake"),
    );

    if (host.authType === "password") {
      connectionLogs.push(
        createConnectionLog("info", "auth", "Authenticating with password"),
      );
    } else if (host.authType === "key") {
      connectionLogs.push(
        createConnectionLog("info", "auth", "Authenticating with SSH key"),
      );
    }

    const sessionKey = getSessionKey(host.id, userId);

    const existingSession = metricsSessions[sessionKey];
    if (existingSession && existingSession.isConnected) {
      connectionLogs.push(
        createConnectionLog(
          "success",
          "stats_polling",
          "Using existing metrics session",
        ),
      );
      return res.json({ success: true, connectionLogs });
    }

    const config = await buildSshConfig(host);
    const client = new Client();

    const connectionPromise = new Promise<{
      success: boolean;
      requires_totp?: boolean;
      sessionId?: string;
      prompt?: string;
      viewerSessionId?: string;
    }>((resolve, reject) => {
      let isResolved = false;

      const timeout = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          client.end();
          reject(new Error("Connection timeout"));
        }
      }, 60000);

      client.on(
        "keyboard-interactive",
        (name, instructions, instructionsLang, prompts, finish) => {
          const totpPromptIndex = prompts.findIndex((p) =>
            /verification code|verification_code|token|otp|2fa|authenticator|google.*auth/i.test(
              p.prompt,
            ),
          );

          if (totpPromptIndex !== -1) {
            const sessionId = `totp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            pendingTOTPSessions[sessionId] = {
              client,
              finish,
              config,
              createdAt: Date.now(),
              sessionId,
              hostId: host.id,
              userId: host.userId!,
              prompts: prompts.map((p) => ({
                prompt: p.prompt,
                echo: p.echo ?? false,
              })),
              totpPromptIndex,
              resolvedPassword: host.password,
              totpAttempts: 0,
            };

            connectionLogs.push(
              createConnectionLog(
                "info",
                "stats_totp",
                "TOTP verification required",
              ),
            );

            clearTimeout(timeout);
            if (!isResolved) {
              isResolved = true;
              resolve({
                success: false,
                requires_totp: true,
                sessionId,
                prompt: prompts[totpPromptIndex].prompt,
              });
            }
            return;
          } else {
            const responses = prompts.map((p) => {
              if (/password/i.test(p.prompt) && host.password) {
                return host.password;
              }
              return "";
            });
            finish(responses);
          }
        },
      );

      client.on("ready", () => {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;

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
              "stats_polling",
              "Metrics session established",
            ),
          );

          metricsSessions[sessionKey] = {
            client,
            isConnected: true,
            lastActive: Date.now(),
            activeOperations: 0,
            hostId: host.id,
            userId,
          };
          scheduleMetricsSessionCleanup(sessionKey);

          const viewerSessionId = `viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
          pollingManager.registerViewer(host.id, viewerSessionId, userId);

          resolve({ success: true, viewerSessionId });
        }
      });

      client.on("error", (error) => {
        clearTimeout(timeout);
        if (!isResolved) {
          isResolved = true;

          const errorMessage =
            error instanceof Error ? error.message : String(error);
          let errorStage: ConnectionStage = "error";

          if (
            errorMessage.includes("ENOTFOUND") ||
            errorMessage.includes("getaddrinfo")
          ) {
            errorStage = "dns";
            connectionLogs.push(
              createConnectionLog(
                "error",
                errorStage,
                `DNS resolution failed: ${errorMessage}`,
              ),
            );
          } else if (
            errorMessage.includes("ECONNREFUSED") ||
            errorMessage.includes("ETIMEDOUT")
          ) {
            errorStage = "tcp";
            connectionLogs.push(
              createConnectionLog(
                "error",
                errorStage,
                `TCP connection failed: ${errorMessage}`,
              ),
            );
          } else if (
            errorMessage.includes("handshake") ||
            errorMessage.includes("key exchange")
          ) {
            errorStage = "handshake";
            connectionLogs.push(
              createConnectionLog(
                "error",
                errorStage,
                `SSH handshake failed: ${errorMessage}`,
              ),
            );
          } else if (
            errorMessage.includes("authentication") ||
            errorMessage.includes("Authentication")
          ) {
            errorStage = "auth";
            connectionLogs.push(
              createConnectionLog(
                "error",
                errorStage,
                `Authentication failed: ${errorMessage}`,
              ),
            );
          } else if (errorMessage.includes("verification failed")) {
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
                `SSH connection failed: ${errorMessage}`,
              ),
            );
          }

          statsLogger.error("SSH connection error in metrics/start", {
            operation: "metrics_start_ssh_error",
            hostId: host.id,
            error: errorMessage,
          });
          reject(error);
        }
      });

      if (
        host.useSocks5 &&
        (host.socks5Host ||
          (host.socks5ProxyChain && host.socks5ProxyChain.length > 0))
      ) {
        connectionLogs.push(
          createConnectionLog("info", "proxy", "Connecting via SOCKS5 proxy"),
        );
        createSocks5Connection(host.ip, host.port, {
          useSocks5: host.useSocks5,
          socks5Host: host.socks5Host,
          socks5Port: host.socks5Port,
          socks5Username: host.socks5Username,
          socks5Password: host.socks5Password,
          socks5ProxyChain: host.socks5ProxyChain,
        })
          .then((socks5Socket) => {
            if (socks5Socket) {
              config.sock = socks5Socket;
            }
            client.connect(config);
          })
          .catch((error) => {
            if (!isResolved) {
              isResolved = true;
              clearTimeout(timeout);
              connectionLogs.push(
                createConnectionLog(
                  "error",
                  "proxy",
                  `SOCKS5 proxy connection failed: ${error instanceof Error ? error.message : "Unknown error"}`,
                ),
              );
              reject(error);
            }
          });
      } else {
        client.connect(config);
      }
    });

    const result = await connectionPromise;
    res.json({ ...result, connectionLogs });
  } catch (error) {
    statsLogger.error("Failed to start metrics collection", {
      operation: "metrics_start_error",
      hostId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    connectionLogs.push(
      createConnectionLog(
        "error",
        "stats_connecting",
        `Failed to start metrics: ${error instanceof Error ? error.message : "Unknown error"}`,
      ),
    );
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to start metrics collection",
      connectionLogs,
    });
  }
});

/**
 * @openapi
 * /metrics/stop/{id}:
 *   post:
 *     summary: Stop metrics collection
 *     description: Stops metrics collection for a specific host and cleans up the SSH session.
 *     tags:
 *       - Server Stats
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: false
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               viewerSessionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Metrics collection stopped successfully.
 *       401:
 *         description: Session expired - please log in again.
 *       500:
 *         description: Failed to stop metrics collection.
 */
app.post("/metrics/stop/:id", validateHostId, async (req, res) => {
  const id = Number(req.params.id);
  const userId = (req as AuthenticatedRequest).userId;
  const { viewerSessionId } = req.body;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  try {
    const sessionKey = getSessionKey(id, userId);
    const session = metricsSessions[sessionKey];

    if (session) {
      cleanupMetricsSession(sessionKey);
    }

    if (viewerSessionId && typeof viewerSessionId === "string") {
      pollingManager.unregisterViewer(id, viewerSessionId);
    } else {
      pollingManager.stopMetricsOnly(id);
    }

    res.json({ success: true });
  } catch (error) {
    statsLogger.error("Failed to stop metrics collection", {
      operation: "metrics_stop_error",
      hostId: id,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to stop metrics collection",
    });
  }
});

/**
 * @openapi
 * /metrics/connect-totp:
 *   post:
 *     summary: Complete TOTP verification for metrics
 *     description: Verifies the TOTP code and completes the metrics SSH connection.
 *     tags:
 *       - Server Stats
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
 *         description: TOTP verified, metrics connection established.
 *       400:
 *         description: Missing sessionId or totpCode.
 *       401:
 *         description: Session expired or invalid TOTP code.
 *       404:
 *         description: TOTP session not found or expired.
 *       500:
 *         description: Failed to verify TOTP.
 */
app.post("/metrics/connect-totp", async (req, res) => {
  const { sessionId, totpCode } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  if (!sessionId || !totpCode) {
    return res.status(400).json({ error: "Missing sessionId or totpCode" });
  }

  const session = pendingTOTPSessions[sessionId];
  if (!session) {
    return res.status(404).json({ error: "TOTP session not found or expired" });
  }

  if (Date.now() - session.createdAt > 180000) {
    delete pendingTOTPSessions[sessionId];
    try {
      session.client.end();
    } catch {}
    return res.status(408).json({ error: "TOTP session timeout" });
  }

  if (session.userId !== userId) {
    return res.status(403).json({ error: "Unauthorized" });
  }

  session.totpAttempts++;
  if (session.totpAttempts > 3) {
    delete pendingTOTPSessions[sessionId];
    try {
      session.client.end();
    } catch {}
    return res.status(429).json({ error: "Too many TOTP attempts" });
  }

  try {
    const responses = (session.prompts || []).map((p, idx) => {
      if (idx === session.totpPromptIndex) {
        return totpCode.trim();
      } else if (/password/i.test(p.prompt) && session.resolvedPassword) {
        return session.resolvedPassword;
      }
      return "";
    });

    const connectionPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error("TOTP verification timeout"));
      }, 30000);

      session.client.once(
        "keyboard-interactive",
        (name, instructions, instructionsLang, prompts, finish) => {
          statsLogger.warn("Second keyboard-interactive received after TOTP", {
            operation: "totp_second_keyboard_interactive",
            hostId: session.hostId,
            sessionId,
            prompts: prompts.map((p) => p.prompt),
          });
          const secondResponses = prompts.map((p) => {
            if (/password/i.test(p.prompt) && session.resolvedPassword) {
              return session.resolvedPassword;
            }
            return "";
          });
          finish(secondResponses);
        },
      );

      session.client.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });

      session.client.once("error", (error) => {
        clearTimeout(timeout);
        statsLogger.error("SSH client error after TOTP", {
          operation: "totp_client_error",
          hostId: session.hostId,
          sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
        reject(error);
      });
    });

    session.finish(responses);

    await connectionPromise;

    const sessionKey = getSessionKey(session.hostId, userId);
    metricsSessions[sessionKey] = {
      client: session.client,
      isConnected: true,
      lastActive: Date.now(),
      activeOperations: 0,
      hostId: session.hostId,
      userId,
    };
    scheduleMetricsSessionCleanup(sessionKey);

    delete pendingTOTPSessions[sessionId];

    const viewerSessionId = `viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    pollingManager.registerViewer(session.hostId, viewerSessionId, userId);

    res.json({ success: true, viewerSessionId });
  } catch (error) {
    statsLogger.error("TOTP verification failed", {
      operation: "totp_verification_failed",
      hostId: session.hostId,
      sessionId,
      error: error instanceof Error ? error.message : String(error),
    });

    if (session.totpAttempts >= 3) {
      delete pendingTOTPSessions[sessionId];
      try {
        session.client.end();
      } catch {}
    }

    res.status(401).json({
      error: "TOTP verification failed",
      attemptsRemaining: Math.max(0, 3 - session.totpAttempts),
    });
  }
});

/**
 * @openapi
 * /metrics/heartbeat:
 *   post:
 *     summary: Update viewer heartbeat
 *     description: Updates the heartbeat timestamp for a metrics viewer session to keep it alive.
 *     tags:
 *       - Server Stats
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               viewerSessionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Heartbeat updated successfully.
 *       400:
 *         description: Invalid viewerSessionId.
 *       401:
 *         description: Session expired - please log in again.
 *       404:
 *         description: Viewer session not found.
 *       500:
 *         description: Failed to update heartbeat.
 */
app.post("/metrics/heartbeat", async (req, res) => {
  const { viewerSessionId } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  if (!viewerSessionId || typeof viewerSessionId !== "string") {
    return res.status(400).json({ error: "Invalid viewerSessionId" });
  }

  try {
    const success = pollingManager.updateHeartbeat(viewerSessionId);
    if (success) {
      res.json({ success: true });
    } else {
      res.status(404).json({ error: "Viewer session not found" });
    }
  } catch (error) {
    statsLogger.error("Failed to update heartbeat", {
      operation: "heartbeat_error",
      viewerSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Failed to update heartbeat" });
  }
});

/**
 * @openapi
 * /metrics/register-viewer:
 *   post:
 *     summary: Register metrics viewer
 *     description: Registers a new viewer session for a host to track who is viewing metrics.
 *     tags:
 *       - Server Stats
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Viewer registered successfully.
 *       400:
 *         description: Invalid hostId.
 *       401:
 *         description: Session expired - please log in again.
 *       500:
 *         description: Failed to register viewer.
 */
app.post("/metrics/register-viewer", async (req, res) => {
  const { hostId } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  if (!hostId || typeof hostId !== "number") {
    return res.status(400).json({ error: "Invalid hostId" });
  }

  try {
    const viewerSessionId = `viewer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    pollingManager.registerViewer(hostId, viewerSessionId, userId);
    res.json({ success: true, viewerSessionId });
  } catch (error) {
    statsLogger.error("Failed to register viewer", {
      operation: "register_viewer_error",
      hostId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Failed to register viewer" });
  }
});

/**
 * @openapi
 * /metrics/unregister-viewer:
 *   post:
 *     summary: Unregister metrics viewer
 *     description: Unregisters a viewer session when they stop viewing metrics for a host.
 *     tags:
 *       - Server Stats
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               hostId:
 *                 type: integer
 *               viewerSessionId:
 *                 type: string
 *     responses:
 *       200:
 *         description: Viewer unregistered successfully.
 *       400:
 *         description: Invalid hostId or viewerSessionId.
 *       401:
 *         description: Session expired - please log in again.
 *       500:
 *         description: Failed to unregister viewer.
 */
app.post("/metrics/unregister-viewer", async (req, res) => {
  const { hostId, viewerSessionId } = req.body;
  const userId = (req as AuthenticatedRequest).userId;

  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  if (!hostId || typeof hostId !== "number") {
    return res.status(400).json({ error: "Invalid hostId" });
  }

  if (!viewerSessionId || typeof viewerSessionId !== "string") {
    return res.status(400).json({ error: "Invalid viewerSessionId" });
  }

  try {
    pollingManager.unregisterViewer(hostId, viewerSessionId);
    res.json({ success: true });
  } catch (error) {
    statsLogger.error("Failed to unregister viewer", {
      operation: "unregister_viewer_error",
      hostId,
      viewerSessionId,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(500).json({ error: "Failed to unregister viewer" });
  }
});

process.on("SIGINT", () => {
  pollingManager.destroy();
  connectionPool.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
  pollingManager.destroy();
  connectionPool.destroy();
  process.exit(0);
});

const PORT = 30005;
app.listen(PORT, async () => {
  try {
    await authManager.initialize();
  } catch (err) {
    statsLogger.error("Failed to initialize AuthManager", err, {
      operation: "auth_init_error",
    });
  }

  setInterval(
    () => {
      authFailureTracker.cleanup();
      pollingBackoff.cleanup();
    },
    10 * 60 * 1000,
  );
});
