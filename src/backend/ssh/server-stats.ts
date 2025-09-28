import express from "express";
import net from "net";
import cors from "cors";
import cookieParser from "cookie-parser";
import { Client, type ConnectConfig } from "ssh2";
import { getDb } from "../database/db/index.js";
import { sshData, sshCredentials } from "../database/db/schema.js";
import { eq, and } from "drizzle-orm";
import { statsLogger } from "../utils/logger.js";
import { SimpleDBOps } from "../utils/simple-db-ops.js";
import { AuthManager } from "../utils/auth-manager.js";

interface PooledConnection {
  client: Client;
  lastUsed: number;
  inUse: boolean;
  hostKey: string;
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
      5 * 60 * 1000,
    );
  }

  private getHostKey(host: SSHHostWithCredentials): string {
    return `${host.ip}:${host.port}:${host.username}`;
  }

  async getConnection(host: SSHHostWithCredentials): Promise<Client> {
    const hostKey = this.getHostKey(host);
    const connections = this.connections.get(hostKey) || [];

    const available = connections.find((conn) => !conn.inUse);
    if (available) {
      available.inUse = true;
      available.lastUsed = Date.now();
      return available.client;
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

    return new Promise((resolve, reject) => {
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
    return new Promise((resolve, reject) => {
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

      try {
        client.connect(buildSshConfig(host));
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

  private cleanup(): void {
    const now = Date.now();
    const maxAge = 10 * 60 * 1000;

    for (const [hostKey, connections] of this.connections.entries()) {
      const activeConnections = connections.filter((conn) => {
        if (!conn.inUse && now - conn.lastUsed > maxAge) {
          try {
            conn.client.end();
          } catch {}
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

  destroy(): void {
    clearInterval(this.cleanupInterval);
    for (const connections of this.connections.values()) {
      for (const conn of connections) {
        try {
          conn.client.end();
        } catch {}
      }
    }
    this.connections.clear();
  }
}

class RequestQueue {
  private queues = new Map<number, Array<() => Promise<any>>>();
  private processing = new Set<number>();

  async queueRequest<T>(hostId: number, request: () => Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const queue = this.queues.get(hostId) || [];
      queue.push(async () => {
        try {
          const result = await request();
          resolve(result);
        } catch (error) {
          reject(error);
        }
      });
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
    if (queue.length > 0) {
      this.processQueue(hostId);
    }
  }
}

interface CachedMetrics {
  data: any;
  timestamp: number;
  hostId: number;
}

class MetricsCache {
  private cache = new Map<number, CachedMetrics>();
  private ttl = 30000;

  get(hostId: number): any | null {
    const cached = this.cache.get(hostId);
    if (cached && Date.now() - cached.timestamp < this.ttl) {
      return cached.data;
    }
    return null;
  }

  set(hostId: number, data: any): void {
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

const connectionPool = new SSHConnectionPool();
const requestQueue = new RequestQueue();
const metricsCache = new MetricsCache();
const authManager = AuthManager.getInstance();

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
  tunnelConnections: any[];
  createdAt: string;
  updatedAt: string;
  userId: string;
}

type StatusEntry = {
  status: HostStatus;
  lastChecked: string;
};

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
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // Allow localhost and 127.0.0.1 for development
      const allowedOrigins = [
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
      ];

      // Allow any HTTPS origin (production deployments)
      if (origin.startsWith("https://")) {
        return callback(null, true);
      }

      // Allow any HTTP origin for self-hosted scenarios
      if (origin.startsWith("http://")) {
        return callback(null, true);
      }

      // Check against allowed development origins
      if (allowedOrigins.includes(origin)) {
        return callback(null, true);
      }

      // Reject other origins
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

// Add authentication middleware - Linus principle: eliminate special cases
app.use(authManager.createAuthMiddleware());

const hostStatuses: Map<number, StatusEntry> = new Map();

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
    // Check if user data is unlocked before attempting to fetch
    if (!SimpleDBOps.isUserDataUnlocked(userId)) {
      statsLogger.debug("User data locked - cannot fetch host", {
        operation: "fetchHostById_data_locked",
        userId,
        hostId: id,
      });
      return undefined;
    }

    const hosts = await SimpleDBOps.select(
      getDb()
        .select()
        .from(sshData)
        .where(and(eq(sshData.id, id), eq(sshData.userId, userId))),
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
  host: any,
  userId: string,
): Promise<SSHHostWithCredentials | undefined> {
  try {
    const baseHost: any = {
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
        ? JSON.parse(host.tunnelConnections)
        : [],
      createdAt: host.createdAt,
      updatedAt: host.updatedAt,
      userId: host.userId,
    };

    if (host.credentialId) {
      try {
        const credentials = await SimpleDBOps.select(
          getDb()
            .select()
            .from(sshCredentials)
            .where(
              and(
                eq(sshCredentials.id, host.credentialId),
                eq(sshCredentials.userId, userId),
              ),
            ),
          "ssh_credentials",
          userId,
        );

        if (credentials.length > 0) {
          const credential = credentials[0];
          baseHost.credentialId = credential.id;
          baseHost.username = credential.username;
          baseHost.authType = credential.authType;

          if (credential.password) {
            baseHost.password = credential.password;
          }
          if (credential.key) {
            baseHost.key = credential.key;
          }
          if (credential.keyPassword) {
            baseHost.keyPassword = credential.keyPassword;
          }
          if (credential.keyType) {
            baseHost.keyType = credential.keyType;
          }
        } else {
          addLegacyCredentials(baseHost, host);
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

    return baseHost;
  } catch (error) {
    statsLogger.error(
      `Failed to resolve host credentials for host ${host.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    return undefined;
  }
}

function addLegacyCredentials(baseHost: any, host: any): void {
  baseHost.password = host.password || null;
  baseHost.key = host.key || null;
  baseHost.keyPassword = host.keyPassword || null;
  baseHost.keyType = host.keyType;
}

function buildSshConfig(host: SSHHostWithCredentials): ConnectConfig {
  const base: ConnectConfig = {
    host: host.ip,
    port: host.port || 22,
    username: host.username || "root",
    readyTimeout: 10_000,
    algorithms: {
      kex: [
        "diffie-hellman-group14-sha256",
        "diffie-hellman-group14-sha1",
        "diffie-hellman-group1-sha1",
        "diffie-hellman-group-exchange-sha256",
        "diffie-hellman-group-exchange-sha1",
        "ecdh-sha2-nistp256",
        "ecdh-sha2-nistp384",
        "ecdh-sha2-nistp521",
      ],
      cipher: [
        "aes128-ctr",
        "aes192-ctr",
        "aes256-ctr",
        "aes128-gcm@openssh.com",
        "aes256-gcm@openssh.com",
        "aes128-cbc",
        "aes192-cbc",
        "aes256-cbc",
        "3des-cbc",
      ],
      hmac: [
        "hmac-sha2-256-etm@openssh.com",
        "hmac-sha2-512-etm@openssh.com",
        "hmac-sha2-256",
        "hmac-sha2-512",
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
    (base as any).password = host.password;
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

      (base as any).privateKey = Buffer.from(cleanKey, "utf8");

      if (host.keyPassword) {
        (base as any).passphrase = host.keyPassword;
      }
    } catch (keyError) {
      statsLogger.error(
        `SSH key format error for host ${host.ip}: ${keyError instanceof Error ? keyError.message : "Unknown error"}`,
      );
      throw new Error(`Invalid SSH key format for host ${host.ip}`);
    }
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

function execCommand(
  client: Client,
  command: string,
): Promise<{
  stdout: string;
  stderr: string;
  code: number | null;
}> {
  return new Promise((resolve, reject) => {
    client.exec(command, { pty: false }, (err, stream) => {
      if (err) return reject(err);
      let stdout = "";
      let stderr = "";
      let exitCode: number | null = null;
      stream
        .on("close", (code: number | undefined) => {
          exitCode = typeof code === "number" ? code : null;
          resolve({ stdout, stderr, code: exitCode });
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString("utf8");
        })
        .stderr.on("data", (data: Buffer) => {
          stderr += data.toString("utf8");
        });
    });
  });
}

function parseCpuLine(
  cpuLine: string,
): { total: number; idle: number } | undefined {
  const parts = cpuLine.trim().split(/\s+/);
  if (parts[0] !== "cpu") return undefined;
  const nums = parts
    .slice(1)
    .map((n) => Number(n))
    .filter((n) => Number.isFinite(n));
  if (nums.length < 4) return undefined;
  const idle = (nums[3] ?? 0) + (nums[4] ?? 0);
  const total = nums.reduce((a, b) => a + b, 0);
  return { total, idle };
}

function toFixedNum(n: number | null | undefined, digits = 2): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Number(n.toFixed(digits));
}

function kibToGiB(kib: number): number {
  return kib / (1024 * 1024);
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
  };
}> {
  const cached = metricsCache.get(host.id);
  if (cached) {
    return cached;
  }

  return requestQueue.queueRequest(host.id, async () => {
    return withSshConnection(host, async (client) => {
      let cpuPercent: number | null = null;
      let cores: number | null = null;
      let loadTriplet: [number, number, number] | null = null;

      try {
        const [stat1, loadAvgOut, coresOut] = await Promise.all([
          execCommand(client, "cat /proc/stat"),
          execCommand(client, "cat /proc/loadavg"),
          execCommand(
            client,
            "nproc 2>/dev/null || grep -c ^processor /proc/cpuinfo",
          ),
        ]);

        await new Promise((r) => setTimeout(r, 500));
        const stat2 = await execCommand(client, "cat /proc/stat");

        const cpuLine1 = (
          stat1.stdout.split("\n").find((l) => l.startsWith("cpu ")) || ""
        ).trim();
        const cpuLine2 = (
          stat2.stdout.split("\n").find((l) => l.startsWith("cpu ")) || ""
        ).trim();
        const a = parseCpuLine(cpuLine1);
        const b = parseCpuLine(cpuLine2);
        if (a && b) {
          const totalDiff = b.total - a.total;
          const idleDiff = b.idle - a.idle;
          const used = totalDiff - idleDiff;
          if (totalDiff > 0)
            cpuPercent = Math.max(0, Math.min(100, (used / totalDiff) * 100));
        }

        const laParts = loadAvgOut.stdout.trim().split(/\s+/);
        if (laParts.length >= 3) {
          loadTriplet = [
            Number(laParts[0]),
            Number(laParts[1]),
            Number(laParts[2]),
          ].map((v) => (Number.isFinite(v) ? Number(v) : 0)) as [
            number,
            number,
            number,
          ];
        }

        const coresNum = Number((coresOut.stdout || "").trim());
        cores = Number.isFinite(coresNum) && coresNum > 0 ? coresNum : null;
      } catch (e) {
        statsLogger.warn(
          `Failed to collect CPU metrics for host ${host.id}`,
          e,
        );
        cpuPercent = null;
        cores = null;
        loadTriplet = null;
      }

      let memPercent: number | null = null;
      let usedGiB: number | null = null;
      let totalGiB: number | null = null;
      try {
        const memInfo = await execCommand(client, "cat /proc/meminfo");
        const lines = memInfo.stdout.split("\n");
        const getVal = (key: string) => {
          const line = lines.find((l) => l.startsWith(key));
          if (!line) return null;
          const m = line.match(/\d+/);
          return m ? Number(m[0]) : null;
        };
        const totalKb = getVal("MemTotal:");
        const availKb = getVal("MemAvailable:");
        if (totalKb && availKb && totalKb > 0) {
          const usedKb = totalKb - availKb;
          memPercent = Math.max(0, Math.min(100, (usedKb / totalKb) * 100));
          usedGiB = kibToGiB(usedKb);
          totalGiB = kibToGiB(totalKb);
        }
      } catch (e) {
        statsLogger.warn(
          `Failed to collect memory metrics for host ${host.id}`,
          e,
        );
        memPercent = null;
        usedGiB = null;
        totalGiB = null;
      }

      let diskPercent: number | null = null;
      let usedHuman: string | null = null;
      let totalHuman: string | null = null;
      try {
        const [diskOutHuman, diskOutBytes] = await Promise.all([
          execCommand(client, "df -h -P / | tail -n +2"),
          execCommand(client, "df -B1 -P / | tail -n +2"),
        ]);

        const humanLine =
          diskOutHuman.stdout
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)[0] || "";
        const bytesLine =
          diskOutBytes.stdout
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)[0] || "";

        const humanParts = humanLine.split(/\s+/);
        const bytesParts = bytesLine.split(/\s+/);

        if (humanParts.length >= 6 && bytesParts.length >= 6) {
          totalHuman = humanParts[1] || null;
          usedHuman = humanParts[2] || null;

          const totalBytes = Number(bytesParts[1]);
          const usedBytes = Number(bytesParts[2]);

          if (
            Number.isFinite(totalBytes) &&
            Number.isFinite(usedBytes) &&
            totalBytes > 0
          ) {
            diskPercent = Math.max(
              0,
              Math.min(100, (usedBytes / totalBytes) * 100),
            );
          }
        }
      } catch (e) {
        statsLogger.warn(
          `Failed to collect disk metrics for host ${host.id}`,
          e,
        );
        diskPercent = null;
        usedHuman = null;
        totalHuman = null;
      }

      const result = {
        cpu: { percent: toFixedNum(cpuPercent, 0), cores, load: loadTriplet },
        memory: {
          percent: toFixedNum(memPercent, 0),
          usedGiB: usedGiB ? toFixedNum(usedGiB, 2) : null,
          totalGiB: totalGiB ? toFixedNum(totalGiB, 2) : null,
        },
        disk: { percent: toFixedNum(diskPercent, 0), usedHuman, totalHuman },
      };

      metricsCache.set(host.id, result);
      return result;
    });
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
      } catch {}
      resolve(result);
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => onDone(true));
    socket.once("timeout", () => onDone(false));
    socket.once("error", () => onDone(false));
    socket.connect(port, host);
  });
}

async function pollStatusesOnce(userId?: string): Promise<void> {
  if (!userId) {
    statsLogger.warn("Skipping status poll - no authenticated user", {
      operation: "status_poll",
    });
    return;
  }

  const hosts = await fetchAllHosts(userId);
  if (hosts.length === 0) {
    statsLogger.warn("No hosts retrieved for status polling", {
      operation: "status_poll",
      userId,
    });
    return;
  }

  const now = new Date().toISOString();

  const checks = hosts.map(async (h) => {
    const isOnline = await tcpPing(h.ip, h.port, 5000);
    const now = new Date().toISOString();
    const statusEntry: StatusEntry = {
      status: isOnline ? "online" : "offline",
      lastChecked: now,
    };
    hostStatuses.set(h.id, statusEntry);
    return isOnline;
  });

  const results = await Promise.allSettled(checks);
  const onlineCount = results.filter(
    (r) => r.status === "fulfilled" && r.value === true,
  ).length;
  const offlineCount = hosts.length - onlineCount;
  statsLogger.success("Status polling completed", {
    operation: "status_poll",
    totalHosts: hosts.length,
    onlineCount,
    offlineCount,
  });
}

app.get("/status", async (req, res) => {
  const userId = (req as any).userId;

  // Check if user data is unlocked
  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  if (hostStatuses.size === 0) {
    await pollStatusesOnce(userId);
  }
  const result: Record<number, StatusEntry> = {};
  for (const [id, entry] of hostStatuses.entries()) {
    result[id] = entry;
  }
  res.json(result);
});

app.get("/status/:id", validateHostId, async (req, res) => {
  const id = Number(req.params.id);
  const userId = (req as any).userId;

  // Check if user data is unlocked
  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  try {
    const host = await fetchHostById(id, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    const isOnline = await tcpPing(host.ip, host.port, 5000);
    const now = new Date().toISOString();
    const statusEntry: StatusEntry = {
      status: isOnline ? "online" : "offline",
      lastChecked: now,
    };

    hostStatuses.set(id, statusEntry);
    res.json(statusEntry);
  } catch (err) {
    statsLogger.error("Failed to check host status", err);
    res.status(500).json({ error: "Failed to check host status" });
  }
});

app.post("/refresh", async (req, res) => {
  const userId = (req as any).userId;

  // Check if user data is unlocked
  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  await pollStatusesOnce(userId);
  res.json({ message: "Refreshed" });
});

app.get("/metrics/:id", validateHostId, async (req, res) => {
  const id = Number(req.params.id);
  const userId = (req as any).userId;

  // Check if user data is unlocked
  if (!SimpleDBOps.isUserDataUnlocked(userId)) {
    return res.status(401).json({
      error: "Session expired - please log in again",
      code: "SESSION_EXPIRED",
    });
  }

  try {
    const host = await fetchHostById(id, userId);
    if (!host) {
      return res.status(404).json({ error: "Host not found" });
    }

    const isOnline = await tcpPing(host.ip, host.port, 5000);
    if (!isOnline) {
      return res.status(503).json({
        error: "Host is offline",
        cpu: { percent: null, cores: null, load: null },
        memory: { percent: null, usedGiB: null, totalGiB: null },
        disk: { percent: null, usedHuman: null, totalHuman: null },
        lastChecked: new Date().toISOString(),
      });
    }

    const metrics = await collectMetrics(host);
    res.json({ ...metrics, lastChecked: new Date().toISOString() });
  } catch (err) {
    statsLogger.error("Failed to collect metrics", err);

    if (err instanceof Error && err.message.includes("timeout")) {
      return res.status(504).json({
        error: "Metrics collection timeout",
        cpu: { percent: null, cores: null, load: null },
        memory: { percent: null, usedGiB: null, totalGiB: null },
        disk: { percent: null, usedHuman: null, totalHuman: null },
        lastChecked: new Date().toISOString(),
      });
    }

    return res.status(500).json({
      error: "Failed to collect metrics",
      cpu: { percent: null, cores: null, load: null },
      memory: { percent: null, usedGiB: null, totalGiB: null },
      disk: { percent: null, usedHuman: null, totalHuman: null },
      lastChecked: new Date().toISOString(),
    });
  }
});

process.on("SIGINT", () => {
  connectionPool.destroy();
  process.exit(0);
});

process.on("SIGTERM", () => {
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
});
