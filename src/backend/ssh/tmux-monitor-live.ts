// Real-time tmux pane output streaming over WebSocket. Each subscription
// opens a dedicated SSH connection and attaches a tmux control-mode client
// (`tmux -C attach-session`), forwarding %output notifications for the
// subscribed pane to the browser. Replaces 2s REST polling of capture-pane.

import { WebSocketServer, WebSocket, type RawData } from "ws";
import type { Client, ClientChannel } from "ssh2";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { sshLogger } from "../utils/logger.js";
import { resolveHostById, checkHostAccess } from "./host-resolver.js";
import { connectToHost } from "./tmux-monitor.js";
import { shellEscape } from "./tmux-monitor-helpers.js";
import { createControlModeParser } from "./tmux-control-parser.js";

const PANE_ID_RE = /^%\d+$/;
const PORT = 30011;

interface SubscribeMessage {
  type: "subscribe";
  hostId: number;
  sessionName: string;
  paneId: string;
}

interface ClientMessage {
  type?: string;
  hostId?: unknown;
  sessionName?: unknown;
  paneId?: unknown;
}

const authManager = AuthManager.getInstance();
const userCrypto = UserCrypto.getInstance();

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", async (ws: WebSocket, req) => {
  let userId: string | undefined;

  try {
    let token: string | undefined;

    const cookieHeader = req.headers.cookie;
    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)jwt=([^;]+)/);
      if (match) token = decodeURIComponent(match[1]);
    }

    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        token = authHeader.slice("Bearer ".length);
      }
    }

    if (!token) {
      const urlObj = new URL(req.url || "", "http://localhost");
      const qp = urlObj.searchParams.get("token");
      if (qp) token = qp;
    }

    if (!token) {
      ws.close(1008, "Authentication required");
      return;
    }

    const payload = await authManager.verifyJWTToken(token);
    if (!payload?.userId || payload.pendingTOTP) {
      ws.close(1008, "Authentication required");
      return;
    }

    userId = payload.userId;
  } catch (error) {
    sshLogger.error(
      "WebSocket JWT verification failed during connection",
      error,
      {
        operation: "tmux_monitor_live_auth_error",
        ip: req.socket.remoteAddress,
      },
    );
    ws.close(1008, "Authentication required");
    return;
  }

  const dataKey = userCrypto.getUserDataKey(userId);
  if (!dataKey) {
    sendJson(ws, {
      type: "error",
      message: "Data locked - re-authenticate with password",
      code: "DATA_LOCKED",
    });
    ws.close(1008, "Data access required");
    return;
  }

  sshLogger.info("Tmux monitor live WebSocket connection established", {
    operation: "tmux_monitor_live_connect",
    userId,
  });

  // One control client max per WS connection.
  let sshClient: Client | null = null;
  let channel: ClientChannel | null = null;
  // Increments on every subscribe/unsubscribe/close so stale async
  // subscriptions and stream callbacks can detect they were superseded.
  let subscriptionSeq = 0;

  function cleanupSubscription(): void {
    subscriptionSeq++;
    const oldChannel = channel;
    const oldClient = sshClient;
    channel = null;
    sshClient = null;

    if (oldChannel) {
      try {
        // Ask tmux to detach the control client cleanly before closing.
        oldChannel.write("detach-client\n");
      } catch {
        // channel may already be closed
      }
      try {
        oldChannel.close();
      } catch {
        // ignore
      }
    }
    if (oldClient) {
      try {
        oldClient.end();
      } catch {
        // ignore
      }
    }
  }

  async function handleSubscribe(msg: SubscribeMessage): Promise<void> {
    const { hostId, sessionName, paneId } = msg;

    if (typeof hostId !== "number" || !Number.isInteger(hostId)) {
      return sendError(ws, "Invalid host ID");
    }
    if (typeof sessionName !== "string" || sessionName.trim().length === 0) {
      return sendError(ws, "Invalid session name");
    }
    if (typeof paneId !== "string" || !PANE_ID_RE.test(paneId)) {
      return sendError(ws, "Invalid pane ID");
    }

    // A new subscribe replaces the previous one.
    cleanupSubscription();
    const seq = subscriptionSeq;
    const stale = () => seq !== subscriptionSeq || ws.readyState !== ws.OPEN;

    let client: Client;
    try {
      const host = await resolveHostById(hostId, userId!);
      if (!host) {
        return sendError(ws, "Host not found");
      }
      const hasAccess = await checkHostAccess(
        hostId,
        userId!,
        host.userId || userId!,
        "read",
      );
      if (!hasAccess) {
        return sendError(ws, "Access denied");
      }
      if (stale()) return;

      client = await connectToHost(host)();
    } catch (err) {
      sshLogger.error(`Tmux live subscribe failed for host ${hostId}`, err, {
        operation: "tmux_monitor_live_subscribe_error",
        hostId,
        userId,
      });
      return sendError(
        ws,
        err instanceof Error ? err.message : "Failed to connect to host",
      );
    }

    if (stale()) {
      client.end();
      return;
    }

    client.exec(
      `tmux -C attach-session -t ${shellEscape(sessionName)}`,
      (err, stream) => {
        if (err || stale()) {
          client.end();
          if (!stale()) {
            sendError(ws, "Failed to attach tmux control client");
          }
          return;
        }

        sshClient = client;
        channel = stream;

        const parser = createControlModeParser({
          onOutput: (outputPaneId, data) => {
            if (seq !== subscriptionSeq) return;
            if (outputPaneId !== paneId) return;
            sendJson(ws, { type: "output", paneId, data });
          },
          onExit: () => {
            if (seq !== subscriptionSeq) return;
            sendJson(ws, { type: "detached" });
            cleanupSubscription();
          },
          onStructureChange: () => {
            if (seq !== subscriptionSeq) return;
            sendJson(ws, { type: "structure_changed" });
          },
        });

        stream.on("data", (data: Buffer) => {
          if (seq !== subscriptionSeq) return;
          parser.feed(data);
        });
        stream.stderr.on("data", () => {
          // tmux control mode rarely writes to stderr; nothing useful to
          // forward and it must never reach the client verbatim.
        });
        stream.on("close", () => {
          if (seq !== subscriptionSeq) return;
          sendJson(ws, { type: "detached" });
          cleanupSubscription();
        });

        sendJson(ws, { type: "subscribed", paneId, sessionName });
        sshLogger.info("Tmux control-mode subscription started", {
          operation: "tmux_monitor_live_subscribed",
          hostId,
          userId,
          sessionName,
          paneId,
        });
      },
    );
  }

  ws.on("message", (raw: RawData) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return sendError(ws, "Invalid JSON message");
    }

    switch (msg.type) {
      case "subscribe":
        void handleSubscribe(msg as SubscribeMessage);
        break;
      case "unsubscribe":
        cleanupSubscription();
        break;
      case "ping":
        sendJson(ws, { type: "pong" });
        break;
      default:
        sendError(ws, "Unknown message type");
    }
  });

  ws.on("close", () => {
    cleanupSubscription();
  });

  ws.on("error", () => {
    cleanupSubscription();
  });
});

function sendJson(ws: WebSocket, payload: Record<string, unknown>): void {
  if (ws.readyState === ws.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function sendError(ws: WebSocket, message: string): void {
  sendJson(ws, { type: "error", message });
}

sshLogger.info(`Tmux monitor live service started on port ${PORT}`, {
  operation: "tmux_monitor_live_start",
  port: PORT,
});
