import { type Client, type ClientChannel } from "ssh2";
import { WebSocket } from "ws";
import { sshLogger } from "../utils/logger.js";
import { getDb } from "../database/db/index.js";

const MAX_BUFFER_BYTES = 512 * 1024; // 512KB
const DEFAULT_TIMEOUT_MINUTES = 30;
const HEALTH_CHECK_INTERVAL_MS = 60_000;
const MAX_SESSIONS_PER_USER = 10;

export interface TerminalSession {
  id: string;
  userId: string;
  hostId: number;
  hostName: string;
  tabInstanceId?: string;

  sshConn: Client | null;
  sshStream: ClientChannel | null;
  jumpClient: Client | null;
  opksshTempFiles: { keyPath: string; certPath: string } | null;

  cols: number;
  rows: number;
  isConnected: boolean;
  createdAt: number;

  attachedWs: WebSocket | null;
  lastDetachedAt: number | null;
  detachTimeout: NodeJS.Timeout | null;

  outputBuffer: string[];
  outputBufferBytes: number;
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
      // Destroy the oldest detached session
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
      opksshTempFiles: null,
      cols,
      rows,
      isConnected: false,
      createdAt: Date.now(),
      attachedWs: null,
      lastDetachedAt: null,
      detachTimeout: null,
      outputBuffer: [],
      outputBufferBytes: 0,
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
    opksshTempFiles?: { keyPath: string; certPath: string } | null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.sshConn = conn;
    session.sshStream = stream;
    session.jumpClient = jumpClient ?? null;
    session.opksshTempFiles = opksshTempFiles ?? null;
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

    // Validate tab instance ownership
    if (
      session.tabInstanceId &&
      tabInstanceId &&
      session.tabInstanceId !== tabInstanceId
    ) {
      sshLogger.warn("Tab instance mismatch", {
        operation: "session_attach_instance_mismatch",
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

    // If another WS is attached, detach it
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

    // Cancel detach timeout
    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    session.attachedWs = ws;
    session.lastDetachedAt = null;

    sshLogger.info("WebSocket attached to session", {
      operation: "session_attach",
      sessionId,
      userId,
    });

    return session;
  }

  detachWs(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Clear any existing detach timeout to prevent leaks on double-detach
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

    if (session.opksshTempFiles) {
      const tempFiles = session.opksshTempFiles;
      session.opksshTempFiles = null;
      this.cleanupOpksshFiles(tempFiles);
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
    // Collect IDs to destroy first to avoid mutating Map during iteration
    const toDestroy: string[] = [];
    for (const [id, session] of this.sessions) {
      if (!session.isConnected) continue;

      if (session.sshConn) {
        if (session.sshStream && session.attachedWs === null) {
          if (session.sshStream.destroyed) {
            sshLogger.info("SSH stream destroyed while detached, cleaning up", {
              operation: "session_health_check",
              sessionId: id,
              userId: session.userId,
            });
            toDestroy.push(id);
          }
        }
      } else {
        toDestroy.push(id);
      }
    }
    for (const id of toDestroy) {
      this.destroySession(id);
    }
  }

  private async cleanupOpksshFiles(tempFiles: {
    keyPath: string;
    certPath: string;
  }): Promise<void> {
    try {
      const { promises: fs } = await import("fs");
      const results = await Promise.allSettled([
        fs.unlink(tempFiles.keyPath),
        fs.unlink(tempFiles.certPath),
      ]);
      results.forEach((result, index) => {
        if (result.status === "rejected") {
          sshLogger.warn("Failed to cleanup OPKSSH temp file", {
            operation: "opkssh_temp_cleanup_failed",
            file: index === 0 ? "keyPath" : "certPath",
          });
        }
      });
    } catch (error) {
      sshLogger.error("Failed to cleanup OPKSSH temp files", {
        operation: "opkssh_temp_cleanup_error",
        error,
      });
    }
  }

  // For testing / shutdown
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
