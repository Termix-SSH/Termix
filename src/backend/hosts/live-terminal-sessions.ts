/**
 * What core needs from live SSH terminal sessions, through the plugin
 * service "sessions.live" (the "ssh" provider) rather than an import.
 *
 * The open-tabs route lists the caller's sessions and ties saved tabs to the
 * terminal's idle timeout. With no provider (the terminal is off) a lookup
 * finds nothing, because "no live session" and "the terminal is off" mean the
 * same thing there.
 */

import { getServiceImplementation } from "../plugins/service-registry.js";

const LIVE_SESSIONS_SERVICE = "sessions.live";
const SSH_PROVIDER = "ssh";

export interface LiveSessionInfo {
  id: string;
  userId: string;
  hostId: number;
  hostName: string;
  isConnected: boolean;
  createdAt: number;
  lastDetachedAt: number | null;
  tabInstanceId: string | null;
  cols: number;
  rows: number;
}

// The terminal runs in its own process, so these come back as Promises.
interface LiveSessionsV1 {
  listForUser: (
    userId: string,
  ) => LiveSessionInfo[] | Promise<LiveSessionInfo[]>;
  idleTimeoutMinutes: () => number | Promise<number>;
}

function provider(): LiveSessionsV1 | undefined {
  return getServiceImplementation<LiveSessionsV1>(
    LIVE_SESSIONS_SERVICE,
    "^1.0.0",
    SSH_PROVIDER,
  );
}

export const liveTerminalSessions = {
  async listForUser(userId: string): Promise<LiveSessionInfo[]> {
    const list = await provider()?.listForUser(userId);
    return Array.isArray(list) ? list : [];
  },
  /** How long the terminal keeps a detached session, or null while it is off. */
  async idleTimeoutMinutes(): Promise<number | null> {
    const minutes = await provider()?.idleTimeoutMinutes();
    return typeof minutes === "number" ? minutes : null;
  },
};
