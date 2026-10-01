import type { WebSocket } from "ws";
import { SerialPort } from "serialport";
import type {
  PluginContext,
  PluginWebSocketConnection,
} from "@termix/plugin-sdk/backend";
import { parseWsMessage } from "./ws-message.js";

interface SerialConnectData {
  path: string;
  baudRate: number;
  dataBits?: 5 | 6 | 7 | 8;
  stopBits?: 1 | 2;
  parity?: "none" | "even" | "odd";
}

/**
 * Handles one /plugin-ws/serial/console connection. Auth already ran (core's
 * ctx.ws.route authenticates before this is called), so every message here
 * only has to decide whether to touch the actual hardware.
 */
export function createSerialSession(ctx: PluginContext) {
  return async (connection: PluginWebSocketConnection): Promise<void> => {
    const ws = connection.socket as WebSocket;
    let port: SerialPort | null = null;

    const send = (msg: object) => {
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    };

    const cleanup = () => {
      if (port?.isOpen) {
        port.close();
      }
      port = null;
    };

    if (!connection.isDataUnlocked()) {
      send({ type: "error", data: "Data locked" });
      ws.close(1008, "Data access required");
      return;
    }

    ws.on("message", async (raw) => {
      let type: string;
      let data: unknown;
      try {
        ({ type, data } = parseWsMessage(raw));
      } catch {
        return;
      }

      if (!connection.isDataUnlocked()) {
        send({ type: "error", data: "Data access expired" });
        ws.close(1008, "Data access expired");
        return;
      }

      try {
        switch (type) {
          case "list_ports": {
            await ctx.capabilities.require("device:serial");
            try {
              const ports = await SerialPort.list();
              send({ type: "ports_list", data: ports });
            } catch (err) {
              send({
                type: "error",
                data: errorMessage(err, "Failed to list ports"),
              });
            }
            break;
          }

          case "connect": {
            await ctx.capabilities.require("device:serial");

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
              const opened = new SerialPort({
                path: cfg.path,
                baudRate: cfg.baudRate,
                dataBits: cfg.dataBits ?? 8,
                stopBits: cfg.stopBits ?? 1,
                parity: cfg.parity ?? "none",
                autoOpen: false,
              });
              port = opened;

              opened.open((err) => {
                if (err) {
                  ctx.log.error(`Serial port open failed for ${cfg.path}`, err);
                  send({ type: "error", data: err.message });
                  port = null;
                  return;
                }
                ctx.log.info(
                  `Serial port opened: ${cfg.path} at ${cfg.baudRate} baud`,
                );
                send({ type: "connected" });
              });

              opened.on("data", (chunk: Buffer) => {
                send({ type: "data", data: chunk.toString("binary") });
              });

              opened.on("error", (err) => {
                send({ type: "error", data: err.message });
              });

              opened.on("close", () => {
                send({ type: "disconnected" });
                port = null;
              });
            } catch (err) {
              send({
                type: "error",
                data: errorMessage(err, "Failed to open serial port"),
              });
            }
            break;
          }

          case "input": {
            if (!port?.isOpen) break;
            const input = typeof data === "string" ? data : "";
            if (!input) break;
            port.write(Buffer.from(input, "binary"), (err) => {
              if (err) send({ type: "error", data: err.message });
            });
            break;
          }

          case "disconnect": {
            cleanup();
            send({ type: "disconnected" });
            break;
          }
        }
      } catch (err) {
        ctx.log.error("Error handling serial WebSocket message", err);
        send({
          type: "error",
          data:
            err instanceof Error ? err.message : "Failed to process message",
        });
      }
    });

    ws.on("close", cleanup);
    ws.on("error", cleanup);
  };
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
