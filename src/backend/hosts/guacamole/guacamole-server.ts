import GuacamoleLite from "guacamole-lite";
import { guacLogger } from "../../utils/logger.js";
import { GuacamoleTokenService } from "./token-service.js";
import { getCurrentSettingValue } from "../../database/repositories/factory.js";
import { resolveGuacdOptions } from "../../utils/guacd-config.js";
import fs from "fs";
import path from "path";
import { createCurrentSessionRecordingRepository } from "../../database/repositories/factory.js";
import type { GuacamoleRecordingMetadata } from "./token-service.js";

const tokenService = GuacamoleTokenService.getInstance();

function readGuacdOptions(): { host: string; port: number } {
  let dbUrl: string | undefined;
  try {
    dbUrl = getCurrentSettingValue("guac_url") ?? undefined;
  } catch {
    // DB not available yet, use env var defaults
  }
  return resolveGuacdOptions(dbUrl);
}

const GUAC_WS_PORT = 30008;
const DATA_DIR = process.env.DATA_DIR || "./db/data";
const GUACAMOLE_RECORDINGS_DIR =
  process.env.GUACD_RECORDING_BACKEND_PATH ||
  path.join(DATA_DIR, "session_recordings", "guacamole");

type GuacamoleClientConnection = {
  guacamoleConnectionId?: string;
  connectionSettings?: {
    connection?: { type?: string; join?: string; readOnly?: boolean };
    recording?: GuacamoleRecordingMetadata;
    termixMeta?: {
      termixConnectId: string;
      hostId: number;
      ownerUserId: string;
      protocol: string;
    };
  };
};

export interface GuacSessionInfo {
  guacamoleConnectionId: string;
  hostId: number;
  ownerUserId: string;
  protocol: string;
  openedAt: number;
}

// Keyed by termixConnectId (routes.ts's correlation id), populated once the
// primary connection's guacd handshake completes.
const guacSessionByConnectId = new Map<string, GuacSessionInfo>();
// Keyed by guacd's own guacamoleConnectionId, for join-time lookups.
const guacSessionByGuacamoleId = new Map<string, GuacSessionInfo>();
const pendingConnectResolvers = new Map<
  string,
  (info: GuacSessionInfo | null) => void
>();

export function waitForGuacdOpen(
  termixConnectId: string,
  timeoutMs = 10000,
): Promise<GuacSessionInfo | null> {
  const existing = guacSessionByConnectId.get(termixConnectId);
  if (existing) return Promise.resolve(existing);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (info: GuacSessionInfo | null) => {
      if (settled) return;
      settled = true;
      pendingConnectResolvers.delete(termixConnectId);
      resolve(info);
    };

    pendingConnectResolvers.set(termixConnectId, finish);
    setTimeout(() => finish(null), timeoutMs);
  });
}

export function getGuacSessionInfo(
  guacamoleConnectionId: string,
): GuacSessionInfo | null {
  return guacSessionByGuacamoleId.get(guacamoleConnectionId) ?? null;
}

async function persistGuacamoleRecording(
  clientConnection: GuacamoleClientConnection,
): Promise<void> {
  const recording = clientConnection.connectionSettings?.recording;
  if (!recording) return;

  const resolvedPath = path.resolve(GUACAMOLE_RECORDINGS_DIR, recording.path);
  const allowedBase = `${path.resolve(GUACAMOLE_RECORDINGS_DIR)}${path.sep}`;
  if (!resolvedPath.startsWith(allowedBase)) return;

  // guacd may flush/rename the recording just after the websocket closes.
  for (
    let attempt = 0;
    attempt < 10 && !fs.existsSync(resolvedPath);
    attempt++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (!fs.existsSync(resolvedPath)) {
    guacLogger.warn("Guacamole recording file was not found", {
      operation: "guac_recording_missing",
      hostId: recording.hostId,
      path: resolvedPath,
    });
    return;
  }

  const endedAt = new Date();
  const startedAt = new Date(recording.startedAt);
  await createCurrentSessionRecordingRepository().create({
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
  });
}

const websocketOptions = {
  port: GUAC_WS_PORT,
};

const clientOptions = {
  crypt: {
    cypher: "AES-256-CBC",
    key: tokenService.getEncryptionKey(),
  },
  log: {
    level: "ERRORS",
    stdLog: (...args: unknown[]) => {
      guacLogger.info(args.join(" "));
    },
    errorLog: (...args: unknown[]) => {
      guacLogger.error(args.join(" "));
    },
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
      security: "any",
      width: 1280,
      height: 720,
    },
    telnet: {
      "terminal-type": "xterm-256color",
    },
  },
};

const _origConsoleLog = console.log;
console.log = (...args: unknown[]) => {
  const msg = args[0];
  if (typeof msg === "string" && msg.startsWith("New client connection"))
    return;
  _origConsoleLog(...args);
};

function createGuacServer(): GuacamoleLite {
  const guacdOptions = readGuacdOptions();
  const server = new GuacamoleLite(
    websocketOptions,
    guacdOptions,
    clientOptions,
  );

  server.on("open", (clientConnection: GuacamoleClientConnection) => {
    guacLogger.info("Guacamole connection opened", {
      operation: "guac_connection_open",
      type: clientConnection.connectionSettings?.connection?.type,
    });

    const termixMeta = clientConnection.connectionSettings?.termixMeta;
    const guacamoleConnectionId = clientConnection.guacamoleConnectionId;
    const isJoin = !!clientConnection.connectionSettings?.connection?.join;

    if (!isJoin && termixMeta && guacamoleConnectionId) {
      const info: GuacSessionInfo = {
        guacamoleConnectionId,
        hostId: termixMeta.hostId,
        ownerUserId: termixMeta.ownerUserId,
        protocol: termixMeta.protocol,
        openedAt: Date.now(),
      };
      guacSessionByConnectId.set(termixMeta.termixConnectId, info);
      guacSessionByGuacamoleId.set(guacamoleConnectionId, info);

      const resolver = pendingConnectResolvers.get(termixMeta.termixConnectId);
      if (resolver) resolver(info);
    }
  });

  server.on("close", (clientConnection: GuacamoleClientConnection) => {
    guacLogger.info("Guacamole connection closed", {
      operation: "guac_connection_close",
      type: clientConnection.connectionSettings?.connection?.type,
    });

    const isJoin = !!clientConnection.connectionSettings?.connection?.join;
    const termixMeta = clientConnection.connectionSettings?.termixMeta;
    const guacamoleConnectionId = clientConnection.guacamoleConnectionId;
    if (!isJoin && termixMeta && guacamoleConnectionId) {
      guacSessionByConnectId.delete(termixMeta.termixConnectId);
      guacSessionByGuacamoleId.delete(guacamoleConnectionId);
    }

    persistGuacamoleRecording(clientConnection).catch((error) => {
      guacLogger.error("Failed to persist Guacamole recording", error, {
        operation: "guac_recording_persist_error",
      });
    });
  });

  server.on(
    "error",
    (clientConnection: GuacamoleClientConnection, error: Error) => {
      guacLogger.error("Guacamole connection error", error, {
        operation: "guac_connection_error",
        type: clientConnection.connectionSettings?.connection?.type,
      });
    },
  );

  return server;
}

let guacServer = createGuacServer();

export async function restartGuacServer(): Promise<void> {
  try {
    guacServer.close();
  } catch (err) {
    guacLogger.error("Error closing guac server during restart", err as Error);
  }
  guacServer = createGuacServer();
}

export { guacServer, tokenService };
