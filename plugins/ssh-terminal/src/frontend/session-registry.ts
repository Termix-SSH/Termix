import type { TerminalHandle } from "@/features/terminal/terminal-types";

export interface TerminalSessionInfo {
  id: string;
  hostId: number | null;
  hostName?: string;
  ip?: string;
  username?: string;
  port?: number;
}

interface Session extends TerminalSessionInfo {
  ref: TerminalHandle;
}

const sessions = new Map<string, Session>();
let activeId: string | null = null;

/** Called by the terminal tab wrapper on mount/unmount and focus change. */
export function registerSession(
  info: TerminalSessionInfo,
  ref: TerminalHandle,
): () => void {
  sessions.set(info.id, { ...info, ref });
  return () => {
    sessions.delete(info.id);
    if (activeId === info.id) activeId = null;
  };
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
