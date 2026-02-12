import { Client } from "ssh2";
import { sshLogger } from "../utils/logger.js";

interface PooledConnection {
  client: Client;
  lastUsed: number;
  inUse: boolean;
  hostKey: string;
}

class SSHConnectionPool {
  private connections = new Map<string, PooledConnection[]>();
  private maxConnectionsPerHost = 3;
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    this.cleanupInterval = setInterval(
      () => {
        this.cleanup();
      },
      2 * 60 * 1000,
    );
  }

  private isConnectionHealthy(client: Client): boolean {
    try {
      const sock = (client as any)._sock;
      if (sock && (sock.destroyed || !sock.writable)) {
        return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  async getConnection(
    key: string,
    factory: () => Promise<Client>,
  ): Promise<Client> {
    let connections = this.connections.get(key) || [];

    const available = connections.find((conn) => !conn.inUse);
    if (available) {
      if (!this.isConnectionHealthy(available.client)) {
        sshLogger.warn("Removing unhealthy connection from pool", {
          operation: "pool_remove_dead",
          hostKey: key,
        });
        try {
          available.client.end();
        } catch {}
        connections = connections.filter((c) => c !== available);
        this.connections.set(key, connections);
      } else {
        available.inUse = true;
        available.lastUsed = Date.now();
        return available.client;
      }
    }

    if (connections.length < this.maxConnectionsPerHost) {
      const client = await factory();
      const pooled: PooledConnection = {
        client,
        lastUsed: Date.now(),
        inUse: true,
        hostKey: key,
      };
      connections.push(pooled);
      this.connections.set(key, connections);

      client.on("end", () => {
        this.removeConnection(key, client);
      });
      client.on("close", () => {
        this.removeConnection(key, client);
      });

      return client;
    }

    return new Promise((resolve) => {
      const checkAvailable = () => {
        const conns = this.connections.get(key) || [];
        const avail = conns.find((conn) => !conn.inUse);
        if (avail) {
          if (!this.isConnectionHealthy(avail.client)) {
            try {
              avail.client.end();
            } catch {}
            const filtered = conns.filter((c) => c !== avail);
            this.connections.set(key, filtered);
            factory().then((client) => {
              const pooled: PooledConnection = {
                client,
                lastUsed: Date.now(),
                inUse: true,
                hostKey: key,
              };
              filtered.push(pooled);
              this.connections.set(key, filtered);
              client.on("end", () => this.removeConnection(key, client));
              client.on("close", () => this.removeConnection(key, client));
              resolve(client);
            });
          } else {
            avail.inUse = true;
            avail.lastUsed = Date.now();
            resolve(avail.client);
          }
        } else {
          setTimeout(checkAvailable, 100);
        }
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
      } catch {}
    }
    this.connections.delete(key);
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
        if (!this.isConnectionHealthy(conn.client)) {
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

  clearAllConnections(): void {
    for (const connections of this.connections.values()) {
      for (const conn of connections) {
        try {
          conn.client.end();
        } catch {}
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
