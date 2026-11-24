import { Client } from "ssh2";
import { sshLogger } from "../utils/logger.js";

interface PooledConnection {
  client: Client;
  lastUsed: number;
  inUse: boolean;
  hostKey: string;
}

interface ConnectionWaiter {
  resolve: (client: Client) => void;
  reject: (error: Error) => void;
  factory: () => Promise<Client>;
  timer: NodeJS.Timeout;
}

const DEFAULT_MAX_CONNECTIONS_PER_HOST = 3;
const DEFAULT_MAX_WAIT_MS = 30_000;
const IDLE_MAX_AGE_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

export class SSHConnectionPool {
  private connections = new Map<string, PooledConnection[]>();
  private waiters = new Map<string, ConnectionWaiter[]>();
  private pendingConnections = new Map<string, number>();
  private generations = new Map<string, number>();
  private destroyed = false;
  private maxConnectionsPerHost = DEFAULT_MAX_CONNECTIONS_PER_HOST;
  private maxWaitMs = DEFAULT_MAX_WAIT_MS;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
    this.cleanupInterval.unref();
  }

  private hasCapacity(key: string, connections: PooledConnection[]): boolean {
    return (
      connections.length + (this.pendingConnections.get(key) || 0) <
      this.maxConnectionsPerHost
    );
  }

  private invalidatePendingConnections(key: string): void {
    this.generations.set(key, (this.generations.get(key) || 0) + 1);
  }

  isConnectionHealthy(client: Client): boolean {
    try {
      const sock = (
        client as unknown as {
          _sock?: { destroyed?: boolean; writable?: boolean };
        }
      )._sock;
      if (sock && (sock.destroyed || !sock.writable)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private removeUnhealthy(
    key: string,
    connections: PooledConnection[],
    target: PooledConnection,
  ): PooledConnection[] {
    sshLogger.warn("Removing unhealthy connection from pool", {
      operation: "pool_remove_dead",
      hostKey: key,
    });
    try {
      target.client.end();
    } catch {
      // expected
    }
    const filtered = connections.filter((c) => c !== target);
    if (filtered.length === 0) {
      this.connections.delete(key);
    } else {
      this.connections.set(key, filtered);
    }
    return filtered;
  }

  private takeHealthyIdleConnection(key: string): PooledConnection | null {
    let connections = this.connections.get(key) || [];
    while (true) {
      const available = connections.find((conn) => !conn.inUse);
      if (!available) return null;
      if (!this.isConnectionHealthy(available.client)) {
        connections = this.removeUnhealthy(key, connections, available);
        continue;
      }
      available.inUse = true;
      available.lastUsed = Date.now();
      return available;
    }
  }

  private async createPooledClient(
    key: string,
    factory: () => Promise<Client>,
  ): Promise<Client> {
    const generation = this.generations.get(key) || 0;
    this.pendingConnections.set(
      key,
      (this.pendingConnections.get(key) || 0) + 1,
    );
    try {
      const client = await factory();
      if (this.destroyed || (this.generations.get(key) || 0) !== generation) {
        try {
          client.end();
        } catch {
          // expected
        }
        throw new Error(`SSH connection pool cleared for ${key}`);
      }
      const pooled: PooledConnection = {
        client,
        lastUsed: Date.now(),
        inUse: true,
        hostKey: key,
      };
      // Re-read after the await: concurrent connects and removals may have
      // replaced this key's array in the meantime.
      const connections = this.connections.get(key) ?? [];
      connections.push(pooled);
      this.connections.set(key, connections);

      client.on("end", () => {
        this.removeConnection(key, client);
      });
      client.on("close", () => {
        this.removeConnection(key, client);
      });

      return client;
    } finally {
      const pending = (this.pendingConnections.get(key) || 1) - 1;
      if (pending === 0) this.pendingConnections.delete(key);
      else this.pendingConnections.set(key, pending);
      this.wakeWaiter(key);
    }
  }

  private enqueueWaiter(
    key: string,
    factory: () => Promise<Client>,
  ): Promise<Client> {
    return new Promise<Client>((resolve, reject) => {
      const timer = setTimeout(() => {
        const queue = this.waiters.get(key);
        if (queue) {
          const idx = queue.findIndex((w) => w.timer === timer);
          if (idx >= 0) queue.splice(idx, 1);
          if (queue.length === 0) this.waiters.delete(key);
        }
        const err = new Error(
          `SSH connection pool wait timed out after ${this.maxWaitMs}ms (${key})`,
        );
        sshLogger.warn("Connection pool wait timeout", {
          operation: "pool_wait_timeout",
          hostKey: key,
          maxWaitMs: this.maxWaitMs,
        });
        reject(err);
      }, this.maxWaitMs);

      const waiter: ConnectionWaiter = { resolve, reject, factory, timer };
      const queue = this.waiters.get(key) || [];
      queue.push(waiter);
      this.waiters.set(key, queue);
    });
  }

  /** Hand a free connection (or new slot) to the next waiter, if any. */
  private wakeWaiter(key: string): void {
    const queue = this.waiters.get(key);
    if (!queue || queue.length === 0) return;

    while (queue.length > 0) {
      const available = this.takeHealthyIdleConnection(key);
      if (available) {
        const waiter = queue.shift()!;
        if (queue.length === 0) this.waiters.delete(key);
        else this.waiters.set(key, queue);
        clearTimeout(waiter.timer);
        waiter.resolve(available.client);
        continue;
      }

      const connections = this.connections.get(key) || [];
      if (this.hasCapacity(key, connections)) {
        const waiter = queue.shift()!;
        if (queue.length === 0) this.waiters.delete(key);
        else this.waiters.set(key, queue);
        clearTimeout(waiter.timer);
        this.createPooledClient(key, waiter.factory)
          .then(waiter.resolve)
          .catch(waiter.reject);
        continue;
      }

      break;
    }
  }

  private rejectWaiters(key: string, reason: string): void {
    const queue = this.waiters.get(key);
    if (!queue) return;
    this.waiters.delete(key);
    for (const waiter of queue) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(reason));
    }
  }

  async getConnection(
    key: string,
    factory: () => Promise<Client>,
  ): Promise<Client> {
    if (this.destroyed) {
      throw new Error("SSH connection pool destroyed");
    }

    const available = this.takeHealthyIdleConnection(key);
    if (available) {
      return available.client;
    }

    const connections = this.connections.get(key) || [];
    if (this.hasCapacity(key, connections)) {
      return this.createPooledClient(key, factory);
    }

    return this.enqueueWaiter(key, factory);
  }

  releaseConnection(key: string, client: Client): void {
    const connections = this.connections.get(key) || [];
    const pooled = connections.find((conn) => conn.client === client);
    if (pooled) {
      if (!this.isConnectionHealthy(client)) {
        this.discardConnection(key, client);
        return;
      }
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
      this.wakeWaiter(key);
    }
  }

  discardConnection(key: string, client: Client): void {
    const connections = this.connections.get(key);
    if (connections) {
      const filtered = connections.filter((c) => c.client !== client);
      if (filtered.length === 0) {
        this.connections.delete(key);
      } else {
        this.connections.set(key, filtered);
      }
    }
    try {
      client.end();
    } catch {
      // expected
    }
    this.wakeWaiter(key);
  }

  private removeConnection(key: string, client: Client): void {
    const connections = this.connections.get(key);
    if (!connections) return;
    const filtered = connections.filter((c) => c.client !== client);
    if (filtered.length === 0) {
      this.connections.delete(key);
    } else {
      this.connections.set(key, filtered);
    }
    // A slot or idle connection may now be free for waiters.
    this.wakeWaiter(key);
  }

  clearKeyConnections(key: string): void {
    this.invalidatePendingConnections(key);
    const connections = this.connections.get(key) || [];
    for (const conn of connections) {
      try {
        conn.client.end();
      } catch {
        // expected
      }
    }
    this.connections.delete(key);
    this.rejectWaiters(key, `SSH connection pool cleared for ${key}`);
  }

  private cleanup(): void {
    const now = Date.now();

    for (const [hostKey, connections] of this.connections.entries()) {
      const activeConnections = connections.filter((conn) => {
        if (!conn.inUse && now - conn.lastUsed > IDLE_MAX_AGE_MS) {
          try {
            conn.client.end();
          } catch {
            // expected
          }
          return false;
        }
        if (!this.isConnectionHealthy(conn.client)) {
          try {
            conn.client.end();
          } catch {
            // expected
          }
          return false;
        }
        return true;
      });

      if (activeConnections.length === 0) {
        this.connections.delete(hostKey);
      } else {
        this.connections.set(hostKey, activeConnections);
      }
      this.wakeWaiter(hostKey);
    }
  }

  clearAllConnections(): void {
    const keys = new Set([
      ...this.connections.keys(),
      ...this.pendingConnections.keys(),
      ...this.waiters.keys(),
    ]);
    for (const key of keys) this.invalidatePendingConnections(key);
    for (const key of [...this.waiters.keys()]) {
      this.rejectWaiters(key, "SSH connection pool destroyed");
    }
    for (const connections of this.connections.values()) {
      for (const conn of connections) {
        try {
          conn.client.end();
        } catch {
          // expected
        }
      }
    }
    this.connections.clear();
  }

  destroy(): void {
    this.destroyed = true;
    clearInterval(this.cleanupInterval);
    this.clearAllConnections();
  }
}

export const connectionPool = new SSHConnectionPool();

const TRANSPORT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENOTCONN",
  "ERR_SOCKET_CLOSED",
  "EAI_AGAIN",
]);

const TRANSPORT_ERROR_LEVELS = new Set([
  "client-socket",
  "client-timeout",
  "client-ssh",
  "protocol",
]);

const TRANSPORT_ERROR_MESSAGE_RE =
  /\b(timed?\s*out|timeout|econnreset|epipe|econnrefused|etimedout|socket\s+(closed|ended|hang\s+up)|connection\s+(closed|lost|reset|ended|timed?\s*out|terminated)|not\s+connected|channel\s+open\s+failure|keepalive\s+timeout)\b/i;

function isTransportError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    code?: unknown;
    level?: unknown;
    name?: unknown;
    message?: unknown;
  };
  if (typeof err.code === "string" && TRANSPORT_ERROR_CODES.has(err.code)) {
    return true;
  }
  if (typeof err.level === "string" && TRANSPORT_ERROR_LEVELS.has(err.level)) {
    return true;
  }
  if (err.name === "TimeoutError" || err.name === "AbortError") {
    return true;
  }
  if (
    typeof err.message === "string" &&
    TRANSPORT_ERROR_MESSAGE_RE.test(err.message)
  ) {
    return true;
  }
  return false;
}

export async function withConnection<T>(
  key: string,
  factory: () => Promise<Client>,
  fn: (client: Client) => Promise<T>,
  pool: SSHConnectionPool = connectionPool,
): Promise<T> {
  const client = await pool.getConnection(key, factory);
  let shouldDiscard = false;
  try {
    return await fn(client);
  } catch (error) {
    if (!pool.isConnectionHealthy(client) || isTransportError(error)) {
      shouldDiscard = true;
    }
    throw error;
  } finally {
    if (shouldDiscard || !pool.isConnectionHealthy(client)) {
      pool.discardConnection(key, client);
    } else {
      pool.releaseConnection(key, client);
    }
  }
}
