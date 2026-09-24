import type { Router } from "express";
import type { PluginContext } from "@termix/plugin-sdk/backend";
import { createTerminalLogger } from "./helpers.js";
import { hostImportNormalizer } from "./host-import.js";
import { createHistoryRepository } from "./history-repository.js";
import { registerTerminalRoutes } from "./routes.js";
import {
  DEFAULT_TIMEOUT_MINUTES,
  TerminalSessionManager,
  type TerminalSession,
} from "./session-manager.js";
import {
  SESSION_GUESTS_KEY,
  type LiveSessionInfo,
  type LiveSessionsV1,
  type RecordingsWriterV1,
  type SessionGuestsV1,
  type SessionSharingV1,
  type TerminalHistoryV1,
  type TmuxSessionsV1,
} from "./services.js";
import { ADMIN_KEYS } from "./settings.js";
import { commandHistory } from "./tables.js";
import { createTerminalSocket } from "./terminal-socket.js";

function toInfo(session: TerminalSession): LiveSessionInfo {
  return {
    id: session.id,
    userId: session.userId,
    hostId: session.hostId,
    hostName: session.hostName,
    isConnected: session.isConnected,
    createdAt: session.createdAt,
    lastDetachedAt: session.lastDetachedAt,
    tabInstanceId:
      session.attachedTabInstanceId ?? session.tabInstanceId ?? null,
    tmuxSessionName: session.tmuxSessionName,
    cols: session.cols,
    rows: session.rows,
  };
}

/**
 * A service another plugin may or may not provide. The handle always exists;
 * whether its provider is up is asked through the proxy's `in` check.
 */
function optionalService<T extends object>(
  ctx: PluginContext,
  service: string,
  probe: keyof T & string,
): T | null {
  const handle = ctx.services.get<T>(service);
  return probe in handle ? handle : null;
}

export async function activate(ctx: PluginContext) {
  const log = createTerminalLogger(ctx.log);

  const table = await ctx.db.define(commandHistory);
  const history = createHistoryRepository(ctx.db, table);

  // Read on every detach, so it is kept current rather than awaited there.
  let timeoutMinutes = DEFAULT_TIMEOUT_MINUTES;
  const applyTimeout = (value: unknown) => {
    const minutes = Number(value);
    timeoutMinutes =
      Number.isFinite(minutes) && minutes > 0
        ? minutes
        : DEFAULT_TIMEOUT_MINUTES;
  };
  const refreshTimeout = async () =>
    applyTimeout(await ctx.settings.get(ADMIN_KEYS.sessionTimeoutMinutes));
  await refreshTimeout();
  ctx.settings.onChange(ADMIN_KEYS.sessionTimeoutMinutes, applyTimeout);

  const sessionManager = new TerminalSessionManager({
    log,
    getTimeoutMinutes: () => timeoutMinutes,
    getRecordings: () =>
      optionalService<RecordingsWriterV1>(ctx, "recordings.writer", "open"),
  });
  ctx.disposables.add(() => sessionManager.destroyAll());

  const socket = createTerminalSocket({
    ctx,
    log,
    sessionManager,
    getTmux: () =>
      optionalService<TmuxSessionsV1>(ctx, "tmux.sessions", "detect"),
    getSharing: () =>
      optionalService<SessionSharingV1>(
        ctx,
        "sessions.sharing",
        "authorizeJoin",
      ),
    getGuests: () =>
      ctx.registry.consume<SessionGuestsV1>(SESSION_GUESTS_KEY) ?? null,
  });

  // Public with optional auth: a share-link guest arrives with a share token
  // instead of a session, so that check happens where the token is understood.
  ctx.ws.route(
    "/terminal",
    (connection) => {
      // Also picks up a value the boot migration wrote after activation.
      void refreshTimeout().catch(() => {});
      return socket.handleConnection(connection);
    },
    {
      public: true,
      optionalAuth: true,
    },
  );
  ctx.disposables.add(() => socket.closeAll());

  registerTerminalRoutes(ctx.http.router<Router>({ rawBody: true }), {
    ctx,
    log,
    sessionManager,
    history,
  });

  const liveSessions: LiveSessionsV1 = {
    getSession: (sessionId) => {
      const session = sessionManager.getSession(sessionId);
      return session ? toInfo(session) : null;
    },
    listForUser: (userId) => {
      // A plugin caller only ever sees its actor's sessions; core calls this
      // outside any actor, for the user its own route authenticated.
      const actor = ctx.currentActor();
      if (actor && actor !== userId) return [];
      return sessionManager.getUserSessions(userId).map(toInfo);
    },
    ownerEndSession: (sessionId, reason) =>
      sessionManager.ownerEndSession(sessionId, reason),
    disconnectParticipants: (sessionId, shareId, options) =>
      sessionManager.disconnectShareParticipants(sessionId, shareId, options),
    setRoomShareControl: (sessionId, shareId, controllerUserId) =>
      sessionManager.setRoomShareControl(sessionId, shareId, controllerUserId),
    subscribe: (sessionId, onData) => {
      const session = sessionManager.getSession(sessionId);
      if (!session) return () => {};
      session.dataListeners.add(onData);
      return () => session.dataListeners.delete(onData);
    },
    write: (sessionId, data) => {
      const session = sessionManager.getSession(sessionId);
      if (!session?.sshStream || session.sshStream.destroyed) return false;
      sessionManager.bufferInput(sessionId, data);
      session.sshStream.write(data);
      return true;
    },
    idleTimeoutMinutes: () => timeoutMinutes,
  };
  ctx.services.provide("sessions.live", liveSessions);

  const terminalHistory: TerminalHistoryV1 = {
    list: async (hostId, limit = 200) => {
      const userId = ctx.currentActor();
      if (!userId) return [];
      return history.listCommandsForHost(userId, hostId, limit);
    },
  };
  ctx.services.provide("terminal.history", terminalHistory);

  ctx.registry.provide(
    "ssh-terminal.hostImportNormalizer",
    hostImportNormalizer,
  );

  ctx.log.info("SSH terminal mounted at /plugin-ws/ssh-terminal/terminal");
}

export async function deactivate() {
  // Everything above was registered through ctx and is disposed by core.
}
