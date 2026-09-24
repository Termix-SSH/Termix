import type { PluginContext } from "@termix/plugin-sdk/backend";
import type { LiveProtocol } from "./repositories.js";

export const LIVE_SESSIONS_SERVICE = "sessions.live";

/** What every sessions.live provider reports about one session. */
export interface LiveSessionInfo {
  id: string;
  userId: string;
  hostId: number;
  hostName: string;
  isConnected: boolean;
  createdAt: number;
  tabInstanceId: string | null;
}

/**
 * sessions.live v1, keyed by session type. ssh-terminal provides "ssh";
 * remote-desktop provides "rdp", "vnc" and "telnet". Through a service handle
 * every method answers with a promise. The control methods are the terminal's
 * (a remote desktop viewer cannot be kicked or handed control), and
 * createViewerToken is remote desktop's: a join token for a viewer.
 */
export interface LiveSessionProvider {
  getSession: (sessionId: string) => LiveSessionInfo | null;
  ownerEndSession?: (sessionId: string, reason: string) => void;
  disconnectParticipants?: (
    sessionId: string,
    shareId: string,
    options: { reason: string; userId?: string | null },
  ) => number;
  setRoomShareControl?: (
    sessionId: string,
    shareId: string,
    controllerUserId: string | null,
  ) => void;
  createViewerToken?: (sessionId: string, readOnly: boolean) => string;
}

type Async<T> = {
  [K in keyof T]-?: T[K] extends ((...args: infer A) => infer R) | undefined
    ? (...args: A) => Promise<R>
    : never;
};

export type LiveSessions = ReturnType<typeof createLiveSessions>;

/**
 * Reaches live sessions through sessions.live as the acting user. A caller
 * with no actor (a public guest route) passes the share owner, who owns the
 * session being looked at.
 */
export function createLiveSessions(ctx: PluginContext) {
  async function run<T>(
    asUser: string | undefined,
    fn: () => Promise<T>,
  ): Promise<T> {
    if (asUser && ctx.currentActor() !== asUser) {
      return ctx.asUser(asUser, fn);
    }
    return fn();
  }

  function provider(protocol: string): Async<LiveSessionProvider> | null {
    const handle = ctx.services.get<Async<LiveSessionProvider>>(
      LIVE_SESSIONS_SERVICE,
      { provider: protocol },
    );
    return "getSession" in handle ? handle : null;
  }

  async function getSession(
    protocol: string,
    sessionId: string,
    asUser?: string,
  ): Promise<LiveSessionInfo | null> {
    const live = provider(protocol);
    if (!live) return null;
    try {
      return (await run(asUser, () => live.getSession(sessionId))) ?? null;
    } catch {
      return null;
    }
  }

  return {
    getSession,

    async isLive(
      protocol: string,
      sessionId: string,
      asUser?: string,
    ): Promise<boolean> {
      const session = await getSession(protocol, sessionId, asUser);
      return !!session?.isConnected;
    },

    async isOwnedBy(
      protocol: LiveProtocol,
      sessionId: string,
      userId: string,
    ): Promise<boolean> {
      const session = await getSession(protocol, sessionId);
      return !!session && session.isConnected && session.userId === userId;
    },

    /** Ends the session for every guest. Best effort, like before. */
    async ownerEndSession(
      protocol: string,
      sessionId: string,
      reason: string,
      asUser?: string,
    ): Promise<void> {
      const live = provider(protocol);
      if (!live || !("ownerEndSession" in live)) return;
      await run(asUser, () => live.ownerEndSession(sessionId, reason)).catch(
        () => {},
      );
    },

    async disconnectParticipants(
      protocol: string,
      sessionId: string,
      shareId: string,
      options: { reason: string; userId?: string | null },
      asUser?: string,
    ): Promise<void> {
      const live = provider(protocol);
      if (!live || !("disconnectParticipants" in live)) return;
      await run(asUser, () =>
        live.disconnectParticipants(sessionId, shareId, options),
      ).catch(() => {});
    },

    async setRoomShareControl(
      protocol: string,
      sessionId: string,
      shareId: string,
      controllerUserId: string | null,
      asUser?: string,
    ): Promise<void> {
      const live = provider(protocol);
      if (!live || !("setRoomShareControl" in live)) return;
      await run(asUser, () =>
        live.setRoomShareControl(sessionId, shareId, controllerUserId),
      ).catch(() => {});
    },

    /** A viewer token for a remote desktop session. Throws while unavailable. */
    async createViewerToken(
      protocol: string,
      sessionId: string,
      readOnly: boolean,
      asUser?: string,
    ): Promise<string> {
      const live = provider(protocol);
      if (!live || !("createViewerToken" in live)) {
        throw new Error(`No ${protocol} session provider is running`);
      }
      return run(asUser, () => live.createViewerToken(sessionId, readOnly));
    },
  };
}

/**
 * Whether sessions on a host may be shared: the admin switch first, then the
 * host's own setting. Both default to on. A host that does not exist cannot
 * be shared.
 */
export async function isSharingEnabledForHost(
  ctx: PluginContext,
  hostExists: (hostId: number) => Promise<boolean>,
  hostId: number,
): Promise<boolean> {
  if ((await ctx.settings.get<boolean>("globallyEnabled")) === false) {
    return false;
  }
  if (!(await hostExists(hostId))) return false;
  return (
    (await ctx.settings.getHost<boolean>(hostId, "allowSessionSharing")) !==
    false
  );
}
