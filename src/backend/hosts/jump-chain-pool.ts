import type { Client } from "ssh2";
import { sshLogger } from "../utils/logger.js";

export type JumpHop = { hostId: number };

export type JumpChainOpener = (
  jumpHosts: JumpHop[],
  userId: string,
) => Promise<Client | null>;

export interface JumpChainPoolOptions {
  /** Idle TTL in milliseconds after refCount drops to zero. Default 120s. */
  idleTtlMs?: number;
}

export interface JumpChainLease {
  readonly key: string;
  readonly client: Client;
  /** Release one reference to the shared chain. Idempotent. */
  release: () => void;
  /** Mark the chain unhealthy, evict it from the pool and close it. Idempotent. */
  invalidate: () => void;
}

export interface JumpChainPoolStats {
  size: number;
  inflight: number;
  totalRefs: number;
}

interface PoolEntry {
  key: string;
  client: Client;
  refCount: number;
  lastReleasedAt: number;
  idleTimer: NodeJS.Timeout | null;
  closed: boolean;
  detachListeners: () => void;
}

const DEFAULT_IDLE_TTL_MS = 120_000;

export function buildJumpChainKey(
  userId: string,
  jumpHosts: JumpHop[],
): string {
  return `${userId}:${jumpHosts.map((hop) => hop.hostId).join(">")}`;
}

function safeEnd(client: Client): void {
  try {
    client.end();
  } catch {
    // already closed
  }
}

function isClientHealthy(client: Client): boolean {
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

/**
 * Core-level jump host chain pool shared across background probes and
 * connections. Deduplicates concurrent chain opens (singleflight), tracks
 * active references, and closes idle chains after a configurable TTL.
 */
export class JumpChainPool {
  private readonly entries = new Map<string, PoolEntry>();
  private readonly inflight = new Map<string, Promise<PoolEntry | null>>();
  private readonly generations = new Map<string, number>();
  private readonly idleTtlMs: number;
  private destroyed = false;

  constructor(
    private readonly open: JumpChainOpener,
    options: JumpChainPoolOptions = {},
  ) {
    this.idleTtlMs = Math.max(0, options.idleTtlMs ?? DEFAULT_IDLE_TTL_MS);
  }

  async acquire(
    jumpHosts: JumpHop[],
    userId: string,
  ): Promise<JumpChainLease | null> {
    if (this.destroyed) {
      throw new Error("JumpChainPool destroyed");
    }
    if (!jumpHosts || jumpHosts.length === 0) {
      return null;
    }

    const key = buildJumpChainKey(userId, jumpHosts);
    const existing = this.entries.get(key);
    if (existing) {
      if (!existing.closed && isClientHealthy(existing.client)) {
        return this.checkout(existing);
      }
      this.evictEntry(existing, true);
    }

    let pending = this.inflight.get(key);
    if (!pending) {
      const created = this.openEntry(key, jumpHosts, userId);
      const tracked = created.finally(() => {
        if (this.inflight.get(key) === tracked) {
          this.inflight.delete(key);
        }
      });
      this.inflight.set(key, tracked);
      pending = tracked;
    }

    const entry = await pending;
    if (this.destroyed) {
      throw new Error("JumpChainPool destroyed");
    }
    if (
      !entry ||
      entry.closed ||
      this.entries.get(key) !== entry ||
      !isClientHealthy(entry.client)
    ) {
      return null;
    }

    return this.checkout(entry);
  }

  async withJumpChain<T>(
    jumpHosts: JumpHop[],
    userId: string,
    fn: (lease: JumpChainLease) => Promise<T>,
  ): Promise<T | null> {
    const lease = await this.acquire(jumpHosts, userId);
    if (!lease) return null;
    try {
      return await fn(lease);
    } finally {
      lease.release();
    }
  }

  invalidate(jumpHosts: JumpHop[], userId: string): void {
    if (!jumpHosts || jumpHosts.length === 0) return;
    this.invalidateKey(buildJumpChainKey(userId, jumpHosts));
  }

  invalidateKey(key: string): void {
    this.bumpGeneration(key);
    this.inflight.delete(key);
    const entry = this.entries.get(key);
    if (entry) {
      this.evictEntry(entry, true);
    }
  }

  clear(): void {
    const keys = new Set([...this.entries.keys(), ...this.inflight.keys()]);
    for (const key of keys) {
      this.bumpGeneration(key);
    }
    this.inflight.clear();
    for (const entry of [...this.entries.values()]) {
      this.evictEntry(entry, true);
    }
    this.entries.clear();
  }

  destroy(): void {
    this.destroyed = true;
    this.clear();
  }

  getStats(): JumpChainPoolStats {
    let totalRefs = 0;
    for (const entry of this.entries.values()) {
      totalRefs += entry.refCount;
    }
    return {
      size: this.entries.size,
      inflight: this.inflight.size,
      totalRefs,
    };
  }

  private bumpGeneration(key: string): void {
    this.generations.set(key, (this.generations.get(key) ?? 0) + 1);
  }

  private checkout(entry: PoolEntry): JumpChainLease {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    entry.refCount += 1;

    let released = false;
    return {
      key: entry.key,
      client: entry.client,
      release: () => {
        if (released) return;
        released = true;
        if (entry.refCount > 0) {
          entry.refCount -= 1;
        }
        if (entry.refCount === 0 && !entry.closed) {
          entry.lastReleasedAt = Date.now();
          this.scheduleIdleEviction(entry);
        }
      },
      invalidate: () => {
        if (!released) {
          released = true;
          if (entry.refCount > 0) {
            entry.refCount -= 1;
          }
        }
        this.bumpGeneration(entry.key);
        this.evictEntry(entry, true);
      },
    };
  }

  private async openEntry(
    key: string,
    jumpHosts: JumpHop[],
    userId: string,
  ): Promise<PoolEntry | null> {
    const generation = this.generations.get(key) ?? 0;
    const client = await this.open(jumpHosts, userId);
    if (!client) return null;

    if (
      this.destroyed ||
      (this.generations.get(key) ?? 0) !== generation ||
      !isClientHealthy(client)
    ) {
      safeEnd(client);
      return null;
    }

    const entry: PoolEntry = {
      key,
      client,
      refCount: 0,
      lastReleasedAt: Date.now(),
      idleTimer: null,
      closed: false,
      detachListeners: () => {},
    };

    const onDrop = () => {
      this.evictEntry(entry, false);
    };
    client.once("close", onDrop);
    client.once("error", onDrop);
    entry.detachListeners = () => {
      client.off("close", onDrop);
      client.off("error", onDrop);
    };

    const previous = this.entries.get(key);
    if (previous && previous !== entry) {
      this.evictEntry(previous, true);
    }
    this.entries.set(key, entry);
    return entry;
  }

  private scheduleIdleEviction(entry: PoolEntry): void {
    if (entry.idleTimer) clearTimeout(entry.idleTimer);
    entry.idleTimer = setTimeout(() => {
      entry.idleTimer = null;
      if (entry.refCount === 0 && !entry.closed) {
        sshLogger.debug("Evicting idle jump host chain from pool", {
          operation: "jump_pool_idle_evict",
          jumpKey: entry.key,
        });
        this.evictEntry(entry, true);
      }
    }, this.idleTtlMs);
    entry.idleTimer.unref?.();
  }

  private evictEntry(entry: PoolEntry, closeClient: boolean): void {
    if (entry.idleTimer) {
      clearTimeout(entry.idleTimer);
      entry.idleTimer = null;
    }
    if (this.entries.get(entry.key) === entry) {
      this.entries.delete(entry.key);
    }
    if (entry.closed) return;
    entry.closed = true;
    entry.detachListeners();
    if (closeClient) {
      safeEnd(entry.client);
    }
  }
}

/** Shared core jump host chain pool using createJumpHostChain. */
export const jumpChainPool = new JumpChainPool(async (jumpHosts, userId) => {
  const { createJumpHostChain } = await import("./jump-host-chain.js");
  return createJumpHostChain(jumpHosts, userId);
});
