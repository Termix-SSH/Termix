/**
 * Length prefixed frames for the desktop plugin channel. On the desktop the
 * plugin runtime is a separate Node binary inside an OS sandbox, reached
 * through a small helper process, so its channel is plain stdin and stdout
 * instead of Node's IPC pipe (whose handle can't pass through the helper on
 * Windows).
 *
 * Each frame is a 4 byte big endian length and then the message, encoded
 * by wire-codec.ts (not v8.serialize: core and plugin run different V8s).
 * Electron main only splits frames and never decodes them.
 */
import type { Readable, Writable } from "node:stream";
import type { Transport, Wire } from "./rpc.js";
import { decodePayload, encodePayload } from "./wire-codec.js";

/** Runtime argument that picks this channel. */
export const STDIO_FLAG = "--tmx-stdio";

/** Larger frames end the channel. File reads cross in 8 MiB pieces. */
export const MAX_FRAME = 64 * 1024 * 1024;

export function encodeFrame(payload: Uint8Array): Buffer {
  if (payload.length > MAX_FRAME) throw new Error("Message too large");
  const head = Buffer.alloc(4);
  head.writeUInt32BE(payload.length, 0);
  return Buffer.concat([head, payload]);
}

/**
 * Splits a byte stream into frames. Calls onFrame with each payload, and
 * onError once (then ignores the rest) when a frame is too large.
 */
export class FrameReader {
  private chunks: Buffer[] = [];
  private size = 0;
  private broken = false;

  constructor(
    private readonly onFrame: (payload: Buffer) => void,
    private readonly onError: (error: Error) => void,
    private readonly max = MAX_FRAME,
  ) {}

  push(chunk: Uint8Array): void {
    if (this.broken || chunk.length === 0) return;
    this.chunks.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
    this.size += chunk.length;
    while (this.size >= 4) {
      const all =
        this.chunks.length === 1 ? this.chunks[0] : Buffer.concat(this.chunks);
      this.chunks = [all];
      const length = all.readUInt32BE(0);
      if (length > this.max) {
        this.broken = true;
        this.chunks = [];
        this.size = 0;
        this.onError(new Error("Message too large"));
        return;
      }
      if (all.length < 4 + length) return;
      const payload = Buffer.from(all.subarray(4, 4 + length));
      const rest = all.subarray(4 + length);
      this.chunks = rest.length > 0 ? [rest] : [];
      this.size = rest.length;
      this.onFrame(payload);
    }
  }
}

export function encodeWire(message: Wire): Buffer {
  return encodeFrame(encodePayload(message));
}

export function decodeWire(payload: Uint8Array): Wire {
  return decodePayload(payload) as Wire;
}

/**
 * The child's side: frames in on stdin, out on stdout. A broken or closed
 * channel means the app is gone, so the process ends.
 */
export function stdioTransport(
  input: Readable,
  output: Pick<Writable, "write">,
  onClosed: () => void,
): Transport {
  return {
    send: (message) => {
      try {
        output.write(encodeWire(message));
      } catch {
        onClosed();
      }
    },
    onMessage: (handler) => {
      const reader = new FrameReader(
        (payload) => handler(decodeWire(payload)),
        () => onClosed(),
      );
      input.on("data", (chunk: Buffer) => reader.push(chunk));
      input.once("end", onClosed);
      input.once("error", onClosed);
      input.resume();
    },
  };
}
