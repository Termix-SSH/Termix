import { Duplex } from "node:stream";
import type { RawData, WebSocket } from "ws";

export function waitForWebSocketOpen(
  socket: WebSocket,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      socket.off("open", onOpen);
      socket.off("error", onError);
    };
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      socket.terminate();
      reject(error);
    };
    const timer = setTimeout(() => {
      cleanup();
      socket.terminate();
      reject(new Error("Cloudflare tunnel timeout"));
    }, timeoutMs);

    socket.once("open", onOpen);
    socket.once("error", onError);
  });
}

export function createWebSocketDuplex(socket: WebSocket): Duplex {
  const duplex = new Duplex({
    read() {},
    write(chunk, _encoding, callback) {
      try {
        socket.send(chunk, (error) => callback(error || undefined));
      } catch (error) {
        callback(error instanceof Error ? error : new Error(String(error)));
      }
    },
    destroy(error, callback) {
      cleanup();
      socket.terminate();
      callback(error);
    },
  });

  const onMessage = (data: RawData) => duplex.push(data);
  const onClose = () => duplex.destroy();
  const onError = () => duplex.destroy();
  const cleanup = () => {
    socket.off("message", onMessage);
    socket.off("close", onClose);
    socket.off("error", onError);
  };

  socket.on("message", onMessage);
  socket.on("close", onClose);
  socket.on("error", onError);
  return duplex;
}
