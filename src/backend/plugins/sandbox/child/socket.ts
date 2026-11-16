import { EventEmitter } from "node:events";
import type { StreamPort } from "../rpc.js";

type AnyFn = (...args: unknown[]) => unknown;

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
/** Bytes held for a handler that has not listened yet before the port pauses. */
const HELD_BYTES = 1024 * 1024;

export type ChildSocket = EventEmitter & Record<string, unknown>;

/**
 * The plugin side of a socket, shaped like a `ws` WebSocket. Messages that
 * arrive before the handler listens are held, because a handler that awaits
 * a ctx call first (an RPC to core here) would otherwise lose them.
 */
export function createChildSocket(
  port: StreamPort,
  inStore: (fn: () => void) => void,
): ChildSocket {
  const socket = new EventEmitter() as ChildSocket;
  socket.OPEN = OPEN;
  socket.CLOSED = CLOSED;
  socket.readyState = OPEN;
  socket.bufferedAmount = 0;
  socket.send = (data: unknown, options?: unknown, cb?: unknown) => {
    if (socket.readyState !== OPEN) return;
    const binary = typeof data !== "string";
    port.write({
      d: binary ? Buffer.from(data as Uint8Array) : data,
      b: binary,
    });
    const done = typeof options === "function" ? options : cb;
    if (typeof done === "function") (done as AnyFn)();
  };
  socket.close = (code?: number, reason?: string) => {
    if (socket.readyState !== OPEN) return;
    socket.readyState = CLOSING;
    port.endMeta = { code, reason };
    port.end();
  };
  socket.terminate = () => (socket.close as AnyFn)(1006);
  socket.ping = () => {};
  socket.pause = () => port.pause();
  socket.resume = () => port.resume();

  let held: { data: Buffer; binary: boolean }[] = [];
  let heldBytes = 0;
  let heldClose: { code?: number; reason?: string } | undefined | null = null;
  let flushing = false;

  const deliver = (data: Buffer, binary: boolean) =>
    inStore(() => socket.emit("message", data, binary));
  const deliverClose = (end: { code?: number; reason?: string } | undefined) =>
    inStore(() =>
      socket.emit("close", end?.code ?? 1005, Buffer.from(end?.reason ?? "")),
    );

  const flush = () => {
    if (flushing) return;
    flushing = true;
    // newListener fires before the listener is added, so wait a tick.
    setImmediate(() => {
      flushing = false;
      const queue = held;
      held = [];
      heldBytes = 0;
      for (const item of queue) deliver(item.data, item.binary);
      if (queue.length) port.resume();
      if (heldClose !== null && socket.listenerCount("close") > 0) {
        const end = heldClose;
        heldClose = null;
        deliverClose(end);
      }
    });
  };
  socket.on("newListener", (event: string) => {
    if (event === "message" && held.length) flush();
    if (event === "close" && heldClose !== null) flush();
  });

  port.on("data", (chunk: { d: Buffer | string; b: boolean }) => {
    const data = typeof chunk.d === "string" ? Buffer.from(chunk.d) : chunk.d;
    if (socket.listenerCount("message") > 0 && !held.length) {
      deliver(data, chunk.b);
      return;
    }
    held.push({ data, binary: chunk.b });
    heldBytes += data.length;
    if (heldBytes > HELD_BYTES) port.pause();
  });
  port.on(
    "remote-end",
    (end: { code?: number; reason?: string } | undefined) => {
      socket.readyState = CLOSED;
      if (held.length || socket.listenerCount("close") === 0) {
        heldClose = end;
        if (socket.listenerCount("message") > 0) flush();
        return;
      }
      deliverClose(end);
    },
  );
  port.on("error", (error) => {
    if (socket.listenerCount("error") > 0) {
      inStore(() => socket.emit("error", error));
    }
  });
  return socket;
}
