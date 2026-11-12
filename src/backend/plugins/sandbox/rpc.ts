/**
 * Sandbox spike: one RPC endpoint per side of the core <-> plugin process
 * line. Same file on both sides.
 *
 * Wire messages (all go through process IPC with advanced serialization):
 *   call  { t: "call", id, m, a, k? }   run handler m with args a, token k
 *   fn    { t: "fn", id, f, a, k? }     run a function the other side handed out
 *   ok    { t: "ok", id, v }            result
 *   err   { t: "err", id, e }           error
 *   rel   { t: "rel", f }               the other side dropped function f
 *   s     { t: "s", s, op, d? }         stream frame: data, end, error, credit
 *
 * Functions inside arguments or results cross as { $f: id } and come back as
 * proxies that make "fn" calls. Streams cross as { $s: id }. Every call and
 * function call carries the sender's token, and the receiver decides what it
 * means (core resolves it to an actor, the child just stores it).
 */
import { Duplex } from "node:stream";

export const STREAM_WINDOW = 256 * 1024;

export type Wire =
  | { t: "call"; id: number; m: string; a: unknown[]; k?: string; u?: string }
  | { t: "fn"; id: number; f: string; a: unknown[]; k?: string; u?: string }
  | { t: "ok"; id: number; v: unknown }
  | { t: "err"; id: number; e: WireError }
  | { t: "rel"; f: string }
  | { t: "s"; s: string; op: "d" | "e" | "x" | "c"; d?: unknown };

export interface WireError {
  message: string;
  name?: string;
  code?: string;
  status?: number;
}

export interface Transport {
  send: (message: Wire) => void;
  onMessage: (handler: (message: Wire) => void) => void;
}

export type Handler = (args: unknown[], token: string | undefined) => unknown;

export interface EndpointOptions {
  /** "h" for core, "c" for the child; keeps ids apart. */
  side: "h" | "c";
  /** The token to attach to an outgoing call or function call. */
  outboundToken: () => string | undefined;
  /**
   * Runs an incoming call or function call under its token. `userId` is the
   * sender's own note of who that is: only the child reads it, for
   * currentActor(). Core never believes it.
   */
  inbound: <T>(
    token: string | undefined,
    run: () => T,
    userId: string | undefined,
  ) => T;
  /** Core only: who the outgoing token stands for, so the child can show it. */
  outboundActor?: () => string | undefined;
  /** An outgoing call that used this token has finished. */
  settled?: (token: string | undefined) => void;
  /** Replaces a value that cannot cross as is (a Drizzle table). */
  marshalHook?: (value: object) => unknown;
  /** Turns a hooked value back into something local. */
  unmarshalHook?: (record: Record<string, unknown>) => unknown;
}

/** A frame chunk: bytes, or a small object (stream heads, ws message flags). */
export type StreamChunk = Uint8Array | { [key: string]: unknown };

function chunkSize(chunk: StreamChunk): number {
  if (chunk instanceof Uint8Array) return chunk.byteLength;
  const data = (chunk as { d?: unknown }).d;
  if (data instanceof Uint8Array) return data.byteLength;
  if (typeof data === "string") return data.length;
  return 0;
}

/**
 * One side of a stream. Object mode so a chunk can carry a flag with it.
 * Writes stop when the other side has not granted credit, which is what
 * makes back pressure reach the real source (a socket or ssh channel).
 */
export class StreamPort extends Duplex {
  credit = STREAM_WINDOW;
  owed = 0;
  endMeta: unknown = undefined;
  private waiting: (() => void) | null = null;

  constructor(
    readonly sid: string,
    private readonly sendFrame: (frame: Wire) => void,
  ) {
    super({ objectMode: true, highWaterMark: 16 });
  }

  _write(
    chunk: StreamChunk,
    _encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const size = chunkSize(chunk);
    const go = () => {
      this.credit -= size;
      this.sendFrame({ t: "s", s: this.sid, op: "d", d: chunk });
      callback();
    };
    // May overshoot the window by one chunk, so a chunk bigger than the
    // window can never stall.
    if (size === 0 || this.credit > 0) {
      go();
      return;
    }
    this.waiting = go;
  }

  _final(callback: (error?: Error | null) => void): void {
    this.sendFrame({ t: "s", s: this.sid, op: "x", d: this.endMeta });
    callback();
  }

  _read(): void {
    if (this.owed > 0) {
      const amount = this.owed;
      this.owed = 0;
      this.sendFrame({ t: "s", s: this.sid, op: "c", d: amount });
    }
  }

  _destroy(error: Error | null, callback: (error?: Error | null) => void) {
    if (error) {
      this.sendFrame({
        t: "s",
        s: this.sid,
        op: "e",
        d: { message: error.message },
      });
    }
    callback(error);
  }

  /** Called by the endpoint for frames from the other side. */
  receive(op: "d" | "e" | "x" | "c", data: unknown): void {
    if (op === "c") {
      this.credit += data as number;
      if (this.waiting && this.credit > 0) {
        const go = this.waiting;
        this.waiting = null;
        go();
      }
      return;
    }
    if (op === "d") {
      const chunk = asBuffers(data as StreamChunk);
      const size = chunkSize(chunk);
      if (this.push(chunk)) {
        if (size) this.sendFrame({ t: "s", s: this.sid, op: "c", d: size });
      } else {
        this.owed += size;
      }
      return;
    }
    if (op === "x") {
      this.endMeta = data;
      this.emit("remote-end", data);
      this.push(null);
      return;
    }
    this.destroy(new Error((data as WireError)?.message ?? "stream failed"));
  }
}

/** Structured clone turns a Buffer into a Uint8Array; turn it back. */
function asBuffers(chunk: StreamChunk): StreamChunk {
  if (chunk instanceof Uint8Array) {
    return Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength);
  }
  const data = (chunk as { d?: unknown }).d;
  if (data instanceof Uint8Array && !Buffer.isBuffer(data)) {
    return {
      ...chunk,
      d: Buffer.from(data.buffer, data.byteOffset, data.byteLength),
    };
  }
  return chunk;
}

export class Endpoint {
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private readonly handlers = new Map<string, Handler>();
  private readonly localFns = new Map<string, (...a: unknown[]) => unknown>();
  private readonly fnIds = new WeakMap<object, string>();
  private readonly streams = new Map<string, StreamPort>();
  private readonly released =
    typeof FinalizationRegistry === "function"
      ? new FinalizationRegistry<string>((f) => this.post({ t: "rel", f }))
      : null;
  private closed = false;

  constructor(
    private readonly transport: Transport,
    private readonly options: EndpointOptions,
  ) {
    transport.onMessage((message) => this.onMessage(message));
  }

  handle(method: string, handler: Handler): void {
    this.handlers.set(method, handler);
  }

  call<T = unknown>(method: string, args: unknown[] = []): Promise<T> {
    const token = this.options.outboundToken();
    return this.track(this.send<T>(method, args, token), token);
  }

  /** A call under a token the caller owns (a socket's), not a fresh one. */
  callWithToken<T = unknown>(
    token: string,
    method: string,
    args: unknown[] = [],
  ): Promise<T> {
    return this.send<T>(method, args, token);
  }

  private send<T>(
    method: string,
    args: unknown[],
    token: string | undefined,
  ): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
      this.post({
        t: "call",
        id,
        m: method,
        a: this.marshal(args) as unknown[],
        k: token,
        u: this.options.outboundActor?.(),
      });
    });
  }

  private track<T>(promise: Promise<T>, token: string | undefined): Promise<T> {
    const done = () => this.options.settled?.(token);
    promise.then(done, done);
    return promise;
  }

  /** Fire and forget: no reply is waited for. */
  notify(method: string, args: unknown[] = []): void {
    void this.call(method, args).catch(() => {});
  }

  openStream(): StreamPort {
    const sid = `${this.options.side}${this.nextId++}`;
    return this.port(sid);
  }

  /** Rejects everything still waiting, for when the child goes away. */
  close(reason: string): void {
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(new Error(reason));
    this.pending.clear();
    for (const port of this.streams.values()) {
      port.destroy(new Error(reason));
    }
    this.streams.clear();
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  get functionCount(): number {
    return this.localFns.size;
  }

  private port(sid: string): StreamPort {
    let port = this.streams.get(sid);
    if (!port) {
      port = new StreamPort(sid, (frame) => this.post(frame));
      this.streams.set(sid, port);
      const drop = () => this.streams.delete(sid);
      port.on("close", drop);
    }
    return port;
  }

  private post(message: Wire): void {
    if (this.closed) return;
    this.transport.send(message);
  }

  marshal(value: unknown, depth = 0): unknown {
    if (depth > 32) throw new Error("value nests too deep to cross");
    if (value === null || value === undefined) return value;
    if (typeof value === "function") {
      let id = this.fnIds.get(value);
      if (!id) {
        id = `${this.options.side}f${this.nextId++}`;
        this.fnIds.set(value, id);
        this.localFns.set(id, value as (...a: unknown[]) => unknown);
      }
      return { $f: id };
    }
    if (typeof value !== "object") return value;
    const hooked = this.options.marshalHook?.(value);
    if (hooked !== undefined) return hooked;
    if (value instanceof StreamPort) return { $s: value.sid };
    if (value instanceof Uint8Array) return value;
    if (value instanceof Date || value instanceof RegExp) return value;
    if (value instanceof Error) return { $e: toWireError(value) };
    if (Array.isArray(value)) {
      return value.map((item) => this.marshal(item, depth + 1));
    }
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) {
      out[key] = this.marshal(
        (value as Record<string, unknown>)[key],
        depth + 1,
      );
    }
    // A class instance loses its prototype methods here. Mark it so the
    // spike log can show which calls returned one.
    const proto = Object.getPrototypeOf(value);
    if (proto && proto !== Object.prototype && proto !== null) {
      out.$class = proto.constructor?.name ?? "anonymous";
    }
    return out;
  }

  unmarshal(value: unknown): unknown {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Uint8Array) return Buffer.from(value);
    if (value instanceof Date || value instanceof RegExp) return value;
    if (Array.isArray(value)) return value.map((item) => this.unmarshal(item));
    const record = value as Record<string, unknown>;
    if (typeof record.$f === "string") return this.remoteFn(record.$f);
    if (typeof record.$s === "string") return this.port(record.$s);
    if (record.$e) return fromWireError(record.$e as WireError);
    const hooked = this.options.unmarshalHook?.(record);
    if (hooked !== undefined) return hooked;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record)) {
      if (key === "$class") continue;
      out[key] = this.unmarshal(record[key]);
    }
    return out;
  }

  private remoteFn(f: string): (...args: unknown[]) => Promise<unknown> {
    const fn = (...args: unknown[]) => {
      const id = this.nextId++;
      const token = this.options.outboundToken();
      return this.track(
        new Promise((resolve, reject) => {
          this.pending.set(id, { resolve, reject });
          this.post({
            t: "fn",
            id,
            f,
            a: this.marshal(args) as unknown[],
            k: token,
            u: this.options.outboundActor?.(),
          });
        }),
        token,
      );
    };
    this.released?.register(fn, f);
    return fn;
  }

  private onMessage(message: Wire): void {
    switch (message.t) {
      case "ok":
      case "err": {
        const waiter = this.pending.get(message.id);
        if (!waiter) return;
        this.pending.delete(message.id);
        if (message.t === "ok") waiter.resolve(this.unmarshal(message.v));
        else waiter.reject(fromWireError(message.e));
        return;
      }
      case "rel":
        this.localFns.delete(message.f);
        return;
      case "s":
        this.port(message.s).receive(message.op, message.d);
        return;
      case "call":
      case "fn": {
        const target =
          message.t === "call"
            ? this.handlers.get(message.m)
            : (this.localFns.get(message.f) as Handler | undefined);
        if (!target) {
          this.post({
            t: "err",
            id: message.id,
            e: {
              message:
                message.t === "call"
                  ? `Unknown method ${message.m}`
                  : "That function is gone",
              code: "SANDBOX_UNKNOWN",
            },
          });
          return;
        }
        const args = this.unmarshal(message.a) as unknown[];
        let result: unknown;
        try {
          result = this.options.inbound(
            message.k,
            () =>
              message.t === "call"
                ? (target as Handler)(args, message.k)
                : (target as (...a: unknown[]) => unknown)(...args),
            message.u,
          );
        } catch (error) {
          this.post({ t: "err", id: message.id, e: toWireError(error) });
          return;
        }
        Promise.resolve(result).then(
          (v) => this.post({ t: "ok", id: message.id, v: this.marshal(v) }),
          (e) => this.post({ t: "err", id: message.id, e: toWireError(e) }),
        );
        return;
      }
    }
  }
}

export function toWireError(error: unknown): WireError {
  if (error instanceof Error) {
    const extra = error as Error & {
      code?: unknown;
      status?: unknown;
      statusCode?: unknown;
      resource?: unknown;
    };
    const status = extra.status ?? extra.statusCode;
    // A permission denial names what it refused, which is what a plugin
    // author needs to see.
    const resource =
      extra.code === "ERR_ACCESS_DENIED" && typeof extra.resource === "string"
        ? ` (${extra.resource})`
        : "";
    return {
      message: error.message + resource,
      name: error.name,
      code: typeof extra.code === "string" ? extra.code : undefined,
      status: typeof status === "number" ? status : undefined,
    };
  }
  return { message: String(error) };
}

export function fromWireError(wire: WireError): Error {
  const error = new Error(wire.message) as Error & {
    code?: string;
    status?: number;
  };
  if (wire.name) error.name = wire.name;
  if (wire.code) error.code = wire.code;
  if (wire.status) error.status = wire.status;
  return error;
}

/** A Transport over a forked child's (or the child's own) IPC channel. */
export function processTransport(proc: {
  send?: (message: unknown) => boolean;
  on: (event: "message", listener: (message: unknown) => void) => unknown;
}): Transport {
  return {
    send: (message) => {
      proc.send?.(message);
    },
    onMessage: (handler) => {
      proc.on("message", (message) => handler(message as Wire));
    },
  };
}
