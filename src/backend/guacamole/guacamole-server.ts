import GuacamoleLite from "guacamole-lite";
import { parse as parseUrl } from "url";
import { guacLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { GuacamoleTokenService } from "./token-service.js";
import { getDb } from "../database/db/index.js";
import type { IncomingMessage } from "http";

const authManager = AuthManager.getInstance();
const tokenService = GuacamoleTokenService.getInstance();

function parseGuacUrl(url: string): { host: string; port: number } {
  const parts = url.split(":");
  return {
    host: parts[0] || "localhost",
    port: parseInt(parts[1] || "4822", 10),
  };
}

// Read guac_url from DB at startup, fall back to env vars
let GUACD_HOST = process.env.GUACD_HOST || "localhost";
let GUACD_PORT = parseInt(process.env.GUACD_PORT || "4822", 10);
try {
  const db = getDb();
  const urlRow = db.$client
    .prepare("SELECT value FROM settings WHERE key = 'guac_url'")
    .get() as { value: string } | undefined;
  if (urlRow?.value) {
    const parsed = parseGuacUrl(urlRow.value);
    GUACD_HOST = parsed.host;
    GUACD_PORT = parsed.port;
  }
} catch {
  // DB not available yet, use env var defaults
}
const GUAC_WS_PORT = 30008;

const websocketOptions = {
  port: GUAC_WS_PORT,
};

const guacdOptions = {
  host: GUACD_HOST,
  port: GUACD_PORT,
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
  // Allow width, height, and dpi to be passed as query parameters
  // This allows the client to request the appropriate resolution at connection time
  allowedUnencryptedConnectionSettings: {
    rdp: ["width", "height", "dpi"],
    vnc: ["width", "height", "dpi"],
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

// Suppress hardcoded console.log calls from guacamole-lite
const _origConsoleLog = console.log;
console.log = (...args: unknown[]) => {
  const msg = args[0];
  if (typeof msg === "string" && msg.startsWith("New client connection"))
    return;
  _origConsoleLog(...args);
};

// Create the guacamole-lite server
const guacServer = new GuacamoleLite(
  websocketOptions,
  guacdOptions,
  clientOptions,
);

// Add authentication via processConnectionSettings callback
guacServer.on(
  "open",
  (clientConnection: { connectionSettings?: Record<string, unknown> }) => {
    guacLogger.info("Guacamole connection opened", {
      operation: "guac_connection_open",
      type: clientConnection.connectionSettings?.type,
    });
  },
);

guacServer.on(
  "close",
  (clientConnection: { connectionSettings?: Record<string, unknown> }) => {
    guacLogger.info("Guacamole connection closed", {
      operation: "guac_connection_close",
      type: clientConnection.connectionSettings?.type,
    });
  },
);

guacServer.on(
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

export { guacServer, tokenService };
