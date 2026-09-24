/**
 * The services this plugin provides and consumes.
 *
 * Provided: "sessions.live" as its "ssh" provider (live SSH sessions, for
 * session sharing, collab rooms and recording; remote desktop provides the
 * other session types) and "terminal.history" (command history, for the AI
 * assistant). Consumed, all optional: "tmux.sessions" (tmux-monitor),
 * "sessions.sharing" (session-sharing) and "recordings.writer" (B13). The
 * terminal keeps working without any of them: no tmux attach, no shared
 * joins, no recording.
 */

export interface LiveSessionInfo {
  id: string;
  userId: string;
  hostId: number;
  hostName: string;
  isConnected: boolean;
  createdAt: number;
  lastDetachedAt: number | null;
  tabInstanceId: string | null;
  tmuxSessionName: string | null;
  cols: number;
  rows: number;
}

export interface LiveSessionsV1 {
  getSession: (sessionId: string) => LiveSessionInfo | null;
  /** The caller's own sessions. A plugin caller only ever gets its actor's. */
  listForUser: (userId: string) => LiveSessionInfo[];
  /** Tells every guest the owner ended it, then closes the session. */
  ownerEndSession: (sessionId: string, reason: string) => void;
  /** Removes the participants that joined through one share. */
  disconnectParticipants: (
    sessionId: string,
    shareId: string,
    options: { reason: string; userId?: string | null },
  ) => number;
  /** Hands input control of a room share to one member, or back to the owner. */
  setRoomShareControl: (
    sessionId: string,
    shareId: string,
    controllerUserId: string | null,
  ) => void;
  /** Output as it arrives. Returns the unsubscribe. */
  subscribe: (sessionId: string, onData: (data: string) => void) => () => void;
  /** Types into the session. False when it is not live. */
  write: (sessionId: string, data: string) => boolean;
  /** How long a detached session is kept, in minutes. */
  idleTimeoutMinutes: () => number;
}

export interface CommandHistoryEntry {
  command: string;
  executedAt: string;
}

export interface TerminalHistoryV1 {
  /** The acting user's most recent commands on one host, newest first. */
  list: (hostId: number, limit?: number) => Promise<CommandHistoryEntry[]>;
}

export interface TmuxDetection {
  available: boolean;
  sessions: string[];
}

/**
 * What the terminal asks of the tmux plugin. Clients are ssh2 objects. Every
 * method is async to a consumer: a service call goes through the permission
 * check and the audit line first.
 */
export interface TmuxSessionsV1 {
  detect: (client: unknown) => Promise<TmuxDetection>;
  /** Writes the attach (or new-session) command into a shell stream. */
  attachOrCreate: (
    stream: unknown,
    name?: string,
    newName?: string,
  ) => Promise<void>;
  /** Waits for a new session to exist and returns its confirmed name. */
  waitForSession: (client: unknown, name: string) => Promise<string>;
}

export interface SharedSessionRef {
  id: string;
  sessionId: string;
  permissionLevel: "read-write" | "read-only";
}

/** For signed-in members; every call runs as the acting user. */
export interface SessionSharingV1 {
  /** A user share targeting the actor, or a room stage they are a member of. */
  authorizeJoin: (
    shareId: string,
  ) => Promise<{ share: SharedSessionRef; displayName: string } | null>;
  recordJoin: (shareId: string) => Promise<void>;
  /** Joins the socket to a collab room's event fan-out. False when not a member. */
  subscribeRoom: (roomId: string, socket: unknown) => Promise<boolean>;
  unsubscribeRoom: (socket: unknown, roomId?: string) => Promise<void>;
}

/**
 * Guest joins through a share link or a room guest link. A guest has no user,
 * so the per-call RBAC check a service runs cannot apply: the token is the
 * authority. Published on ctx.registry as SESSION_GUESTS_KEY instead.
 */
export interface SessionGuestsV1 {
  resolve: (request: {
    shareToken?: string;
    roomGuestToken?: string;
    clientIp: string;
  }) => Promise<
    { ok: true; share: SharedSessionRef } | { ok: false; reason: string }
  >;
  recordJoin: (shareId: string) => Promise<void>;
}

export const SESSION_GUESTS_KEY = "sessions.sharing.guests";

export interface RecordingSink {
  /** Appends one batch; the first batch starts with the asciicast header. */
  append: (chunk: string) => Promise<void>;
  /** Writes or updates the recording row. */
  persist: (summary: {
    endedAt: number;
    durationSeconds: number;
    terminatedByOwner: boolean;
    terminationReason: string | null;
  }) => Promise<void>;
  /** Nothing was recorded; drop whatever was set up. */
  discard: () => void;
}

export interface RecordingsWriterV1 {
  /** Null when recording is off for this user or host. */
  open: (meta: {
    sessionId: string;
    hostId: number;
    userId: string;
    protocol: "ssh";
    format: "asciicast";
    startedAt: number;
  }) => Promise<RecordingSink | null>;
}
