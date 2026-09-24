import type { Client, ConnectConfig } from "ssh2";
import type { PluginSchedule } from "@termix/plugin-sdk/backend";
import type { MetricsLogger } from "./log.js";

/** A connection a person opened from the tab, reused by polling. */
export interface MetricsSession {
  client: Client;
  isConnected: boolean;
  lastActive: number;
  activeOperations: number;
  hostId: number;
  userId: string;
  cancelCleanup?: () => void;
}

/** A connection waiting for the TOTP code the person is typing. */
export interface PendingTOTPSession {
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

export interface MetricsViewer {
  sessionId: string;
  userId: string;
  hostId: number;
  lastHeartbeat: number;
}

const IDLE_MS = 30 * 60 * 1000;

export function sessionKey(hostId: number, userId: string): string {
  return `${userId}:${hostId}`;
}

function endQuietly(client: Client): void {
  try {
    client.end();
  } catch {
    // expected
  }
}

/** Interactive connections, owned by one activation of the plugin. */
export class MetricsSessions {
  private readonly sessions = new Map<string, MetricsSession>();
  private readonly pending = new Map<string, PendingTOTPSession>();

  constructor(
    private readonly schedule: PluginSchedule,
    private readonly log: MetricsLogger,
  ) {}

  get(key: string): MetricsSession | undefined {
    return this.sessions.get(key);
  }

  /** Stores a ready connection and closes it after 30 idle minutes. */
  open(key: string, session: Omit<MetricsSession, "cancelCleanup">): void {
    const existing = this.sessions.get(key);
    if (existing && existing.client !== session.client) this.close(key);
    this.sessions.set(key, { ...session });
    this.scheduleCleanup(key);
    session.client.once("close", () => {
      const current = this.sessions.get(key);
      if (current?.client === session.client) {
        current.isConnected = false;
        current.cancelCleanup?.();
        this.sessions.delete(key);
      }
    });
  }

  touch(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    session.lastActive = Date.now();
    this.scheduleCleanup(key);
  }

  /** Closes a session, or waits for the operations still using it. */
  close(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    if (session.activeOperations > 0) {
      this.log.warn(
        `Deferring metrics session cleanup - ${session.activeOperations} active operations`,
        { operation: "cleanup_deferred", sessionKey: key },
      );
      this.scheduleCleanup(key);
      return;
    }
    session.cancelCleanup?.();
    this.sessions.delete(key);
    endQuietly(session.client);
  }

  addPending(session: PendingTOTPSession): void {
    this.pending.set(session.sessionId, session);
  }

  getPending(sessionId: string): PendingTOTPSession | undefined {
    return this.pending.get(sessionId);
  }

  dropPending(sessionId: string, endClient = false): void {
    const session = this.pending.get(sessionId);
    this.pending.delete(sessionId);
    if (session && endClient) endQuietly(session.client);
  }

  dispose(): void {
    for (const key of [...this.sessions.keys()]) {
      const session = this.sessions.get(key)!;
      session.cancelCleanup?.();
      endQuietly(session.client);
    }
    this.sessions.clear();
    for (const session of this.pending.values()) endQuietly(session.client);
    this.pending.clear();
  }

  private scheduleCleanup(key: string): void {
    const session = this.sessions.get(key);
    if (!session) return;
    session.cancelCleanup?.();
    session.cancelCleanup = this.schedule.after(IDLE_MS, () => {
      session.cancelCleanup = undefined;
      this.close(key);
    });
  }
}
