import express from "express";
import { createServer } from "http";

import { createCorsMiddleware } from "../../utils/cors-config.js";
import cookieParser from "cookie-parser";
import { WebSocketServer } from "ws";

import { tunnelLogger } from "../../utils/logger.js";
import { AuthManager } from "../../utils/auth-manager.js";

import {
  describeC2SRelayError,
  extractRequestToken,
  sendC2SError,
} from "../tunnel-c2s-relay-utils.js";
import {
  handleC2SRelayOpen,
  handleC2SRelayTest,
  type C2SOpenMessage,
} from "../tunnel-c2s-relay.js";

import { registerTunnelRoutes } from "./routes.js";
import { initializeAutoStartTunnels } from "./manager.js";

const authManager = AuthManager.getInstance();

const app = express();
app.use(createCorsMiddleware(["GET", "POST", "PUT", "DELETE", "OPTIONS"]));
app.use(cookieParser());
app.use(express.json());
app.use((_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

registerTunnelRoutes(app);

const PORT = 30003;
const server = createServer(app);
const c2sRelayWss = new WebSocketServer({
  server,
  path: "/ssh/tunnel/c2s/stream",
});

c2sRelayWss.on("connection", (ws, req) => {
  let opened = false;

  ws.once("message", async (raw) => {
    try {
      const token = extractRequestToken(req);
      const payload = token ? await authManager.verifyJWTToken(token) : null;
      if (!payload?.userId || payload.pendingTOTP) {
        sendC2SError(ws, "Authentication required");
        ws.close();
        return;
      }

      const message = JSON.parse(raw.toString()) as C2SOpenMessage;
      if (message.type !== "open" && message.type !== "test") {
        throw new Error("Invalid client tunnel relay request");
      }

      opened = true;
      if (message.type === "test") {
        await handleC2SRelayTest(ws, message, payload.userId);
      } else {
        await handleC2SRelayOpen(ws, message, payload.userId);
      }
    } catch (error) {
      const message = describeC2SRelayError(error);
      tunnelLogger.error("Failed to open C2S relay", error, {
        operation: "c2s_relay_open_failed",
      });
      sendC2SError(ws, message);
      ws.close();
    }
  });

  ws.on("close", () => {
    if (!opened) {
      tunnelLogger.info("C2S relay closed before opening", {
        operation: "c2s_relay_closed_before_open",
      });
    }
  });
});

server.listen(PORT, () => {
  setTimeout(() => {
    initializeAutoStartTunnels();
  }, 2000);
});
