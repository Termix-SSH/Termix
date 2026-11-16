/**
 * Actor tokens for sandboxed plugins.
 *
 * Core mints one for each piece of work it hands a plugin child (a request,
 * a socket, a schedule tick, a callback) and only the token crosses. The
 * child sends it back with every ctx call, and core looks up who it stands
 * for. A child never names a user, so it can never claim one, and a token
 * only works on the channel of the plugin it was minted for.
 */
import { randomBytes } from "node:crypto";
import type { ActorTrail } from "../actor.js";

export interface ActorGrant {
  pluginId: string;
  /** Empty for background work with no actor. */
  userId: string;
  sessionId?: string;
  /** Where the work came from (an API key keeps its scopes). */
  trail?: ActorTrail;
  kind: "request" | "socket" | "callback" | "activate";
  expiresAt: number;
}

export interface TokenStoreOptions {
  now?: () => number;
  /** Default lifetime; a request token is revoked as soon as it ends. */
  ttlMs?: number;
}

export class SandboxTokenStore {
  private readonly grants = new Map<string, ActorGrant>();
  private readonly now: () => number;
  private readonly ttlMs: number;

  constructor(options: TokenStoreOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? 10 * 60 * 1000;
  }

  mint(grant: Omit<ActorGrant, "expiresAt"> & { ttlMs?: number }): string {
    const token = randomBytes(16).toString("base64url");
    const { ttlMs, ...rest } = grant;
    this.grants.set(token, {
      ...rest,
      expiresAt: this.now() + (ttlMs ?? this.ttlMs),
    });
    return token;
  }

  /**
   * Who a token stands for, or null. Null when it is unknown, expired,
   * revoked, or was minted for another plugin.
   */
  resolve(token: string | undefined, pluginId: string): ActorGrant | null {
    if (!token) return null;
    const grant = this.grants.get(token);
    if (!grant) return null;
    if (grant.expiresAt <= this.now()) {
      this.grants.delete(token);
      return null;
    }
    if (grant.pluginId !== pluginId) return null;
    return grant;
  }

  /** Extends a long lived token (a socket) while it is in use. */
  touch(token: string, ttlMs = this.ttlMs): void {
    const grant = this.grants.get(token);
    if (grant) grant.expiresAt = this.now() + ttlMs;
  }

  revoke(token: string | undefined): void {
    if (token) this.grants.delete(token);
  }

  /** How many live tokens a plugin holds (sockets keep a process busy). */
  countFor(pluginId: string, kind?: ActorGrant["kind"]): number {
    const now = this.now();
    let count = 0;
    for (const grant of this.grants.values()) {
      if (grant.pluginId !== pluginId || grant.expiresAt <= now) continue;
      if (!kind || grant.kind === kind) count++;
    }
    return count;
  }

  revokePlugin(pluginId: string): void {
    for (const [token, grant] of this.grants) {
      if (grant.pluginId === pluginId) this.grants.delete(token);
    }
  }

  sweep(): void {
    const now = this.now();
    for (const [token, grant] of this.grants) {
      if (grant.expiresAt <= now) this.grants.delete(token);
    }
  }

  get size(): number {
    return this.grants.size;
  }
}
