import GuacamoleLite from "guacamole-lite";
import { guacLogger } from "../utils/logger.js";
import { GuacamoleTokenService } from "./token-service.js";
import { getDb } from "../database/db/index.js";

const tokenService = GuacamoleTokenService.getInstance();

function parseGuacUrl(url: string): { host: string; port: number } {
  const parts = url.split(":");
  return {
    host: parts[0] || "localhost",
    port: parseInt(parts[1] || "4822", 10),
  };
}

function readGuacdOptions(): { host: string; port: number } {
  let host = process.env.GUACD_HOST || "localhost";
  let port = parseInt(process.env.GUACD_PORT || "4822", 10);
  try {
    const db = getDb();
    const urlRow = db.$client
      .prepare("SELECT value FROM settings WHERE key = 'guac_url'")
      .get() as { value: string } | undefined;
    if (urlRow?.value) {
      const parsed = parseGuacUrl(urlRow.value);
      host = parsed.host;
      port = parsed.port;
    }
  } catch {
    // DB not available yet, use env var defaults
  }
  return { host, port };
}

const GUAC_WS_PORT = 30008;

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

  server.on(
    "open",
    (clientConnection: { connectionSettings?: Record<string, unknown> }) => {
      guacLogger.info("Guacamole connection opened", {
        operation: "guac_connection_open",
        type: clientConnection.connectionSettings?.type,
      });
    },
  );

  server.on(
    "close",
    (clientConnection: { connectionSettings?: Record<string, unknown> }) => {
      guacLogger.info("Guacamole connection closed", {
        operation: "guac_connection_close",
        type: clientConnection.connectionSettings?.type,
      });
    },
  );

  server.on(
    "error",
    (
      clientConnection: { connectionSettings?: Record<string, unknown> },
      error: Error,
    ) => {
      guacLogger.error("Guacamole connection error", error, {
        operation: "guac_connection_error",
        type: clientConnection.connectionSettings?.type,
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
