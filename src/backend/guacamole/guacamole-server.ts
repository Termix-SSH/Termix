import GuacamoleLite from "guacamole-lite";
import { parse as parseUrl } from "url";
import { guacLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import { GuacamoleTokenService } from "./token-service.js";
import type { IncomingMessage } from "http";

const authManager = AuthManager.getInstance();
const tokenService = GuacamoleTokenService.getInstance();

// Configuration from environment
const GUACD_HOST = process.env.GUACD_HOST || "localhost";
const GUACD_PORT = parseInt(process.env.GUACD_PORT || "4822", 10);
const GUAC_WS_PORT = 30007;

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
    level: process.env.NODE_ENV === "production" ? "ERRORS" : "VERBOSE",
    stdLog: (...args: unknown[]) => {
      guacLogger.info(args.join(" "), { operation: "guac_log" });
    },
    errorLog: (...args: unknown[]) => {
      guacLogger.error(args.join(" "), { operation: "guac_error" });
    },
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
    },
    vnc: {
      "swap-red-blue": false,
      "cursor": "remote",
    },
    telnet: {
      "terminal-type": "xterm-256color",
    },
  },
};

// Create the guacamole-lite server
const guacServer = new GuacamoleLite(
  websocketOptions,
  guacdOptions,
  clientOptions
);

// Add authentication via processConnectionSettings callback
guacServer.on("open", (clientConnection: { connectionSettings?: Record<string, unknown> }) => {
  guacLogger.info("Guacamole connection opened", {
    operation: "guac_connection_open",
    type: clientConnection.connectionSettings?.type,
  });
});

guacServer.on("close", (clientConnection: { connectionSettings?: Record<string, unknown> }) => {
  guacLogger.info("Guacamole connection closed", {
    operation: "guac_connection_close",
    type: clientConnection.connectionSettings?.type,
  });
});

guacServer.on("error", (clientConnection: { connectionSettings?: Record<string, unknown> }, error: Error) => {
  guacLogger.error("Guacamole connection error", error, {
    operation: "guac_connection_error",
    type: clientConnection.connectionSettings?.type,
  });
});

guacLogger.info(`Guacamole WebSocket server started on port ${GUAC_WS_PORT}`, {
  operation: "guac_server_start",
  guacdHost: GUACD_HOST,
  guacdPort: GUACD_PORT,
});

export { guacServer, tokenService };

