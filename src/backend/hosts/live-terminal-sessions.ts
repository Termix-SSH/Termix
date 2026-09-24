/**
 * What core needs from live SSH terminal sessions, through the plugin
 * service "sessions.live" rather than an import.
 *
 * Session sharing, collab and the open-tabs route still live in core and
 * reach the sessions the ssh-terminal plugin holds. With no provider (the
 * plugin is off) a lookup finds nothing and a control call does nothing,
 * because "no such live session" and "the terminal is off" mean the same
 * thing to every caller here.
 */

import { getServiceImplementation } from "../plugins/service-registry.js";

export const LIVE_SESSIONS_SERVICE = "sessions.live";

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

interface LiveSessionsV1 {
  getSession: (sessionId: string) => LiveSessionInfo | null;
  listForUser: (userId: string) => LiveSessionInfo[];
  ownerEndSession: (sessionId: string, reason: string) => void;
  disconnectParticipants: (
    sessionId: string,
    shareId: string,
    options: { reason: string; userId?: string | null },
  ) => number;
  setRoomShareControl: (
    sessionId: string,
    shareId: string,
    controllerUserId: string | null,
  ) => void;
  idleTimeoutMinutes: () => number;
}

function provider(): LiveSessionsV1 | undefined {
  return getServiceImplementation<LiveSessionsV1>(
    LIVE_SESSIONS_SERVICE,
    "^1.0.0",
  );
}

export const liveTerminalSessions = {
  getSession(sessionId: string): LiveSessionInfo | null {
    return provider()?.getSession(sessionId) ?? null;
  },
  listForUser(userId: string): LiveSessionInfo[] {
    return provider()?.listForUser(userId) ?? [];
  },
  ownerEndSession(sessionId: string, reason: string): void {
    provider()?.ownerEndSession(sessionId, reason);
  },
  disconnectShareParticipants(
    sessionId: string,
    shareId: string,
    options: { reason: string; userId?: string | null },
  ): number {
    return provider()?.disconnectParticipants(sessionId, shareId, options) ?? 0;
  },
  setRoomShareControl(
    sessionId: string,
    shareId: string,
    controllerUserId: string | null,
  ): void {
    provider()?.setRoomShareControl(sessionId, shareId, controllerUserId);
  },
  /** How long the terminal keeps a detached session, or null while it is off. */
  idleTimeoutMinutes(): number | null {
    return provider()?.idleTimeoutMinutes() ?? null;
  },
};
