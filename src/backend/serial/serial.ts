import { WebSocketServer, WebSocket, type RawData } from "ws";
import { SerialPort } from "serialport";
import { AuthManager } from "../utils/auth-manager.js";
import { UserCrypto } from "../utils/user-crypto.js";
import { sshLogger } from "../utils/logger.js";

interface SerialConnectData {
  path: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
}

interface WebSocketMessage {
  type: string;
  data?: SerialConnectData | string | unknown;
}

const authManager = AuthManager.getInstance();
const userCrypto = UserCrypto.getInstance();

const wss = new WebSocketServer({ port: 30011 });

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
  } catch {
    ws.close(1008, "Authentication required");
    return;
  }

  const dataKey = userCrypto.getUserDataKey(userId);
  if (!dataKey) {
    ws.send(JSON.stringify({ type: "error", data: "Data locked" }));
    ws.close(1008, "Data access required");
    return;
  }

  let port: SerialPort | null = null;

  const send = (msg: object) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  };

  const cleanup = () => {
    if (port?.isOpen) {
      port.close();
    }
    port = null;
  };

  ws.on("message", async (raw: RawData) => {
    let parsed: WebSocketMessage;
    try {
      parsed = JSON.parse(raw.toString()) as WebSocketMessage;
    } catch {
      return;
    }

    const { type, data } = parsed;

    switch (type) {
      case "list_ports": {
        try {
          const ports = await SerialPort.list();
          send({ type: "ports_list", data: ports });
        } catch (err) {
          send({
            type: "error",
            data: err instanceof Error ? err.message : "Failed to list ports",
          });
        }
        break;
      }

      case "connect": {
        if (port?.isOpen) {
          port.close();
          port = null;
        }

        const cfg = data as SerialConnectData;
        if (!cfg?.path || !cfg?.baudRate) {
          send({ type: "error", data: "Missing port path or baud rate" });
          break;
        }

        try {
          port = new SerialPort({
            path: cfg.path,
            baudRate: cfg.baudRate,
            dataBits: cfg.dataBits ?? 8,
            stopBits: cfg.stopBits ?? 1,
            parity: cfg.parity ?? "none",
            autoOpen: false,
          });

          port.open((err) => {
            if (err) {
              sshLogger.error("Serial port open failed", err, {
                operation: "serial_open",
                path: cfg.path,
                userId,
              });
              send({ type: "error", data: err.message });
              port = null;
              return;
            }
            sshLogger.info("Serial port opened", {
              operation: "serial_open",
              path: cfg.path,
              baudRate: cfg.baudRate,
              userId,
            });
            send({ type: "connected" });
          });

          port.on("data", (chunk: Buffer) => {
            send({ type: "data", data: chunk.toString("binary") });
          });

          port.on("error", (err) => {
            send({ type: "error", data: err.message });
          });

          port.on("close", () => {
            send({ type: "disconnected" });
            port = null;
          });
        } catch (err) {
          send({
            type: "error",
            data:
              err instanceof Error ? err.message : "Failed to open serial port",
          });
        }
        break;
      }

      case "input": {
        if (!port?.isOpen) break;
        const input = typeof data === "string" ? data : "";
        if (!input) break;
        port.write(Buffer.from(input, "binary"), (err) => {
          if (err) {
            send({ type: "error", data: err.message });
          }
        });
        break;
      }

      case "disconnect": {
        cleanup();
        send({ type: "disconnected" });
        break;
      }
    }
  });

  ws.on("close", () => {
    cleanup();
  });

  ws.on("error", () => {
    cleanup();
  });
});
