import { randomUUID } from "crypto";
import { type Client, type ClientChannel } from "ssh2";
import { WebSocket } from "ws";
import type { TerminalLogger } from "./helpers.js";
import type { RecordingSink, RecordingsWriterV1 } from "./services.js";

const MAX_BUFFER_BYTES = 512 * 1024;
export const DEFAULT_TIMEOUT_MINUTES = 30;
const HEALTH_CHECK_INTERVAL_MS = 60_000;
const MAX_SESSIONS_PER_USER = 10;
// Coalesces recording writes: a chatty SSH stream can emit dozens of "data"
// events per second, and appending to disk on every single one saturates the
// libuv threadpool (default size 4), starving unrelated fs/DNS/crypto work
// and stalling the WS ping/pong health check enough to look like connection
// drops. Batch pending lines and flush on a short trailing edge instead.
const RECORDING_FLUSH_INTERVAL_MS = 300;

export interface SessionParticipant {
  ws: WebSocket;
  userId: string | null; // null for anonymous link guests
  permissionLevel: "read-write" | "read-only";
  isOwner: boolean;
  displayName?: string;
  guestLabel?: string;
  tabInstanceId?: string;
  joinedViaShareId?: string;
}

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

  participants: Map<string, SessionParticipant>;
  lastDetachedAt: number | null;
  detachTimeout: NodeJS.Timeout | null;

  outputBuffer: string[];
  outputBufferBytes: number;
  /** Output listeners from the sessions.live service. */
  dataListeners: Set<(data: string) => void>;
  /** Resolves once the recordings service answered; null when off. */
  recordingSink: Promise<RecordingSink | null> | null;
  recordingHeader: string | null;
  recordingBytes: number;
  recordingWriteChain: Promise<void>;
  recordingPersistChain: Promise<void>;
  pendingRecordingData: string;
  recordingFlushTimer: NodeJS.Timeout | null;
  tmuxSessionName: string | null;
  sessionLoggingEnabled: boolean;
  sessionStartedAt: number;
  lastPersistedBytes: number;
  terminatedByOwner: boolean;
  terminationReason: string | null;
}

/** Message types a non-owner participant may legally send. */
const NON_OWNER_ALLOWED_MESSAGE_TYPES = new Set([
  "input",
  "ping",
  "disconnect",
]);

/**
 * Server-side gate for whether a participant may send a given WS message
 * type. The owner may send anything; non-owners are limited to input (if
 * read-write), ping, and disconnect. Pure function so read-only enforcement
 * is unit-testable without a real WebSocketServer.
 */
export function isMessageAllowedForParticipant(
  participant: Pick<SessionParticipant, "isOwner" | "permissionLevel"> | null,
  messageType: string,
): boolean {
  if (!participant || participant.isOwner) return true;
  if (!NON_OWNER_ALLOWED_MESSAGE_TYPES.has(messageType)) return false;
  if (messageType === "input" && participant.permissionLevel === "read-only") {
    return false;
  }
  return true;
}

export interface SessionManagerDeps {
  log: TerminalLogger;
  /** Minutes a detached session is kept; read on every detach. */
  getTimeoutMinutes: () => number;
  /** The recordings.writer service, when a plugin provides it. */
  getRecordings: () => RecordingsWriterV1 | null;
}

export class TerminalSessionManager {
  private sessions = new Map<string, TerminalSession>();
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private readonly log: TerminalLogger;

  constructor(private readonly deps: SessionManagerDeps) {
    this.log = deps.log;
    this.healthCheckTimer = setInterval(
      () => this.healthCheck(),
      HEALTH_CHECK_INTERVAL_MS,
    );
  }

  createSession(
    userId: string,
    hostId: number,
    hostName: string,
    cols: number,
    rows: number,
    tabInstanceId?: string,
    sessionLoggingEnabled = true,
  ): string {
    const userSessions = this.getUserSessions(userId);
    if (userSessions.length >= MAX_SESSIONS_PER_USER) {
      const detached = userSessions
        .filter((s) => this.getOwnerParticipant(s) === null)
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
      for (const existing of tabSessions) {
        const isLiveSession =
          existing.isConnected &&
          existing.sshStream != null &&
          !existing.sshStream.destroyed;
        if (isLiveSession) {
          // Don't destroy a live session (even if detached) — the caller should attach instead
          this.log.warn(
            "Tab instance has live session, skipping duplicate create",
            {
              operation: "session_tab_duplicate_skip",
              existingSessionId: existing.id,
              tabInstanceId,
              hasAttachedWs: this.getOwnerParticipant(existing) !== null,
            },
          );
          return existing.id;
        }
        this.log.warn("Tab instance already has session, destroying old", {
          operation: "session_tab_duplicate_cleanup",
          existingSessionId: existing.id,
          tabInstanceId,
        });
        this.destroySession(existing.id);
      }
    }

    const id = randomUUID();
    const now = Date.now();
    let recordingSink: Promise<RecordingSink | null> | null = null;
    let recordingHeader: string | null = null;
    const recordings = sessionLoggingEnabled ? this.deps.getRecordings() : null;
    if (recordings) {
      // Events recorded before this resolves wait in pendingRecordingData.
      recordingSink = Promise.resolve()
        .then(() =>
          recordings.open({
            sessionId: id,
            hostId,
            userId,
            protocol: "ssh",
            format: "asciicast",
            startedAt: now,
          }),
        )
        .catch((err) => {
          this.log.warn("Could not start a session recording", {
            operation: "session_recording_open_error",
            sessionId: id,
            error: err instanceof Error ? err.message : String(err),
          });
          return null;
        });
    }
    if (recordingSink) {
      recordingHeader = `${JSON.stringify({
        version: 2,
        width: cols,
        height: rows,
        timestamp: Math.floor(now / 1000),
        env: { TERM: "xterm-256color", SHELL: "/bin/sh" },
      })}\n`;
    }
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
      createdAt: now,
      participants: new Map(),
      lastDetachedAt: null,
      detachTimeout: null,
      outputBuffer: [],
      outputBufferBytes: 0,
      dataListeners: new Set(),
      recordingSink,
      recordingHeader,
      recordingBytes: 0,
      recordingWriteChain: Promise.resolve(),
      recordingPersistChain: Promise.resolve(),
      pendingRecordingData: "",
      recordingFlushTimer: null,
      tmuxSessionName: null,
      sessionLoggingEnabled: !!recordingSink,
      sessionStartedAt: now,
      lastPersistedBytes: 0,
      terminatedByOwner: false,
      terminationReason: null,
    };
    this.sessions.set(id, session);

    this.log.info("Terminal session created", {
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

  /** Finds the owner's participant entry, if currently attached. */
  private getOwnerParticipant(
    session: TerminalSession,
  ): SessionParticipant | null {
    for (const participant of session.participants.values()) {
      if (participant.isOwner) return participant;
    }
    return null;
  }

  private getOwnerEntry(
    session: TerminalSession,
  ): [string, SessionParticipant] | null {
    for (const entry of session.participants.entries()) {
      if (entry[1].isOwner) return entry;
    }
    return null;
  }

  attachWs(
    sessionId: string,
    userId: string,
    ws: WebSocket,
    tabInstanceId?: string,
  ): TerminalSession | null {
    const session = this.sessions.get(sessionId);
    if (!session) {
      this.log.warn("Session not found for attachment", {
        operation: "session_attach_not_found",
        sessionId,
        userId,
      });
      return null;
    }
    if (session.userId !== userId) {
      this.log.warn("Session userId mismatch", {
        operation: "session_attach_user_mismatch",
        sessionId,
        expectedUserId: session.userId,
        providedUserId: userId,
      });
      return null;
    }
    if (!session.isConnected) {
      this.log.warn("Session not connected", {
        operation: "session_attach_not_connected",
        sessionId,
        userId,
        createdAt: session.createdAt,
        elapsed: Date.now() - session.createdAt,
      });
      return null;
    }

    const ownerParticipant = this.getOwnerParticipant(session);
    const isDetached =
      !ownerParticipant || ownerParticipant.ws.readyState !== WebSocket.OPEN;
    const isOriginalTab =
      (session.attachedTabInstanceId ?? session.tabInstanceId) ===
      tabInstanceId;

    if (
      !isDetached &&
      !isOriginalTab &&
      session.tabInstanceId &&
      tabInstanceId
    ) {
      this.log.warn("Session actively attached to different tab instance", {
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
      this.log.info(
        "Session attached to different tab instance (split-screen)",
        {
          operation: "session_attach_split_screen",
          originalInstanceId: session.tabInstanceId,
          newInstanceId: tabInstanceId,
          sessionId,
        },
      );
    }

    const ownerEntry = this.getOwnerEntry(session);
    if (ownerEntry && ownerEntry[1].ws !== ws) {
      try {
        ownerEntry[1].ws.send(
          JSON.stringify({
            type: "sessionTakenOver",
            sessionId,
            message: "Session was attached from another tab",
          }),
        );
      } catch {
        /* ignore */
      }
      session.participants.delete(ownerEntry[0]);
    }

    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    const participantId = randomUUID();
    session.participants.set(participantId, {
      ws,
      userId,
      permissionLevel: "read-write",
      isOwner: true,
      tabInstanceId,
    });
    session.attachedTabInstanceId = tabInstanceId;
    session.lastDetachedAt = null;
    this.broadcastParticipants(sessionId);

    this.log.info("WebSocket attached to session", {
      operation: "session_attach",
      sessionId,
      userId,
      tabInstanceId,
    });

    return session;
  }

  /**
   * Adds a non-owner participant (in-app share join or anonymous link guest).
   * Purely additive - never evicts the owner or any other participant.
   */
  joinAsParticipant(
    sessionId: string,
    ws: WebSocket,
    opts: {
      userId: string | null;
      permissionLevel: "read-write" | "read-only";
      displayName?: string;
      guestLabel?: string;
      tabInstanceId?: string;
      shareId?: string;
    },
  ): TerminalSession | null {
    const session = this.sessions.get(sessionId);
    if (!session || !session.isConnected) return null;

    const participantId = randomUUID();
    session.participants.set(participantId, {
      ws,
      userId: opts.userId,
      permissionLevel: opts.permissionLevel,
      isOwner: false,
      displayName: opts.displayName,
      guestLabel: opts.guestLabel,
      tabInstanceId: opts.tabInstanceId,
      joinedViaShareId: opts.shareId,
    });
    this.broadcastParticipants(sessionId);

    this.log.info("Participant joined shared session", {
      operation: "session_join_participant",
      sessionId,
      userId: opts.userId,
      permissionLevel: opts.permissionLevel,
      shareId: opts.shareId,
    });

    return session;
  }

  /**
   * Tells everyone in a shared session who is present. Sent on join and
   * leave, and only while someone besides the owner is (or just was) in the
   * room - a solo owner never receives presence traffic.
   */
  private broadcastParticipants(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const participants = Array.from(session.participants.values()).map(
      (participant) => ({
        isOwner: participant.isOwner,
        permissionLevel: participant.permissionLevel,
        label: participant.displayName ?? participant.guestLabel ?? null,
      }),
    );
    if (participants.every((participant) => participant.isOwner)) return;
    this.broadcast(sessionId, { type: "participants", participants });
  }

  /**
   * Grants stage control: participants joined via this share become
   * read-write only while they are the controller. The owner is untouched.
   */
  setRoomShareControl(
    sessionId: string,
    shareId: string,
    controllerUserId: string | null,
  ): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const participant of session.participants.values()) {
      if (participant.isOwner || participant.joinedViaShareId !== shareId)
        continue;
      participant.permissionLevel =
        controllerUserId && participant.userId === controllerUserId
          ? "read-write"
          : "read-only";
    }
  }

  /**
   * Disconnects non-owner participants that joined through one share.
   * Supplying userId narrows the kick to that authenticated user; null targets
   * anonymous guests. Omitting it revokes the share for every participant.
   */
  disconnectShareParticipants(
    sessionId: string,
    shareId: string,
    options: { userId?: string | null; reason: string },
  ): number {
    const session = this.sessions.get(sessionId);
    if (!session) return 0;
    const filterByUser = Object.hasOwn(options, "userId");
    let disconnected = 0;
    for (const [id, participant] of session.participants.entries()) {
      if (
        participant.isOwner ||
        participant.joinedViaShareId !== shareId ||
        (filterByUser && participant.userId !== options.userId)
      ) {
        continue;
      }
      session.participants.delete(id);
      disconnected += 1;
      if (participant.ws.readyState === WebSocket.OPEN) {
        try {
          participant.ws.send(
            JSON.stringify({
              type: "sessionExpired",
              sessionId,
              message: options.reason,
            }),
          );
          participant.ws.close(1008, options.reason);
        } catch {
          participant.ws.terminate();
        }
      }
    }
    if (disconnected > 0) this.broadcastParticipants(sessionId);
    return disconnected;
  }

  /** Fans out a message to every OPEN participant socket; skips closed ones and send failures. */
  broadcast(sessionId: string, message: object): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    const payload = JSON.stringify(message);
    for (const participant of session.participants.values()) {
      if (participant.ws.readyState !== WebSocket.OPEN) continue;
      try {
        participant.ws.send(payload);
      } catch {
        /* ignore individual send failures, keep broadcasting to the rest */
      }
    }
  }

  /** Finds the participant entry (owner or not) for a given socket. */
  getParticipantForWs(
    session: TerminalSession,
    ws: WebSocket,
  ): SessionParticipant | null {
    for (const participant of session.participants.values()) {
      if (participant.ws === ws) return participant;
    }
    return null;
  }

  /**
   * Removes a non-owner participant's socket. No detach timeout or session
   * destruction side effects - a guest leaving must never end the session.
   */
  removeParticipant(sessionId: string, ws: WebSocket): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    for (const [id, participant] of session.participants.entries()) {
      if (participant.ws === ws && !participant.isOwner) {
        session.participants.delete(id);
        this.broadcastParticipants(sessionId);
        this.log.info("Participant left shared session", {
          operation: "session_leave_participant",
          sessionId,
          userId: participant.userId,
        });
        return;
      }
    }
  }

  /** Broadcasts termination to all guests, then destroys the session. */
  ownerEndSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    this.broadcast(sessionId, { type: "sessionTerminatedByOwner", reason });
    session.terminatedByOwner = true;
    session.terminationReason = reason;

    this.log.info("Owner ended shared session", {
      operation: "session_owner_end",
      sessionId,
      reason,
    });

    this.destroySession(sessionId);
  }

  detachWs(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    if (session.detachTimeout) {
      clearTimeout(session.detachTimeout);
      session.detachTimeout = null;
    }

    const ownerEntry = this.getOwnerEntry(session);
    if (ownerEntry) {
      session.participants.delete(ownerEntry[0]);
    }
    session.lastDetachedAt = Date.now();

    // Persist log immediately when the user detaches so it appears right away,
    // regardless of whether the session is later reattached or times out.
    this.maybePersistLog(session);

    const timeoutMs = this.getTimeoutMs();

    session.detachTimeout = setTimeout(() => {
      this.log.info("Session idle timeout expired", {
        operation: "session_idle_timeout",
        sessionId,
        userId: session.userId,
      });
      this.destroySession(sessionId);
    }, timeoutMs);

    this.log.info("WebSocket detached from session", {
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

    this.maybePersistLog(session, true);
    if (session.recordingSink && session.recordingBytes === 0) {
      void session.recordingSink.then((sink) => sink?.discard());
    }
    session.dataListeners.clear();

    for (const participant of session.participants.values()) {
      if (participant.isOwner) continue;
      if (participant.ws.readyState !== WebSocket.OPEN) continue;
      try {
        participant.ws.send(
          JSON.stringify({
            type: "sessionExpired",
            sessionId,
            message: "Session has ended",
          }),
        );
      } catch {
        /* ignore */
      }
    }
    session.participants.clear();

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

    this.log.info("Terminal session destroyed", {
      operation: "session_destroyed",
      sessionId,
      userId: session.userId,
      hostId: session.hostId,
    });
  }

  private maybePersistLog(session: TerminalSession, force = false): void {
    if (!session.sessionLoggingEnabled) return;
    if (session.recordingFlushTimer) {
      clearTimeout(session.recordingFlushTimer);
      session.recordingFlushTimer = null;
      this.flushRecording(session);
    }
    if (session.recordingBytes === 0) return;
    if (!force && session.recordingBytes === session.lastPersistedBytes) return;
    session.lastPersistedBytes = session.recordingBytes;
    session.recordingPersistChain = session.recordingPersistChain
      .then(() => this.persistSessionLog(session))
      .catch((err) => {
        this.log.warn("Failed to persist session log", {
          operation: "session_log_persist_error",
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
  }

  private async persistSessionLog(session: TerminalSession): Promise<void> {
    if (!session.recordingSink) return;
    await session.recordingWriteChain;
    const sink = await session.recordingSink;
    if (!sink) return;
    const endedAt = Date.now();
    const duration = Math.floor((endedAt - session.sessionStartedAt) / 1000);

    try {
      await sink.persist({
        endedAt,
        durationSeconds: duration,
        terminatedByOwner: session.terminatedByOwner,
        terminationReason: session.terminationReason,
      });
    } catch (err) {
      this.log.warn("Failed to insert session recording row", {
        operation: "session_recording_insert_error",
        sessionId: session.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    this.log.info("Session log persisted", {
      operation: "session_log_persisted",
      sessionId: session.id,
      userId: session.userId,
      hostId: session.hostId,
      duration,
      bytes: session.recordingBytes,
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

    for (const listener of session.dataListeners) {
      try {
        listener(data);
      } catch {
        // A listener that throws must not break the session.
      }
    }

    this.recordSessionEvent(session, "o", data);
  }

  bufferInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.recordSessionEvent(session, "i", data);
  }

  bufferResize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.recordSessionEvent(session, "r", `${cols}x${rows}`);
  }

  private recordSessionEvent(
    session: TerminalSession,
    type: "i" | "o" | "r",
    data: string,
  ): void {
    if (!session.sessionLoggingEnabled || !session.recordingSink || !data)
      return;
    const elapsed = (Date.now() - session.sessionStartedAt) / 1000;
    const line = `${JSON.stringify([elapsed, type, data])}\n`;
    session.recordingBytes += Buffer.byteLength(line);
    session.pendingRecordingData += line;

    if (!session.recordingFlushTimer) {
      session.recordingFlushTimer = setTimeout(() => {
        session.recordingFlushTimer = null;
        this.flushRecording(session);
      }, RECORDING_FLUSH_INTERVAL_MS);
    }
  }

  /**
   * Coalesces buffered recording lines into one write, chained so they land
   * in order. Never one write per chunk: that starved the libuv threadpool
   * (issue #1049).
   */
  private flushRecording(session: TerminalSession): void {
    const pendingSink = session.recordingSink;
    if (!pendingSink || !session.pendingRecordingData) return;
    const chunk = session.pendingRecordingData;
    session.pendingRecordingData = "";
    const firstWrite = session.recordingBytes === Buffer.byteLength(chunk);

    session.recordingWriteChain = session.recordingWriteChain
      .then(async () => {
        const sink = await pendingSink;
        if (!sink) return;
        await sink.append(
          firstWrite ? `${session.recordingHeader}${chunk}` : chunk,
        );
      })
      .catch((err) => {
        this.log.warn("Failed to write session recording", {
          operation: "session_recording_write_error",
          sessionId: session.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
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
    const minutes = this.deps.getTimeoutMinutes();
    return (
      (Number.isFinite(minutes) && minutes > 0
        ? minutes
        : DEFAULT_TIMEOUT_MINUTES) * 60_000
    );
  }

  private healthCheck(): void {
    const toDestroy: string[] = [];
    const now = Date.now();
    const GRACE_PERIOD_MS = 10_000;

    for (const [id, session] of this.sessions) {
      if (!session.isConnected) continue;

      const hasOpenParticipant = Array.from(session.participants.values()).some(
        (p) => p.ws.readyState === WebSocket.OPEN,
      );
      if (hasOpenParticipant) {
        continue;
      }

      if (session.sshStream?.destroyed) {
        const detachedDuration = session.lastDetachedAt
          ? now - session.lastDetachedAt
          : 0;

        if (detachedDuration > GRACE_PERIOD_MS) {
          this.log.info(
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
