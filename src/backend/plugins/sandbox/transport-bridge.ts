/**
 * Pieces for ctx.ssh.prepare and ctx.ssh.openTransport in a plugin process.
 *
 * The plugin runs its own ssh2 client over a byte stream core opens. Core
 * keeps the host key check (the verifier and the prompt on the user's
 * socket) and the route to the host (proxy, jump hosts, a provided
 * transport). Nothing the plugin writes reaches the far end until that end
 * has sent an SSH greeting, so the stream can't be used to talk to any other
 * kind of service.
 */
import { Duplex } from "node:stream";
import type { StreamPort } from "./rpc.js";

/** What a refused key turns into, read from the stand-in client. */
export const SSH2_REFUSAL_TEXT = "Host denied (verification failed)";

/** Bytes the far end may send before its "SSH-" line. */
export const GREETING_LIMIT = 8 * 1024;
/** What the plugin may write before the greeting arrives. */
export const EARLY_WRITE_LIMIT = 64 * 1024;

type AnyFn = (...args: unknown[]) => unknown;

/**
 * The env.client an auth provider sees when the real client is in a plugin
 * process. SDK applyCertificateAuth recognises it and leaves the certificate
 * in the config for the plugin's own client.
 */
export interface StandInClient {
  termixSandboxClient: true;
  emit: (event: string | symbol, ...args: unknown[]) => boolean;
  on: (event: string, fn: AnyFn) => StandInClient;
  once: (event: string, fn: AnyFn) => StandInClient;
  removeListener: (event: string, fn: AnyFn) => StandInClient;
}

export function standInClient(): StandInClient {
  const client: StandInClient = {
    termixSandboxClient: true,
    emit: () => true,
    on: () => client,
    once: () => client,
    removeListener: () => client,
  };
  return client;
}

/**
 * Asks the stand-in what ssh2's refusal error becomes. The host key policy
 * rewrites that error on the client it was given; here that client is the
 * stand-in, so its rewrite is read back and sent to the plugin.
 */
export function refusalFromStandIn(client: StandInClient): {
  message: string;
  code?: string;
} {
  const probe = new Error(SSH2_REFUSAL_TEXT) as Error & { code?: string };
  try {
    client.emit("error", probe);
  } catch {
    // keep the plain text
  }
  return probe.code
    ? { message: probe.message, code: probe.code }
    : { message: probe.message };
}

/**
 * A copy of a connect config that can cross: strings, numbers, booleans,
 * Buffers, arrays and plain objects. Functions (the host verifier) and live
 * objects stay in core.
 */
export function plainConfig(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value === null) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Buffer.isBuffer(value)) return value;
  if (value instanceof Uint8Array) return Buffer.from(value);
  if (Array.isArray(value)) {
    return value
      .map((item) => plainConfig(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value !== "object") return undefined;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const copy = plainConfig(item, depth + 1);
    if (copy !== undefined) out[key] = copy;
  }
  return out;
}

/** Where the ssh2 greeting line starts in what arrived so far, or -1. */
export function greetingIndex(buffer: Buffer): number {
  if (buffer.subarray(0, 4).toString("latin1") === "SSH-") return 0;
  const at = buffer.indexOf("\nSSH-", 0, "latin1");
  return at < 0 ? -1 : at + 1;
}

/**
 * Joins a socket core opened with the plugin's stream. The plugin's bytes
 * wait until the far end has greeted as an SSH server; a far end that sends
 * more than GREETING_LIMIT bytes without one, or a plugin that writes more
 * than EARLY_WRITE_LIMIT before it, ends the stream.
 */
export function joinSshStream(sock: Duplex, port: StreamPort): void {
  let greeted = false;
  let seen = Buffer.alloc(0);
  const early: Buffer[] = [];
  let earlyBytes = 0;
  let closed = false;

  const fail = (reason: string) => {
    if (closed) return;
    closed = true;
    port.destroy(new Error(reason));
    sock.destroy();
  };

  const toPort = (chunk: Buffer) => {
    if (!port.write(chunk)) {
      sock.pause();
      port.once("drain", () => sock.resume());
    }
  };

  sock.on("data", (chunk: Buffer) => {
    if (greeted) {
      toPort(chunk);
      return;
    }
    seen = Buffer.concat([seen, chunk]);
    if (greetingIndex(seen) < 0) {
      if (seen.length > GREETING_LIMIT) {
        fail("The host did not answer as an SSH server");
      }
      return;
    }
    greeted = true;
    const held = seen;
    seen = Buffer.alloc(0);
    toPort(held);
    for (const queued of early.splice(0)) sock.write(queued);
    earlyBytes = 0;
  });

  port.on("data", (chunk: Buffer) => {
    if (!Buffer.isBuffer(chunk)) return;
    if (!greeted) {
      earlyBytes += chunk.length;
      if (earlyBytes > EARLY_WRITE_LIMIT) {
        fail("Too much data before the host greeted");
        return;
      }
      early.push(chunk);
      return;
    }
    if (!sock.write(chunk)) {
      port.pause();
      sock.once("drain", () => port.resume());
    }
  });

  port.on("remote-end", () => {
    if (greeted) sock.end();
    else fail("The stream ended before the host greeted");
  });
  port.on("error", () => fail("The plugin closed the stream"));
  port.on("close", () => {
    if (!closed) {
      closed = true;
      sock.destroy();
    }
  });
  sock.on("end", () => {
    if (!closed) port.end();
  });
  sock.on("error", (error: Error) => fail(error.message));
  sock.on("close", () => {
    if (!closed) {
      closed = true;
      port.end();
    }
  });
}

/** Moves bytes both ways between a stream core holds and a port. */
export function joinStream(stream: Duplex, port: StreamPort): () => void {
  const fromStream = (chunk: Buffer) => {
    if (!port.write(chunk)) {
      stream.pause();
      port.once("drain", () => stream.resume());
    }
  };
  const fromPort = (chunk: Buffer) => {
    if (!stream.write(chunk)) {
      port.pause();
      stream.once("drain", () => port.resume());
    }
  };
  const portEnded = () => stream.end();
  const portFailed = () => stream.destroy();
  const streamEnded = () => port.end();
  const streamFailed = (error: Error) => port.destroy(error);
  const streamClosed = () => {
    if (!port.writableEnded) port.end();
  };
  stream.on("data", fromStream);
  port.on("data", fromPort);
  port.on("remote-end", portEnded);
  port.on("error", portFailed);
  port.on("close", portFailed);
  stream.on("end", streamEnded);
  stream.on("error", streamFailed);
  stream.on("close", streamClosed);
  // Undoes the join, leaving both ends open.
  return () => {
    stream.off("data", fromStream);
    port.off("data", fromPort);
    port.off("remote-end", portEnded);
    port.off("error", portFailed);
    port.off("close", portFailed);
    stream.off("end", streamEnded);
    stream.off("error", streamFailed);
    stream.off("close", streamClosed);
    stream.pause();
  };
}

/**
 * A port seen as a plain byte stream, for code in core that wants a socket
 * (ssh2's sock). Destroying it fails the port, which ends the plugin's side.
 */
export function portAsSocket(port: StreamPort): Duplex {
  const socket = new Duplex({
    read() {
      port.resume();
    },
    write(chunk: Buffer, _encoding, callback) {
      if (port.write(Buffer.from(chunk))) callback();
      else port.once("drain", () => callback());
    },
    final(callback) {
      port.end();
      callback();
    },
    destroy(error, callback) {
      if (!port.destroyed) port.destroy(new Error("closed"));
      callback(error);
    },
  });
  port.on("data", (chunk: Buffer) => {
    if (!socket.push(chunk)) port.pause();
  });
  port.on("end", () => socket.push(null));
  port.on("close", () => {
    if (!socket.destroyed) socket.destroy();
  });
  return socket;
}
