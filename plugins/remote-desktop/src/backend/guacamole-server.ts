import GuacamoleLite from "guacamole-lite";
import fs from "fs";
import path from "path";
import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import type {
  GuacamoleRecordingMetadata,
  GuacamoleTokenService,
  TermixGuacMeta,
} from "./token-service.js";
import type { GuacdOptions } from "./guacd-config.js";
import type { RemoteSessions } from "./sessions.js";
import { errorMessage, type RemoteDesktopLogger } from "./log.js";

/** The recordings.writer service, when the session-recording plugin provides it. */
export interface RecordingsWriter {
  enabledFor: (hostId: number) => Promise<boolean>;
  createFinished: (input: {
    hostId: number;
    userId: string;
    startedAt: string;
    endedAt: string;
    duration: number | null;
    recordingPath: string;
    protocol: string;
    format: string;
  }) => Promise<{ id: number }>;
}

const DATA_DIR = process.env.DATA_DIR || "./db/data";

/** Where the backend reads guacd's recordings from. */
export function recordingsDir(env: NodeJS.ProcessEnv = process.env): string {
  return (
    env.GUACD_RECORDING_BACKEND_PATH ||
    path.join(DATA_DIR, "session_recordings", "guacamole")
  );
}

type ClientConnection = {
  guacamoleConnectionId?: string;
  connectionSettings?: {
    connection?: { type?: string; join?: string; readOnly?: boolean };
    recording?: GuacamoleRecordingMetadata;
    termixMeta?: TermixGuacMeta;
  };
  close?: () => void;
};

const clientOptions = (
  tokens: GuacamoleTokenService,
  log: RemoteDesktopLogger,
) => ({
  crypt: {
    cypher: "AES-256-CBC",
    key: tokens.getEncryptionKey(),
  },
  log: {
    level: "ERRORS",
    stdLog: (...args: unknown[]) => log.info(args.join(" ")),
    errorLog: (...args: unknown[]) => log.error(args.join(" ")),
  },
  allowedUnencryptedConnectionSettings: {
    rdp: ["width", "height", "dpi"],
    vnc: ["width", "height"],
    telnet: ["width", "height"],
  },
  connectionDefaultSettings: {
    rdp: {
      security: "any",
      "ignore-cert": true,
      "enable-wallpaper": false,
      "enable-font-smoothing": true,
      "enable-desktop-composition": false,
      "disable-audio": false,
      "enable-drive": false,
      "resize-method": "display-update",
      width: 1280,
      height: 720,
      dpi: 96,
      audio: ["audio/L16"],
    },
    vnc: {
      "swap-red-blue": false,
      cursor: "remote",
      width: 1280,
      height: 720,
      // macOS Screen Sharing negotiates its VNC security type over several
      // round trips (RFB type 30 -> 33/36/2/35) and can fail the first
      // attempt; retrying lets guacd's VNC client re-establish instead of
      // guacd giving up immediately (Support#1063).
      autoretry: 2,
    },
    telnet: {
      "terminal-type": "xterm-256color",
    },
  },
});

export interface GuacamoleServerDeps {
  log: RemoteDesktopLogger;
  tokens: GuacamoleTokenService;
  sessions: RemoteSessions;
  guacd: () => GuacdOptions;
  recordings: () => RecordingsWriter | null;
  /** A socket event has no request behind it, so the row is written as the session's user. */
  asUser: <T>(userId: string, fn: () => Promise<T>) => Promise<T>;
  /** Called when a primary session opens; returns what to release on close. */
  onOpen?: (hostId: number) => () => void;
}

export interface GuacamoleServer {
  handleUpgrade: (
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ) => void;
  /** Rebuilds the server so a changed guacd address takes effect. */
  restart: () => void;
  /** Closes a session and everyone watching it. */
  endSession: (guacamoleConnectionId: string) => boolean;
  close: () => void;
}

/**
 * guacamole-lite in noServer mode: core owns the listening socket and hands
 * upgrades from /plugin-ws/remote-desktop/display to its WebSocketServer.
 */
export function createGuacamoleServer(
  deps: GuacamoleServerDeps,
): GuacamoleServer {
  const { log, sessions } = deps;
  let server: GuacamoleLite | null = null;

  const persistRecording = async (connection: ClientConnection) => {
    const recording = connection.connectionSettings?.recording;
    if (!recording) return;

    const dir = recordingsDir();
    const resolvedPath = path.resolve(dir, recording.path);
    if (!resolvedPath.startsWith(`${path.resolve(dir)}${path.sep}`)) return;

    // guacd may flush or rename the recording just after the socket closes.
    for (
      let attempt = 0;
      attempt < 10 && !fs.existsSync(resolvedPath);
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!fs.existsSync(resolvedPath)) {
      log.warn("Guacamole recording file was not found", {
        operation: "guac_recording_missing",
        hostId: recording.hostId,
        path: resolvedPath,
        guacdPath: recording.guacdPath ?? dir,
        hint:
          "guacd writes the recording to guacdPath, the backend reads it from path. " +
          "When guacd runs in its own container these must be the same volume: set " +
          "GUACD_RECORDING_PATH to guacd's mount point and GUACD_RECORDING_BACKEND_PATH to this one.",
      });
      return;
    }

    const writer = await deps.asUser(recording.userId, async () =>
      deps.recordings(),
    );
    if (!writer) {
      log.warn(
        "Session Recording is off; the recording was kept on disk only",
        {
          operation: "guac_recording_no_writer",
          hostId: recording.hostId,
        },
      );
      return;
    }

    const endedAt = new Date();
    const startedAt = new Date(recording.startedAt);
    await deps.asUser(recording.userId, () =>
      writer.createFinished({
        hostId: recording.hostId,
        userId: recording.userId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        duration: Math.max(
          0,
          Math.floor((endedAt.getTime() - startedAt.getTime()) / 1000),
        ),
        recordingPath: resolvedPath,
        protocol: recording.protocol,
        format: "guacamole",
      }),
    );
  };

  const build = (): GuacamoleLite => {
    // guacamole-lite fills in port 8080 unless it sees a server key, and ws
    // refuses a port next to noServer, so the port is cleared explicitly.
    const guacamole = new GuacamoleLite(
      { noServer: true, port: undefined },
      deps.guacd(),
      clientOptions(deps.tokens, log),
    );
    // It also installs its own SIGTERM and SIGINT handlers. Core decides
    // when the process stops and closes this through deactivate instead.
    const handlers = guacamole as unknown as {
      sigTermHandler?: () => void;
      sigIntHandler?: () => void;
    };
    if (handlers.sigTermHandler) {
      process.off("SIGTERM", handlers.sigTermHandler);
    }
    if (handlers.sigIntHandler) {
      process.off("SIGINT", handlers.sigIntHandler);
    }

    guacamole.on("open", (connection: ClientConnection) => {
      const meta = connection.connectionSettings?.termixMeta;
      const guacamoleConnectionId = connection.guacamoleConnectionId;
      const isJoin = !!connection.connectionSettings?.connection?.join;
      if (isJoin || !meta || !guacamoleConnectionId) return;
      const release = deps.onOpen?.(meta.hostId);
      sessions.opened(meta, guacamoleConnectionId, release ? [release] : []);
    });

    guacamole.on("close", (connection: ClientConnection) => {
      const meta = connection.connectionSettings?.termixMeta;
      const isJoin = !!connection.connectionSettings?.connection?.join;
      if (!isJoin && meta) sessions.closed(meta.termixConnectId);
      persistRecording(connection).catch((error) => {
        log.error("Failed to persist Guacamole recording", {
          operation: "guac_recording_persist_error",
          error: errorMessage(error),
        });
      });
    });

    guacamole.on("error", (connection: ClientConnection, error: Error) => {
      log.error("Guacamole connection error", {
        operation: "guac_connection_error",
        type: connection.connectionSettings?.connection?.type,
        error: errorMessage(error),
      });
    });

    return guacamole;
  };

  const closeServer = () => {
    if (!server) return;
    try {
      server.close();
    } catch (error) {
      log.error("Error closing the Guacamole server", {
        error: errorMessage(error),
      });
    }
    server = null;
  };

  server = build();

  return {
    handleUpgrade(request, socket, head) {
      // The route is public, so the token is the only credential: refuse
      // anything forged, edited or expired before guacamole-lite reads it.
      const token = new URL(
        request.url ?? "/",
        "http://localhost",
      ).searchParams.get("token");
      if (!token || !deps.tokens.verifyToken(token)) {
        try {
          socket.write(
            "HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n",
          );
        } catch {
          // The peer may already be gone.
        }
        socket.destroy();
        return;
      }
      const wss = (
        server as unknown as {
          webSocketServer?: {
            handleUpgrade: (
              request: IncomingMessage,
              socket: Duplex,
              head: Buffer,
              done: (ws: unknown) => void,
            ) => void;
            emit: (event: string, ...args: unknown[]) => void;
          };
        } | null
      )?.webSocketServer;
      if (!wss) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    },

    restart() {
      if (!server) return;
      closeServer();
      server = build();
    },

    endSession(guacamoleConnectionId) {
      const active = (
        server as unknown as {
          activeConnections?: Map<unknown, ClientConnection>;
        } | null
      )?.activeConnections;
      if (!active) return false;
      let closed = false;
      for (const connection of [...active.values()]) {
        const join = connection.connectionSettings?.connection?.join;
        if (
          connection.guacamoleConnectionId === guacamoleConnectionId ||
          join === guacamoleConnectionId
        ) {
          connection.close?.();
          closed = true;
        }
      }
      return closed;
    },

    close: closeServer,
  };
}
