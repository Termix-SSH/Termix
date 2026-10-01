import type { TerminalHandle } from "./terminal/terminal-types";

export interface TerminalSessionInfo {
  id: string;
  hostId: number | null;
  hostName?: string;
  /** The tab's title. */
  label?: string;
  ip?: string;
  username?: string;
  port?: number;
}

interface Session extends TerminalSessionInfo {
  ref: TerminalHandle;
}

const sessions = new Map<string, Session>();
let activeId: string | null = null;
const listeners = new Set<() => void>();
let snapshot: TerminalSessionInfo[] = [];

function notify(): void {
  snapshot = listSessions();
  for (const listener of [...listeners]) listener();
}

/** The open sessions, the same array until one opens or closes. */
export function sessionsSnapshot(): TerminalSessionInfo[] {
  return snapshot;
}

/** Called by the terminal tab wrapper on mount/unmount and focus change. */
export function registerSession(
  info: TerminalSessionInfo,
  ref: TerminalHandle,
): () => void {
  sessions.set(info.id, { ...info, ref });
  notify();
  return () => {
    sessions.delete(info.id);
    if (activeId === info.id) activeId = null;
    notify();
  };
}

/** Called whenever a session opens or closes. Returns the unsubscribe. */
export function subscribeSessions(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The live terminal of a session, for tools that type into several at once. */
export function getSessionHandle(sessionId: string): TerminalHandle | null {
  return sessions.get(sessionId)?.ref ?? null;
}

export function setActiveSession(id: string | null): void {
  activeId = id;
}

export function listSessions(): TerminalSessionInfo[] {
  return [...sessions.values()].map(({ ref: _ref, ...info }) => info);
}

function send(session: Session, text: string, run?: boolean): void {
  if (run) session.ref.sendInput(text + "\r");
  else session.ref.paste(text);
}

export function sendToActive(text: string, opts?: { run?: boolean }): boolean {
  if (!activeId) return false;
  const session = sessions.get(activeId);
  if (!session) return false;
  send(session, text, opts?.run);
  return true;
}

export function sendToSession(
  sessionId: string,
  text: string,
  opts?: { run?: boolean },
): boolean {
  const session = sessions.get(sessionId);
  if (!session) return false;
  send(session, text, opts?.run);
  return true;
}
