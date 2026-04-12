import { type Client, type ClientChannel } from "ssh2";
import { WebSocket } from "ws";
import { sshLogger } from "../utils/logger.js";
import { getDb } from "../database/db/index.js";

const MAX_BUFFER_BYTES = 512 * 1024;
const DEFAULT_TIMEOUT_MINUTES = 30;
const HEALTH_CHECK_INTERVAL_MS = 60_000;
const MAX_SESSIONS_PER_USER = 10;

export interface TerminalSession {
  id: string;
  userId: string;
  hostId: number;
  hostName: string;
  tabInstanceId?: string;
  attachedTabInstanceId?: string;

  sshConn: Client | null;
  sshStream: ClientChannel | null;
  jumpClient: Client | null;

  cols: number;
  rows: number;
  isConnected: boolean;
  createdAt: number;

  attachedWs: WebSocket | null;
  lastDetachedAt: number | null;
  detachTimeout: NodeJS.Timeout | null;

  outputBuffer: string[];
  outputBufferBytes: number;
  tmuxSessionName: string | null;
}

class TerminalSessionManager {
  private static instance: TerminalSessionManager;
  private sessions = new Map<string, TerminalSession>();
  private healthCheckTimer: NodeJS.Timeout | null = null;

  private constructor() {
    this.healthCheckTimer = setInterval(
      () => this.healthCheck(),
      HEALTH_CHECK_INTERVAL_MS,
    );
  }

  static getInstance(): TerminalSessionManager {
    if (!TerminalSessionManager.instance) {
      TerminalSessionManager.instance = new TerminalSessionManager();
    }
    return TerminalSessionManager.instance;
  }

  createSession(
    userId: string,
    hostId: number,
    hostName: string,
    cols: number,
    rows: number,
    tabInstanceId?: string,
  ): string {
    const userSessions = this.getUserSessions(userId);
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      const detached = userSessions
        .filter((s) => s.attachedWs === null)
        .sort(
          (a, b) =>
            (a.lastDetachedAt ?? a.createdAt) -
            (b.lastDetachedAt ?? b.createdAt),
        );
      if (detached.length > 0) {
        this.destroySession(detached[0].id);
      }
    }

    if (tabInstanceId) {
      const tabSessions = userSessions.filter(
        (s) => s.tabInstanceId === tabInstanceId,
      );
      if (tabSessions.length > 0) {
        sshLogger.warn("Tab instance already has session, destroying old", {
          operation: "session_tab_duplicate_cleanup",
          existingSessionId: tabSessions[0].id,
          tabInstanceId,
        });
        this.destroySession(tabSessions[0].id);
      }
    }

    const id = crypto.randomUUID();
    const session: TerminalSession = {
      id,
      userId,
      hostId,
      hostName,
      tabInstanceId,
      sshConn: null,
      sshStream: null,
      jumpClient: null,
      cols,
      rows,
      isConnected: false,
      createdAt: Date.now(),
      attachedWs: null,
      lastDetachedAt: null,
      detachTimeout: null,
      outputBuffer: [],
      outputBufferBytes: 0,
      tmuxSessionName: null,
    };
    this.sessions.set(id, session);

    sshLogger.info("Terminal session created", {
      operation: "session_created",
      sessionId: id,
      userId,
      hostId,
    });

    return id;
  }

  getSession(sessionId: string | null): TerminalSession | null {
    if (!sessionId) return null;
    return this.sessions.get(sessionId) ?? null;
  }

  setSSHState(
    sessionId: string,
    conn: Client,
    stream: ClientChannel,
    jumpClient?: Client | null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.sshConn = conn;
    session.sshStream = stream;
    session.jumpClient = jumpClient ?? null;
    session.isConnected = true;
  }

  attachWs(
    sessionId: string,
    userId: string,
    ws: WebSocket,
    tabInstanceId?: string,
  ): TerminalSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      sshLogger.warn("Session not found for attachment", {
        operation: "session_attach_not_found",
        sessionId,
        userId,
      });
      return null;
    }
    if (session.userId !== userId) {
      sshLogger.warn("Session userId mismatch", {
        operation: "session_attach_user_mismatch",
        sessionId,
        expectedUserId: session.userId,
        providedUserId: userId,
      });
      return null;
    }
    if (!session.isConnected) {
      sshLogger.warn("Session not connected", {
        operation: "session_attach_not_connected",
        sessionId,
        userId,
        createdAt: session.createdAt,
        elapsed: Date.now() - session.createdAt,
      });
      return null;
    }

    const isDetached =
      !session.attachedWs || session.attachedWs.readyState !== WebSocket.OPEN;
    const isOriginalTab = session.tabInstanceId === tabInstanceId;

    if (
      !isDetached &&
      !isOriginalTab &&
      session.tabInstanceId &&
      tabInstanceId
    ) {
      sshLogger.warn("Session actively attached to different tab instance", {
        operation: "session_attach_instance_conflict",
        sessionId,
        sessionInstanceId: session.tabInstanceId,
        providedInstanceId: tabInstanceId,
      });
      try {
        ws.send(
          JSON.stringify({
            type: "sessionExpired",
            sessionId,
            message: "Session belongs to a different tab instance",
          }),
        );
      } catch {
        /* ignore */
      }
      return null;
    }

    if (
      session.tabInstanceId &&
      tabInstanceId &&
      session.tabInstanceId !== tabInstanceId
    ) {
      sshLogger.info(
        "Session attached to different tab instance (split-screen)",
        {
          operation: "session_attach_split_screen",
          originalInstanceId: session.tabInstanceId,
          newInstanceId: tabInstanceId,
          sessionId,
        },
      );
    }

    if (session.attachedWs && session.attachedWs !== ws) {
      try {
        session.attachedWs.send(
          JSON.stringify({
            type: "sessionTakenOver",
            sessionId,
            message: "Session was attached from another tab",
          }),
        );
      } catch {
        /* ignore */
      }
      session.attachedWs = null;
    }

    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    session.attachedWs = ws;
    session.attachedTabInstanceId = tabInstanceId;
    session.lastDetachedAt = null;

    sshLogger.info("WebSocket attached to session", {
      operation: "session_attach",
      sessionId,
      userId,
      tabInstanceId,
    });

    return session;
  }

  detachWs(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    session.attachedWs = null;
    session.lastDetachedAt = Date.now();

    const timeoutMs = this.getTimeoutMs();

    session.detachTimeout = setTimeout(() => {
      sshLogger.info("Session idle timeout expired", {
        operation: "session_idle_timeout",
        sessionId,
        userId: session.userId,
      });
      this.destroySession(sessionId);
    }, timeoutMs);

    sshLogger.info("WebSocket detached from session", {
      operation: "session_detach",
      sessionId,
      userId: session.userId,
      timeoutMinutes: timeoutMs / 60_000,
    });
  }

  destroySession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    if (session.sshStream) {
      try {
        session.sshStream.end();
      } catch {
        /* ignore */
      }
      session.sshStream = null;
    }

    if (session.sshConn) {
      try {
        session.sshConn.end();
      } catch {
        /* ignore */
      }
      session.sshConn = null;
    }

    if (session.jumpClient) {
      try {
        session.jumpClient.end();
      } catch {
        /* ignore */
      }
      session.jumpClient = null;
    }

    session.isConnected = false;
    session.outputBuffer = [];
    session.outputBufferBytes = 0;

    this.sessions.delete(sessionId);

    sshLogger.info("Terminal session destroyed", {
      operation: "session_destroyed",
      sessionId,
      userId: session.userId,
      hostId: session.hostId,
    });
  }

  getUserSessions(userId: string): TerminalSession[] {
    const result: TerminalSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.userId === userId) {
        result.push(session);
      }
    }
    return result;
  }

  bufferOutput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.outputBuffer.push(data);
    session.outputBufferBytes += data.length;

    while (
      session.outputBufferBytes > MAX_BUFFER_BYTES &&
      session.outputBuffer.length > 0
    ) {
      const removed = session.outputBuffer.shift();
      if (removed) session.outputBufferBytes -= removed.length;
    }
  }

  flushBuffer(session: TerminalSession): string | null {
    if (session.outputBuffer.length === 0) return null;
    const data = session.outputBuffer.join("");
    session.outputBuffer = [];
    session.outputBufferBytes = 0;
    return data;
  }

  getBuffer(session: TerminalSession): string | null {
    if (session.outputBuffer.length === 0) return null;
    return session.outputBuffer.join("");
  }

  private getTimeoutMs(): number {
    try {
      const db = getDb();
      const row = db.$client
        .prepare(
          "SELECT value FROM settings WHERE key = 'terminal_session_timeout_minutes'",
        )
        .get() as { value: string } | undefined;
      if (row) {
        const minutes = parseInt(row.value, 10);
        if (!isNaN(minutes) && minutes > 0) {
          return minutes * 60_000;
        }
      }
    } catch {
      // DB not available, use default
    }
    return DEFAULT_TIMEOUT_MINUTES * 60_000;
  }

  private healthCheck(): void {
    const toDestroy: string[] = [];
    const now = Date.now();
    const GRACE_PERIOD_MS = 10_000;

    for (const [id, session] of this.sessions) {
      if (!session.isConnected) continue;

      if (
        session.attachedWs &&
        session.attachedWs.readyState === WebSocket.OPEN
      ) {
        continue;
      }

      if (session.sshStream?.destroyed) {
        const detachedDuration = session.lastDetachedAt
          ? now - session.lastDetachedAt
          : 0;

        if (detachedDuration > GRACE_PERIOD_MS) {
          sshLogger.info(
            "SSH stream destroyed during detach window, cleaning up",
            {
              operation: "session_health_check_stream_destroyed",
              sessionId: id,
              userId: session.userId,
              detachedFor: detachedDuration,
            },
          );
          toDestroy.push(id);
        }
      }

      if (!session.sshConn) {
        toDestroy.push(id);
      }
    }

    for (const id of toDestroy) {
      this.destroySession(id);
    }
  }

  destroyAll(): void {
    for (const id of [...this.sessions.keys()]) {
      this.destroySession(id);
    }
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }
}

export const sessionManager = TerminalSessionManager.getInstance();
