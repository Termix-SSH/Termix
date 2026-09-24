import type { TermixGuacMeta } from "./token-service.js";

export interface RemoteSession {
  guacamoleConnectionId: string;
  termixConnectId: string;
  hostId: number;
  hostName: string;
  ownerUserId: string;
  protocol: TermixGuacMeta["protocol"];
  tabInstanceId: string | null;
  openedAt: number;
}

type Cleanup = () => void;

/** How long a minted token's tunnel waits for guacd to connect through it. */
export const PENDING_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Live guacd sessions and what each one holds open.
 *
 * A connect request builds its jump tunnel or VNC proxy before guacd dials
 * in, so those resources are parked under the request's connect id and move
 * onto the session when it opens. They are released when the session
 * closes, when guacd never shows up, or when the plugin stops.
 */
export class RemoteSessions {
  private readonly pending = new Map<
    string,
    { cleanups: Cleanup[]; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly byConnectId = new Map<string, RemoteSession>();
  private readonly byGuacamoleId = new Map<string, RemoteSession>();
  private readonly cleanupsByConnectId = new Map<string, Cleanup[]>();

  constructor(private readonly pendingTimeoutMs = PENDING_TIMEOUT_MS) {}

  /** Resources for a connection that guacd has not opened yet. */
  park(termixConnectId: string, cleanups: Cleanup[]): void {
    if (cleanups.length === 0) return;
    const timer = setTimeout(() => {
      this.pending.delete(termixConnectId);
      run(cleanups);
    }, this.pendingTimeoutMs);
    timer.unref?.();
    this.pending.set(termixConnectId, { cleanups, timer });
  }

  opened(
    meta: TermixGuacMeta,
    guacamoleConnectionId: string,
    extra: Cleanup[] = [],
  ): RemoteSession {
    const session: RemoteSession = {
      guacamoleConnectionId,
      termixConnectId: meta.termixConnectId,
      hostId: meta.hostId,
      hostName: meta.hostName,
      ownerUserId: meta.ownerUserId,
      protocol: meta.protocol,
      tabInstanceId: meta.tabInstanceId ?? null,
      openedAt: Date.now(),
    };
    const parked = this.pending.get(meta.termixConnectId);
    if (parked) {
      clearTimeout(parked.timer);
      this.pending.delete(meta.termixConnectId);
    }
    this.cleanupsByConnectId.set(meta.termixConnectId, [
      ...(parked?.cleanups ?? []),
      ...extra,
    ]);
    this.byConnectId.set(meta.termixConnectId, session);
    this.byGuacamoleId.set(guacamoleConnectionId, session);
    return session;
  }

  closed(termixConnectId: string): void {
    const session = this.byConnectId.get(termixConnectId);
    if (session) this.byGuacamoleId.delete(session.guacamoleConnectionId);
    this.byConnectId.delete(termixConnectId);
    run(this.cleanupsByConnectId.get(termixConnectId) ?? []);
    this.cleanupsByConnectId.delete(termixConnectId);
  }

  byConnect(termixConnectId: string): RemoteSession | null {
    return this.byConnectId.get(termixConnectId) ?? null;
  }

  byGuacamole(guacamoleConnectionId: string): RemoteSession | null {
    return this.byGuacamoleId.get(guacamoleConnectionId) ?? null;
  }

  /** Releases everything, for deactivate. */
  clear(): void {
    for (const { cleanups, timer } of this.pending.values()) {
      clearTimeout(timer);
      run(cleanups);
    }
    this.pending.clear();
    for (const cleanups of this.cleanupsByConnectId.values()) run(cleanups);
    this.cleanupsByConnectId.clear();
    this.byConnectId.clear();
    this.byGuacamoleId.clear();
  }
}

function run(cleanups: Cleanup[]): void {
  for (const cleanup of cleanups) {
    try {
      cleanup();
    } catch {
      // One failed close must not keep the rest open.
    }
  }
}
