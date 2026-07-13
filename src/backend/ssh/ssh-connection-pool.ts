import { Client } from "ssh2";
import { sshLogger } from "../utils/logger.js";

interface PooledConnection {
  client: Client;
  lastUsed: number;
  inUse: boolean;
  hostKey: string;
}

const DEFAULT_MAX_CONNECTIONS_PER_HOST = 3;
const DEFAULT_MAX_WAIT_MS = 30_000;
const WAIT_POLL_MS = 100;
const IDLE_MAX_AGE_MS = 10 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000;

class SSHConnectionPool {
  private connections = new Map<string, PooledConnection[]>();
  private maxConnectionsPerHost = DEFAULT_MAX_CONNECTIONS_PER_HOST;
  private maxWaitMs = DEFAULT_MAX_WAIT_MS;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, CLEANUP_INTERVAL_MS);
  }

  private isConnectionHealthy(client: Client): boolean {
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
    this.connections.set(key, filtered);
    return filtered;
  }

  private async createPooledClient(
    key: string,
    factory: () => Promise<Client>,
    existing: PooledConnection[],
  ): Promise<Client> {
    const client = await factory();
    const pooled: PooledConnection = {
      client,
      lastUsed: Date.now(),
      inUse: true,
      hostKey: key,
    };
    existing.push(pooled);
    this.connections.set(key, existing);

    client.on("end", () => {
      this.removeConnection(key, client);
    });
    client.on("close", () => {
      this.removeConnection(key, client);
    });

    return client;
  }

  async getConnection(
    key: string,
    factory: () => Promise<Client>,
  ): Promise<Client> {
    let connections = this.connections.get(key) || [];

    const available = connections.find((conn) => !conn.inUse);
    if (available) {
      if (!this.isConnectionHealthy(available.client)) {
        connections = this.removeUnhealthy(key, connections, available);
      } else {
        available.inUse = true;
        available.lastUsed = Date.now();
        return available.client;
      }
    }

    if (connections.length < this.maxConnectionsPerHost) {
      return this.createPooledClient(key, factory, connections);
    }

    const startedAt = Date.now();

    return new Promise<Client>((resolve, reject) => {
      const checkAvailable = () => {
        if (Date.now() - startedAt >= this.maxWaitMs) {
          const err = new Error(
            `SSH connection pool wait timed out after ${this.maxWaitMs}ms (${key})`,
          );
          sshLogger.warn("Connection pool wait timeout", {
            operation: "pool_wait_timeout",
            hostKey: key,
            maxWaitMs: this.maxWaitMs,
          });
          reject(err);
          return;
        }

        const conns = this.connections.get(key) || [];
        const avail = conns.find((conn) => !conn.inUse);

        if (!avail) {
          setTimeout(checkAvailable, WAIT_POLL_MS);
          return;
        }

        if (!this.isConnectionHealthy(avail.client)) {
          const filtered = this.removeUnhealthy(key, conns, avail);
          if (filtered.length < this.maxConnectionsPerHost) {
            this.createPooledClient(key, factory, filtered)
              .then(resolve)
              .catch(reject);
            return;
          }
          setTimeout(checkAvailable, WAIT_POLL_MS);
          return;
        }

        avail.inUse = true;
        avail.lastUsed = Date.now();
        resolve(avail.client);
      };

      checkAvailable();
    });
  }

  releaseConnection(key: string, client: Client): void {
    const connections = this.connections.get(key) || [];
    const pooled = connections.find((conn) => conn.client === client);
    if (pooled) {
      pooled.inUse = false;
      pooled.lastUsed = Date.now();
    }
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
  }

  clearKeyConnections(key: string): void {
    const connections = this.connections.get(key) || [];
    for (const conn of connections) {
      try {
        conn.client.end();
      } catch {
        // expected
      }
    }
    this.connections.delete(key);
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
    }
  }

  clearAllConnections(): void {
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
    clearInterval(this.cleanupInterval);
    this.clearAllConnections();
  }
}

export const connectionPool = new SSHConnectionPool();

export async function withConnection<T>(
  key: string,
  factory: () => Promise<Client>,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await connectionPool.getConnection(key, factory);
  try {
    return await fn(client);
  } finally {
    connectionPool.releaseConnection(key, client);
  }
}
