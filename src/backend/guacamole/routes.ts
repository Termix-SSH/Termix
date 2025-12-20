import express from "express";
import { GuacamoleTokenService } from "./token-service.js";
import { guacLogger } from "../utils/logger.js";
import { AuthManager } from "../utils/auth-manager.js";
import type { AuthenticatedRequest } from "../../types/index.js";

const router = express.Router();
const tokenService = GuacamoleTokenService.getInstance();
const authManager = AuthManager.getInstance();

// Apply authentication middleware
router.use(authManager.createAuthMiddleware());

/**
 * POST /guacamole/token
 * Generate an encrypted connection token for guacamole-lite
 * 
 * Body: {
 *   type: "rdp" | "vnc" | "telnet",
 *   hostname: string,
 *   port?: number,
 *   username?: string,
 *   password?: string,
 *   domain?: string,
 *   // Additional protocol-specific options
 * }
 */
router.post("/token", async (req, res) => {
  try {
    const userId = (req as AuthenticatedRequest).userId;
    const { type, hostname, port, username, password, domain, ...options } = req.body;

    if (!type || !hostname) {
      return res.status(400).json({ error: "Missing required fields: type and hostname" });
    }

    if (!["rdp", "vnc", "telnet"].includes(type)) {
      return res.status(400).json({ error: "Invalid connection type. Must be rdp, vnc, or telnet" });
    }

    // Log received options for debugging
    guacLogger.info("Guacamole token request received", {
      operation: "guac_token_request",
      type,
      hostname,
      port,
      optionKeys: Object.keys(options),
      optionsCount: Object.keys(options).length,
    });

    // Log specific option values for debugging
    if (Object.keys(options).length > 0) {
      guacLogger.info("Guacamole options received", {
        operation: "guac_token_options",
        options: JSON.stringify(options),
      });
    }

    let token: string;

    switch (type) {
      case "rdp":
        token = tokenService.createRdpToken(hostname, username || "", password || "", {
          port: port || 3389,
          domain,
          ...options,
        });
        break;
      case "vnc":
        token = tokenService.createVncToken(hostname, password, {
          port: port || 5900,
          ...options,
        });
        break;
      case "telnet":
        token = tokenService.createTelnetToken(hostname, username, password, {
          port: port || 23,
          ...options,
        });
        break;
      default:
        return res.status(400).json({ error: "Invalid connection type" });
    }

    guacLogger.info("Generated guacamole connection token", {
      operation: "guac_token_generated",
      userId,
      type,
      hostname,
    });

    res.json({ token });
  } catch (error) {
    guacLogger.error("Failed to generate guacamole token", error, {
      operation: "guac_token_error",
    });
    res.status(500).json({ error: "Failed to generate connection token" });
  }
});

/**
 * GET /guacamole/status
 * Check if guacd is reachable
 */
router.get("/status", async (req, res) => {
  try {
    const guacdHost = process.env.GUACD_HOST || "localhost";
    const guacdPort = parseInt(process.env.GUACD_PORT || "4822", 10);

    // Simple TCP check to see if guacd is responding
    const net = await import("net");
    
    const checkConnection = (): Promise<boolean> => {
      return new Promise((resolve) => {
        const socket = new net.Socket();
        socket.setTimeout(3000);
        
        socket.on("connect", () => {
          socket.destroy();
          resolve(true);
        });
        
        socket.on("timeout", () => {
          socket.destroy();
          resolve(false);
        });
        
        socket.on("error", () => {
          socket.destroy();
          resolve(false);
        });
        
        socket.connect(guacdPort, guacdHost);
      });
    };

    const isConnected = await checkConnection();

    res.json({
      guacd: {
        host: guacdHost,
        port: guacdPort,
        status: isConnected ? "connected" : "disconnected",
      },
      websocket: {
        port: 30007,
        status: "running",
      },
    });
  } catch (error) {
    guacLogger.error("Failed to check guacamole status", error, {
      operation: "guac_status_error",
    });
    res.status(500).json({ error: "Failed to check status" });
  }
});

export default router;

