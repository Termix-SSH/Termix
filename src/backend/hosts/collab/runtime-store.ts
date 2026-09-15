import crypto from "crypto";
import { createClient } from "redis";
import { sshLogger } from "../../utils/logger.js";

export interface CollabControlRequest {
  userId: string;
  username: string;
  requestedAt: string;
}

interface PresenceEntry {
  instanceId: string;
  userId: string;
  username: string;
}

interface EventEnvelope {
  source: string;
  roomId: string;
  message: object;
}

const KEY_PREFIX = process.env.TERMIX_REDIS_PREFIX?.trim() || "termix:collab";
const EVENT_CHANNEL = `${KEY_PREFIX}:events`;
const PRESENCE_TTL_MS = 45_000;
const STATE_TTL_SECONDS = 12 * 60 * 60;
const CONNECT_RETRY_MS = 15_000;

export class CollabRuntimeStore {
  private readonly instanceId = crypto.randomUUID();
  private publisher: ReturnType<typeof createClient> | null = null;
  private subscriber: ReturnType<typeof createClient> | null = null;
  private connecting: Promise<boolean> | null = null;
  private nextConnectAttempt = 0;
  private eventListeners = new Set<(roomId: string, message: object) => void>();
  private localControllers = new Map<string, string>();
  private localRequests = new Map<string, Map<string, CollabControlRequest>>();
  private presenceMembers = new Map<string, Set<string>>();

  onEvent(listener: (roomId: string, message: object) => void): void {
    this.eventListeners.add(listener);
    void this.ensureConnected();
  }

  async publish(roomId: string, message: object): Promise<void> {
    if (!(await this.ensureConnected()) || !this.publisher) return;
    await this.publisher
      .publish(
        EVENT_CHANNEL,
        JSON.stringify({ source: this.instanceId, roomId, message }),
      )
      .catch((error) => this.logRedisFailure("publish", error));
  }

  async getController(roomId: string): Promise<string | null> {
    if (await this.ensureConnected()) {
      const value = await this.publisher
        ?.get(`${KEY_PREFIX}:controller:${roomId}`)
        .catch((error) => {
          this.logRedisFailure("get_controller", error);
          return undefined;
        });
      if (value !== undefined) return value;
    }
    return this.localControllers.get(roomId) ?? null;
  }

  async setController(roomId: string, userId: string | null): Promise<void> {
    if (userId) this.localControllers.set(roomId, userId);
    else this.localControllers.delete(roomId);
    if (!(await this.ensureConnected()) || !this.publisher) return;
    const key = `${KEY_PREFIX}:controller:${roomId}`;
    const operation = userId
      ? this.publisher.set(key, userId, { EX: STATE_TTL_SECONDS })
      : this.publisher.del(key);
    await operation.catch((error) =>
      this.logRedisFailure("set_controller", error),
    );
  }

  async listRequests(roomId: string): Promise<CollabControlRequest[]> {
    if (await this.ensureConnected()) {
      const values = await this.publisher
        ?.hVals(`${KEY_PREFIX}:requests:${roomId}`)
        .catch((error) => {
          this.logRedisFailure("list_requests", error);
          return null;
        });
      if (values) {
        return values
          .flatMap((value) => this.parse<CollabControlRequest>(value) ?? [])
          .sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
      }
    }
    return Array.from(this.localRequests.get(roomId)?.values() ?? []).sort(
      (a, b) => a.requestedAt.localeCompare(b.requestedAt),
    );
  }

  async upsertRequest(
    roomId: string,
    request: CollabControlRequest,
  ): Promise<void> {
    let requests = this.localRequests.get(roomId);
    if (!requests) {
      requests = new Map();
      this.localRequests.set(roomId, requests);
    }
    requests.set(request.userId, request);
    if (!(await this.ensureConnected()) || !this.publisher) return;
    const key = `${KEY_PREFIX}:requests:${roomId}`;
    await this.publisher
      .multi()
      .hSet(key, request.userId, JSON.stringify(request))
      .expire(key, STATE_TTL_SECONDS)
      .exec()
      .catch((error) => this.logRedisFailure("upsert_request", error));
  }

  async removeRequest(roomId: string, userId: string): Promise<void> {
    const requests = this.localRequests.get(roomId);
    requests?.delete(userId);
    if (requests?.size === 0) this.localRequests.delete(roomId);
    if (!(await this.ensureConnected()) || !this.publisher) return;
    await this.publisher
      .hDel(`${KEY_PREFIX}:requests:${roomId}`, userId)
      .catch((error) => this.logRedisFailure("remove_request", error));
  }

  async clearRequests(roomId: string): Promise<void> {
    this.localRequests.delete(roomId);
    if (!(await this.ensureConnected()) || !this.publisher) return;
    await this.publisher
      .del(`${KEY_PREFIX}:requests:${roomId}`)
      .catch((error) => this.logRedisFailure("clear_requests", error));
  }

  async updatePresence(
    roomId: string,
    users: Array<{ userId: string; username: string }>,
  ): Promise<void> {
    if (!(await this.ensureConnected()) || !this.publisher) return;
    const key = `${KEY_PREFIX}:presence:${roomId}`;
    const previous = this.presenceMembers.get(roomId) ?? new Set<string>();
    const expiresAt = Date.now() + PRESENCE_TTL_MS;
    const current = new Set(
      users.map((user) =>
        JSON.stringify({
          instanceId: this.instanceId,
          ...user,
        } satisfies PresenceEntry),
      ),
    );
    const transaction = this.publisher.multi();
    if (previous.size > 0) transaction.zRem(key, Array.from(previous));
    for (const member of current) {
      transaction.zAdd(key, { score: expiresAt, value: member });
    }
    transaction.expire(key, Math.ceil(PRESENCE_TTL_MS / 1000) * 2);
    await transaction
      .exec()
      .then(() => {
        if (current.size > 0) this.presenceMembers.set(roomId, current);
        else this.presenceMembers.delete(roomId);
      })
      .catch((error) => this.logRedisFailure("update_presence", error));
  }

  async onlineUsers(
    roomId: string,
    localUsers: Array<{ userId: string; username: string }>,
  ): Promise<Array<{ userId: string; username: string }>> {
    if (!(await this.ensureConnected()) || !this.publisher) return localUsers;
    const key = `${KEY_PREFIX}:presence:${roomId}`;
    const now = Date.now();
    const transaction = this.publisher
      .multi()
      .zRemRangeByScore(key, 0, now)
      .zRangeByScore(key, now + 1, "+inf");
    const result = await transaction.exec().catch((error) => {
      this.logRedisFailure("online_users", error);
      return null;
    });
    const members = result?.[1] as string[] | undefined;
    if (!members) return localUsers;
    const seen = new Map<string, string>();
    for (const member of members) {
      const entry = this.parse<PresenceEntry>(member);
      if (entry) seen.set(entry.userId, entry.username);
    }
    return Array.from(seen, ([userId, username]) => ({ userId, username }));
  }

  async close(): Promise<void> {
    await Promise.allSettled([
      this.publisher?.isOpen ? this.publisher.quit() : Promise.resolve(),
      this.subscriber?.isOpen ? this.subscriber.quit() : Promise.resolve(),
    ]);
    this.publisher = null;
    this.subscriber = null;
  }

  private async ensureConnected(): Promise<boolean> {
    const url = process.env.REDIS_URL?.trim();
    if (!url) return false;
    if (this.publisher?.isReady && this.subscriber?.isReady) return true;
    if (Date.now() < this.nextConnectAttempt) return false;
    if (this.connecting) return this.connecting;
    this.connecting = this.connect(url).finally(() => {
      this.connecting = null;
    });
    return this.connecting;
  }

  private async connect(url: string): Promise<boolean> {
    try {
      this.publisher = createClient({
        url,
        socket: { connectTimeout: 1500, reconnectStrategy: false },
      });
      this.subscriber = this.publisher.duplicate();
      this.publisher.on("error", (error) =>
        this.logRedisFailure("client", error),
      );
      this.subscriber.on("error", (error) =>
        this.logRedisFailure("subscriber", error),
      );
      await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
      await this.subscriber.subscribe(EVENT_CHANNEL, (raw) => {
        const envelope = this.parse<EventEnvelope>(raw);
        if (
          !envelope ||
          typeof envelope.source !== "string" ||
          typeof envelope.roomId !== "string" ||
          !envelope.message ||
          typeof envelope.message !== "object" ||
          envelope.source === this.instanceId
        ) {
          return;
        }
        for (const listener of this.eventListeners) {
          try {
            listener(envelope.roomId, envelope.message);
          } catch (error) {
            this.logRedisFailure("event_listener", error);
          }
        }
      });
      sshLogger.info("Collaboration Redis runtime connected", {
        operation: "collab_redis_connected",
      });
      this.nextConnectAttempt = 0;
      return true;
    } catch (error) {
      this.nextConnectAttempt = Date.now() + CONNECT_RETRY_MS;
      this.logRedisFailure("connect", error);
      await Promise.allSettled([
        this.publisher?.disconnect(),
        this.subscriber?.disconnect(),
      ]);
      this.publisher = null;
      this.subscriber = null;
      return false;
    }
  }

  private parse<T>(value: string): T | null {
    try {
      return JSON.parse(value) as T;
    } catch {
      return null;
    }
  }

  private logRedisFailure(operation: string, error: unknown): void {
    sshLogger.warn(
      "Collaboration Redis runtime unavailable; using local state",
      {
        operation: `collab_redis_${operation}`,
        error: error instanceof Error ? error.message : String(error),
      },
    );
  }
}

export const collabRuntimeStore = new CollabRuntimeStore();
