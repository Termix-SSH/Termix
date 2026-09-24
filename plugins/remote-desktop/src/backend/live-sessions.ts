import type { GuacamoleTokenService } from "./token-service.js";
import type { RemoteSessions } from "./sessions.js";
import type { RemoteProtocol } from "./host-settings.js";

/** sessions.live v1, as session-sharing reads it (plugins/session-sharing/src/backend/live.ts). */
export interface LiveSessionInfo {
  id: string;
  userId: string;
  hostId: number;
  hostName: string;
  isConnected: boolean;
  createdAt: number;
  tabInstanceId: string | null;
}

export interface RemoteLiveSessions {
  getSession: (sessionId: string) => LiveSessionInfo | null;
  ownerEndSession: (sessionId: string, reason: string) => void;
  createViewerToken: (sessionId: string, readOnly: boolean) => string;
}

/**
 * One provider per protocol. A session id is guacd's own connection id,
 * which is what a viewer's join token names.
 */
export function createLiveSessions(
  protocol: RemoteProtocol,
  deps: {
    sessions: RemoteSessions;
    tokens: GuacamoleTokenService;
    endSession: (guacamoleConnectionId: string) => boolean;
  },
): RemoteLiveSessions {
  const find = (sessionId: string) => {
    const session = deps.sessions.byGuacamole(sessionId);
    return session && session.protocol === protocol ? session : null;
  };

  return {
    getSession(sessionId) {
      const session = find(sessionId);
      if (!session) return null;
      return {
        id: session.guacamoleConnectionId,
        userId: session.ownerUserId,
        hostId: session.hostId,
        hostName: session.hostName,
        isConnected: true,
        createdAt: session.openedAt,
        tabInstanceId: session.tabInstanceId,
      };
    },

    ownerEndSession(sessionId) {
      if (find(sessionId)) deps.endSession(sessionId);
    },

    createViewerToken(sessionId, readOnly) {
      if (!find(sessionId)) {
        throw new Error(`No live ${protocol} session ${sessionId}`);
      }
      return deps.tokens.createJoinToken(sessionId, readOnly);
    },
  };
}
